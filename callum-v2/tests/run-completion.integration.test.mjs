import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('shadow run completes with the final ACK after all leads and queued commands finish', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),operatorId=`v2finish_${randomUUID().slice(0,8)}`;
  try{
    await control.seed();await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.5.0','ed7ada2');
    const installation=await control.installation(issued.token);
    const configVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'shadow',$3) RETURNING id",
      [operatorId,installation.id,configVersion])).rows[0];
    const leads=[];
    for(let n=0;n<2;n++){
      const id=randomUUID(),profileKey=`qa-run-finish-${n}-${id.slice(0,8)}`;
      const lead={id,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
      leads.push(lead);
      await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
        [run.id,id,profileKey,lead.linkedin_url]);
      await db.tx(q=>control.enqueue(q,{id:run.id,operator_id:operatorId,config_version:configVersion},lead,'INSPECT_PROFILE',`finish:${run.id}:${id}`));
    }
    await db.tx(q=>control.enqueue(q,{id:run.id,operator_id:operatorId,config_version:configVersion},leads[0],
      'INSPECT_PROFILE',`finish-extra:${run.id}`));
    const observe=async command=>control.acknowledge(installation,{commandId:command.id,status:'observed',facts:{
      profileMatched:true,profileKey:command.targetProfileKey,pageReady:true,connectAvailable:true,diagnosticCode:'OK'}});
    await observe((await control.claim(installation)).command);
    assert.equal((await db.query('SELECT status FROM callum_v2.runs WHERE id=$1',[run.id])).rows[0].status,'running');
    await observe((await control.claim(installation)).command);
    const extra=(await control.claim(installation)).command;
    assert.equal(extra.type,'INSPECT_PROFILE','queued observation prevents premature run completion');
    assert.equal((await db.query('SELECT status FROM callum_v2.runs WHERE id=$1',[run.id])).rows[0].status,'running');
    await observe(extra);
    assert.equal((await db.query('SELECT status FROM callum_v2.runs WHERE id=$1',[run.id])).rows[0].status,'completed');
    assert.equal((await control.claim(installation)).command,null);
    assert.equal((await db.query('SELECT status FROM callum_v2.runs WHERE id=$1',[run.id])).rows[0].status,'completed');
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.events WHERE run_id=$1 AND event_type='run_completed'",[run.id])).rows[0].n,1);
    assert.equal((await control.claim(installation)).command,null);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.events WHERE run_id=$1 AND event_type='run_completed'",[run.id])).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.action_intents WHERE run_id=$1',[run.id])).rows[0].n,0);
  }finally{await db.close();}
});
