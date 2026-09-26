import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;
async function withClockOffset(offsetMs,work){
  const RealDate=globalThis.Date;
  globalThis.Date=class extends RealDate{
    constructor(...args){super(...(args.length?args:[RealDate.now()+offsetMs]));}
    static now(){return RealDate.now()+offsetMs;}
  };
  try{return await work();}finally{globalThis.Date=RealDate;}
}
test('operator ownership and revocation are rechecked at claim and action authorization', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),suffix=randomUUID().slice(0,8);
  const owner=`v2owner_${suffix}`,other=`v2other_${suffix}`;
  const actorKey=`qa-actor-${suffix}`;
  const previousQa=process.env.V2_QA_PROFILE_KEY;
  let ownerInstallationId=null,otherInstallationId=null,runId=null;
  try{
    await control.seed();await control.createOperator(owner,'dev',1);await control.createOperator(other,'dev',1);
    const ownerIssued=await control.createInstallation(owner,'2.5.1','a142581d',`https://www.linkedin.com/in/${actorKey}/`);
    const otherIssued=await control.createInstallation(other,'2.5.1','a142581d',`https://www.linkedin.com/in/${actorKey}/`);
    ownerInstallationId=ownerIssued.id;otherInstallationId=otherIssued.id;
    const ownerInstallation=await control.installation(ownerIssued.token),otherInstallation=await control.installation(otherIssued.token);
    const configVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const leadId=randomUUID(),profileKey=`qa-authorization-${leadId.slice(0,8)}`;
    process.env.V2_QA_PROFILE_KEY=profileKey;
    const run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
      [owner,ownerInstallation.id,configVersion])).rows[0];
    runId=run.id;
    const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
    await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
      [run.id,leadId,profileKey,lead.linkedin_url]);
    await db.tx(q=>control.enqueue(q,{id:run.id,operator_id:owner,config_version:configVersion},lead,'INSPECT_PROFILE',
      `auth:${run.id}`,null,{actorProfileKey:actorKey}));
    assert.equal((await control.claim(otherInstallation)).command,null);
    const inspect=(await control.claim(ownerInstallation)).command;
    await assert.rejects(()=>control.acknowledge(otherInstallation,{commandId:inspect.id,status:'observed',facts:{
      profileMatched:true,profileKey,pageReady:true,viewerMatched:true,connectAvailable:true,diagnosticCode:'OK'}}),/COMMAND_NOT_OWNED/);
    await control.acknowledge(ownerInstallation,{commandId:inspect.id,status:'observed',facts:{
      profileMatched:true,profileKey,pageReady:true,viewerMatched:true,connectAvailable:true,diagnosticCode:'OK'}});
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
    if(runId)await control.pauseRun(runId).catch(()=>{});
    if(ownerInstallationId)await control.revokeInstallation(ownerInstallationId).catch(()=>{});
    if(otherInstallationId)await control.revokeInstallation(otherInstallationId).catch(()=>{});
    await control.disableOperator(owner,true).catch(()=>{});
    await control.disableOperator(other,true).catch(()=>{});
    await db.close();
  }
});

test('Connect authorization rechecks live-canary mode, installation and QA recipient', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),operatorId=`v2qaauth_${randomUUID().slice(0,8)}`;
  const actorKey=`qa-actor-${randomUUID().slice(0,8)}`;
  const previousQa=process.env.V2_QA_PROFILE_KEY;
  const installationIds=[];
  let runId=null;
  try{
    await control.seed();await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.5.1','a142581d',`https://www.linkedin.com/in/${actorKey}/`);
    const other=await control.createInstallation(operatorId,'2.5.1','a142581d',`https://www.linkedin.com/in/${actorKey}/`);
    installationIds.push(issued.id,other.id);
    const installation=await control.installation(issued.token);
    const version=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const leadId=randomUUID(),profileKey=`qa-final-auth-${leadId.slice(0,8)}`;
    const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
    const run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
      [operatorId,installation.id,version])).rows[0];
    runId=run.id;
    await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
      [run.id,leadId,profileKey,lead.linkedin_url]);
    await withClockOffset(3_600_000,()=>db.tx(q=>control.enqueue(q,{id:run.id,operator_id:operatorId,config_version:version},lead,
      'INSPECT_PROFILE',`qa-final-auth:${run.id}`,null,{expectedName:'QA Fixture',actorProfileKey:actorKey})));
    const expiry=(await db.query(`SELECT extract(epoch FROM (expires_at-now()))/60 AS minutes_remaining
      FROM callum_v2.commands WHERE idempotency_key=$1`,[`qa-final-auth:${run.id}`])).rows[0];
    assert.ok(Number(expiry.minutes_remaining)>28&&Number(expiry.minutes_remaining)<31,
      'read-only command expires from database time despite a fast API clock');
    const inspection=(await control.claim(installation)).command;
    process.env.V2_QA_PROFILE_KEY=profileKey;
    await control.acknowledge(installation,{commandId:inspection.id,status:'observed',facts:{
      profileMatched:true,profileKey,pageReady:true,viewerMatched:true,connectAvailable:true,diagnosticCode:'OK'}});
    const action=(await control.claim(installation)).command;
    assert.equal(action.type,'EXECUTE_CONNECT');
    const stableVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='stable'")).rows[0].active_config_version);
    assert.notEqual(stableVersion,version,'cohort channels differ for the stale-snapshot fixture');
    try{
      await control.createOperator(operatorId,'stable',1);
      await assert.rejects(()=>control.authorizeAction(installation,action.id),/ACTION_NOT_AUTHORIZED/,
        'authorization re-reads the operator cohort');
    }finally{await control.createOperator(operatorId,'dev',1);}
    await db.query("UPDATE callum_v2.runs SET mode='shadow' WHERE id=$1",[run.id]);
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
    await db.query("UPDATE callum_v2.observations SET facts=jsonb_set(facts,'{viewerMatched}','false') WHERE command_id=$1",[inspection.id]);
    await assert.rejects(()=>control.authorizeAction(installation,action.id),/ACTION_NOT_AUTHORIZED/,'source viewer mismatch');
    await db.query("UPDATE callum_v2.observations SET facts=jsonb_set(facts,'{viewerMatched}','true') WHERE command_id=$1",[inspection.id]);
    await db.query("UPDATE callum_v2.commands SET lease_expires_at=now()-INTERVAL '1 second' WHERE id=$1",[action.id]);
    await withClockOffset(-3_600_000,()=>assert.rejects(()=>control.authorizeAction(installation,action.id),
      /ACTION_NOT_AUTHORIZED/,'expired database lease is denied despite a slow API clock'));
    await db.query("UPDATE callum_v2.commands SET lease_expires_at=now()+INTERVAL '90 seconds' WHERE id=$1",[action.id]);
    assert.equal((await withClockOffset(3_600_000,()=>control.authorizeAction(installation,action.id))).authorized,true,
      'valid database lease is accepted despite a fast API clock');
    await assert.rejects(()=>control.authorizeAction(installation,action.id),/ACTION_NOT_AUTHORIZED/);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.events WHERE run_id=$1 AND event_type='connection_authorized'",[run.id])).rows[0].n,1);
  }finally{
    if(previousQa===undefined)delete process.env.V2_QA_PROFILE_KEY;else process.env.V2_QA_PROFILE_KEY=previousQa;
    if(runId)await control.pauseRun(runId).catch(()=>{});
    for(const id of installationIds)await control.revokeInstallation(id).catch(()=>{});
    await control.disableOperator(operatorId,true).catch(()=>{});
    await db.close();
  }
});
