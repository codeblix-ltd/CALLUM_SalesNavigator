import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;
test('run pause/resume, operator disable, global kill and daily limit gate command delivery', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),operatorId=`v2state_${randomUUID().slice(0,8)}`;
  const actorKey=`qa-actor-${randomUUID().slice(0,8)}`;
  try{
    await control.seed();await control.createOperator(operatorId,'dev',0);
    const issued=await control.createInstallation(operatorId,'2.5.1','b4e9668a',`https://www.linkedin.com/in/${actorKey}/`);
    const installation=await control.installation(issued.token);
    const configVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    async function fixture(mode){
      const leadId=randomUUID(),profileKey=`qa-state-${leadId.slice(0,8)}`;
      const run=(await db.query('INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,$3,$4) RETURNING id',
        [operatorId,installation.id,mode,configVersion])).rows[0];
      const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
      await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
        [run.id,leadId,profileKey,lead.linkedin_url]);
      await db.tx(q=>control.enqueue(q,{id:run.id,operator_id:operatorId,config_version:configVersion},lead,
        'INSPECT_PROFILE',`state:${run.id}`,null,{actorProfileKey:actorKey}));
      return {runId:run.id,leadId,profileKey};
    }
    const paused=await fixture('shadow');
    await control.pauseRun(paused.runId);
    assert.equal((await control.claim(installation)).command,null);
    await control.resumeRun(paused.runId);
    const first=(await control.claim(installation)).command;assert.equal(first.runId,paused.runId);
    assert.equal((await control.acknowledge(installation,{commandId:first.id,status:'observed',facts:{profileMatched:true,
      profileKey:paused.profileKey,pageReady:true,connectAvailable:true,diagnosticCode:'OK'}})).stage,'completed');
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.action_intents WHERE run_id=$1',[paused.runId])).rows[0].n,0);

    const gated=await fixture('shadow');
    await control.disableOperator(operatorId,true);
    await assert.rejects(()=>control.installation(issued.token),/UNAUTHORIZED/);
    await control.disableOperator(operatorId,false);
    await control.setFlag('all',true);
    assert.equal((await control.claim(await control.installation(issued.token))).command,null);
    await control.setFlag('all',false);
    const resumed=(await control.claim(installation)).command;assert.equal(resumed.runId,gated.runId);
    await control.acknowledge(installation,{commandId:resumed.id,status:'observed',facts:{profileMatched:true,
      profileKey:gated.profileKey,pageReady:true,connectAvailable:true,diagnosticCode:'OK'}});

    const hydrated=await fixture('shadow');
    const firstHydration=(await control.claim(installation)).command;
    assert.equal((await control.acknowledge(installation,{commandId:firstHydration.id,status:'observed',facts:{profileMatched:true,
      profileKey:hydrated.profileKey,pageReady:false,diagnosticCode:'PAGE_HYDRATING'}})).stage,'paused');
    await control.pauseRun(hydrated.runId);
    assert.equal((await control.resumeRun(hydrated.runId)).queued,1);
    const retry=(await control.claim(installation)).command;
    assert.equal(retry.type,'INSPECT_PROFILE');assert.notEqual(retry.id,firstHydration.id);
    assert.equal((await control.acknowledge(installation,{commandId:retry.id,status:'observed',facts:{profileMatched:true,
      profileKey:hydrated.profileKey,pageReady:true,connectAvailable:true,diagnosticCode:'OK'}})).stage,'completed');

    const zero=await fixture('live_canary');
    const zeroCommand=(await control.claim(installation)).command;
    assert.equal((await control.acknowledge(installation,{commandId:zeroCommand.id,status:'observed',facts:{profileMatched:true,
      profileKey:zero.profileKey,pageReady:true,viewerMatched:true,connectAvailable:true,diagnosticCode:'OK'}})).stage,'paused');
    assert.equal((await db.query('SELECT stage FROM callum_v2.run_leads WHERE run_id=$1',[zero.runId])).rows[0].stage,'paused');
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.action_intents WHERE run_id=$1',[zero.runId])).rows[0].n,0);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.events WHERE run_id=$1 AND event_type='daily_limit_reached'",[zero.runId])).rows[0].n,1);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.events WHERE run_id=$1 AND event_type='connection_reserved'",[zero.runId])).rows[0].n,0);
    await control.createOperator(operatorId,'dev',1);
    const allowed=await fixture('live_canary');
    const allowedCommand=(await control.claim(installation)).command;
    await control.acknowledge(installation,{commandId:allowedCommand.id,status:'observed',facts:{profileMatched:true,
      profileKey:allowed.profileKey,pageReady:true,viewerMatched:true,connectAvailable:true,diagnosticCode:'OK'}});
    assert.equal((await db.query('SELECT state FROM callum_v2.action_intents WHERE run_id=$1',[allowed.runId])).rows[0].state,'reserved');
    await control.pauseRun(allowed.runId);
    const conflict=await fixture('live_canary');
    await db.query(`INSERT INTO callum_v2.action_intents(run_id,operator_id,lead_id,action_type,target_key,state)
      VALUES ($1,$2,$3,'comment','https://www.linkedin.com/feed/update/urn:li:activity:999','reconcile_required')`,
      [conflict.runId,operatorId,conflict.leadId]);
    const conflictCommand=(await control.claim(installation)).command;
    assert.equal((await control.acknowledge(installation,{commandId:conflictCommand.id,status:'observed',facts:{profileMatched:true,
      profileKey:conflict.profileKey,pageReady:true,viewerMatched:true,connectAvailable:true,diagnosticCode:'OK'}})).stage,'paused');
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.action_intents WHERE run_id=$1 AND action_type='connect'",[conflict.runId])).rows[0].n,0);
    await control.pauseRun(conflict.runId);
    assert.equal((await control.resumeRun(conflict.runId)).queued,0,'unresolved action is never resumed as a new profile action');
  }finally{
    await control.setFlag('all',false).catch(()=>{});
    await control.disableOperator(operatorId,false).catch(()=>{});
    await db.close();
  }
});
