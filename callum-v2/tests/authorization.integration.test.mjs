import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;
test('operator ownership and revocation are rechecked at claim and action authorization', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),suffix=randomUUID().slice(0,8);
  const owner=`v2owner_${suffix}`,other=`v2other_${suffix}`;
  const previousQa=process.env.V2_QA_PROFILE_KEY;
  try{
    await control.seed();await control.createOperator(owner,'dev',1);await control.createOperator(other,'dev',1);
    const ownerIssued=await control.createInstallation(owner,'2.5.0','a142581d');
    const otherIssued=await control.createInstallation(other,'2.5.0','a142581d');
    const ownerInstallation=await control.installation(ownerIssued.token),otherInstallation=await control.installation(otherIssued.token);
    const configVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const leadId=randomUUID(),profileKey=`qa-authorization-${leadId.slice(0,8)}`;
    process.env.V2_QA_PROFILE_KEY=profileKey;
    const run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
      [owner,ownerInstallation.id,configVersion])).rows[0];
    const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
    await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
      [run.id,leadId,profileKey,lead.linkedin_url]);
    await db.tx(q=>control.enqueue(q,{id:run.id,operator_id:owner,config_version:configVersion},lead,'INSPECT_PROFILE',`auth:${run.id}`));
    assert.equal((await control.claim(otherInstallation)).command,null);
    const inspect=(await control.claim(ownerInstallation)).command;
    await assert.rejects(()=>control.acknowledge(otherInstallation,{commandId:inspect.id,status:'observed',facts:{
      profileMatched:true,profileKey,pageReady:true,connectAvailable:true,diagnosticCode:'OK'}}),/COMMAND_NOT_OWNED/);
    await control.acknowledge(ownerInstallation,{commandId:inspect.id,status:'observed',facts:{
      profileMatched:true,profileKey,pageReady:true,connectAvailable:true,diagnosticCode:'OK'}});
    const action=(await control.claim(ownerInstallation)).command;
    assert.equal(action.type,'EXECUTE_CONNECT');
    await assert.rejects(()=>control.authorizeAction(otherInstallation,action.id),/ACTION_NOT_AUTHORIZED/);
    await control.disableOperator(owner,true);
    await assert.rejects(()=>control.claim(ownerInstallation),/UNAUTHORIZED/);
    await assert.rejects(()=>control.authorizeAction(ownerInstallation,action.id),/ACTION_NOT_AUTHORIZED/);
    await control.disableOperator(owner,false);
    await control.revokeInstallation(ownerInstallation.id);
    await assert.rejects(()=>control.installation(ownerIssued.token),/UNAUTHORIZED/);
    await assert.rejects(()=>control.claim(ownerInstallation),/UNAUTHORIZED/);
    await assert.rejects(()=>control.authorizeAction(ownerInstallation,action.id),/ACTION_NOT_AUTHORIZED/);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.events WHERE run_id=$1 AND event_type='connection_authorized'",[run.id])).rows[0].n,0);
  }finally{
    if(previousQa===undefined)delete process.env.V2_QA_PROFILE_KEY;else process.env.V2_QA_PROFILE_KEY=previousQa;
    await control.disableOperator(owner,false).catch(()=>{});
    await db.close();
  }
});

test('Connect authorization rechecks live-canary mode, installation and QA recipient', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),operatorId=`v2qaauth_${randomUUID().slice(0,8)}`;
  const previousQa=process.env.V2_QA_PROFILE_KEY;
  try{
    await control.seed();await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.5.0','a142581d');
    const other=await control.createInstallation(operatorId,'2.5.0','a142581d');
    const installation=await control.installation(issued.token);
    const version=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const leadId=randomUUID(),profileKey=`qa-final-auth-${leadId.slice(0,8)}`;
    const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
    const run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'shadow',$3) RETURNING id",
      [operatorId,installation.id,version])).rows[0];
    await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
      [run.id,leadId,profileKey,lead.linkedin_url]);
    const intent=(await db.query("INSERT INTO callum_v2.action_intents(run_id,operator_id,lead_id,action_type,target_key,state) VALUES ($1,$2,$3,'connect',$4,'reserved') RETURNING id",
      [run.id,operatorId,leadId,profileKey])).rows[0];
    await db.tx(q=>control.enqueue(q,{id:run.id,operator_id:operatorId,config_version:version},lead,
      'EXECUTE_CONNECT',`qa-final-auth:${run.id}`,intent.id,{expectedName:'QA Fixture'}));
    const action=(await control.claim(installation)).command;
    assert.equal(action.type,'EXECUTE_CONNECT');
    process.env.V2_QA_PROFILE_KEY=profileKey;
    await assert.rejects(()=>control.authorizeAction(installation,action.id),/ACTION_NOT_AUTHORIZED/,'shadow run');
    await db.query("UPDATE callum_v2.runs SET mode='live_canary' WHERE id=$1",[run.id]);
    delete process.env.V2_QA_PROFILE_KEY;
    await assert.rejects(()=>control.authorizeAction(installation,action.id),/ACTION_NOT_AUTHORIZED/,'QA key absent');
    process.env.V2_QA_PROFILE_KEY='other-qa-profile';
    await assert.rejects(()=>control.authorizeAction(installation,action.id),/ACTION_NOT_AUTHORIZED/,'wrong QA recipient');
    process.env.V2_QA_PROFILE_KEY=profileKey;
    await db.query('UPDATE callum_v2.runs SET installation_id=$2 WHERE id=$1',[run.id,other.id]);
    await assert.rejects(()=>control.authorizeAction(installation,action.id),/ACTION_NOT_AUTHORIZED/,'run belongs to another installation');
    await db.query('UPDATE callum_v2.runs SET installation_id=$2 WHERE id=$1',[run.id,installation.id]);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.events WHERE run_id=$1 AND event_type='connection_authorized'",[run.id])).rows[0].n,0);
    assert.equal((await control.authorizeAction(installation,action.id)).authorized,true);
    await assert.rejects(()=>control.authorizeAction(installation,action.id),/ACTION_NOT_AUTHORIZED/);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.events WHERE run_id=$1 AND event_type='connection_authorized'",[run.id])).rows[0].n,1);
  }finally{
    if(previousQa===undefined)delete process.env.V2_QA_PROFILE_KEY;else process.env.V2_QA_PROFILE_KEY=previousQa;
    await db.close();
  }
});
