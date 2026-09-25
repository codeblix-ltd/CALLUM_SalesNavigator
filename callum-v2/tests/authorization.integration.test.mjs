import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;
test('operator ownership and revocation are rechecked at claim and action authorization', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),suffix=randomUUID().slice(0,8);
  const owner=`v2owner_${suffix}`,other=`v2other_${suffix}`;
  try{
    await control.seed();await control.createOperator(owner,'dev',1);await control.createOperator(other,'dev',1);
    const ownerIssued=await control.createInstallation(owner,'2.5.0','a142581d');
    const otherIssued=await control.createInstallation(other,'2.5.0','a142581d');
    const ownerInstallation=await control.installation(ownerIssued.token),otherInstallation=await control.installation(otherIssued.token);
    const configVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const leadId=randomUUID(),profileKey='qa-authorization-fixture';
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
    await control.disableOperator(owner,false).catch(()=>{});
    await db.close();
  }
});
