import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';
import {DEFAULT_CONFIG} from '../packages/linkedin-config/index.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;
test('simultaneous lead ACKs cannot exceed one daily connection reservation', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),operatorId=`v2race_${randomUUID().slice(0,8)}`;
  const actorKey=`qa-actor-${randomUUID().slice(0,8)}`;
  try{
    await control.seed();await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.5.1','a142581d',`https://www.linkedin.com/in/${actorKey}/`);
    const installation=await control.installation(issued.token);
    const configVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const commands=[];
    for(let i=0;i<2;i++){
      const leadId=randomUUID(),profileKey=`qa-concurrent-${i}-${leadId.slice(0,8)}`;
      const run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
        [operatorId,installation.id,configVersion])).rows[0];
      const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
      await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
        [run.id,leadId,profileKey,lead.linkedin_url]);
      await db.tx(q=>control.enqueue(q,{id:run.id,operator_id:operatorId,config_version:configVersion},lead,
        'INSPECT_PROFILE',`race:${run.id}`,null,{actorProfileKey:actorKey}));
      commands.push({runId:run.id,profileKey});
    }
    const first=(await control.claim(installation)).command;
    const second=(await control.claim(installation)).command;
    assert.notEqual(first.id,second.id);
    const profileByRun=new Map(commands.map(x=>[x.runId,x.profileKey]));
    const ack=command=>control.acknowledge(installation,{commandId:command.id,status:'observed',facts:{
      profileMatched:true,profileKey:profileByRun.get(command.runId),pageReady:true,viewerMatched:true,
      connectAvailable:true,diagnosticCode:'OK'}});
    const outcomes=await Promise.all([ack(first),ack(second)]);
    assert.deepEqual(outcomes.map(x=>x.stage).sort(),['awaiting_action','paused']);
    const result=(await db.query(`SELECT
      (SELECT count(*)::INT4 FROM callum_v2.action_intents WHERE operator_id=$1 AND action_type='connect') AS intents,
      (SELECT count(*)::INT4 FROM callum_v2.commands WHERE operator_id=$1 AND type='EXECUTE_CONNECT') AS actions,
      (SELECT count(*)::INT4 FROM callum_v2.events WHERE operator_id=$1 AND event_type='daily_limit_reached') AS limits,
      (SELECT count(*)::INT4 FROM callum_v2.events WHERE operator_id=$1 AND event_type='connection_reserved'
        AND command_id IS NOT NULL) AS observation_reservations`,[operatorId])).rows[0];
    assert.deepEqual(result,{intents:1,actions:1,limits:1,observation_reservations:1});
    let retries=0;
    const retried=await db.tx(async q=>{
      retries++;
      if(retries===1){const error=new Error('forced serialization retry');error.code='40001';throw error;}
      return (await q.query('SELECT 1::INT4 AS n')).rows[0].n;
    });
    assert.equal(retried,1);assert.equal(retries,2);
  }finally{await db.close();}
});

test('simultaneous Connect observation and comment approval leave one active intent per lead', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),operatorId=`v2cross_${randomUUID().slice(0,8)}`;
  const fixtureId=randomUUID();
  const previousQa=process.env.V2_QA_PROFILE_KEY,qaKey=`qa-cross-action-${fixtureId.slice(0,8)}`,actorKey='qa-cross-actor';
  const postUrl=`https://www.linkedin.com/feed/update/urn:li:activity:${BigInt('0x'+fixtureId.replaceAll('-','').slice(0,12))}`;
  let previousConfig=null;
  try{
    await control.seed();await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.5.1','a142581d',`https://www.linkedin.com/in/${actorKey}/`);
    const installation=await control.installation(issued.token);
    previousConfig=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const configVersion=Number((await control.createConfig(DEFAULT_CONFIG,'2.5.0')).version);
    await control.activateConfig(configVersion,'dev');
    process.env.V2_QA_PROFILE_KEY=qaKey;
    const leadId=randomUUID(),lead={id:leadId,profile_key:qaKey,linkedin_url:`https://www.linkedin.com/in/${qaKey}/`};
    const runIds=[];
    for(let i=0;i<2;i++){
      const run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
        [operatorId,installation.id,configVersion])).rows[0];
      runIds.push(run.id);
      await db.query("INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url,full_name) VALUES ($1,$2,$3,$4,'QA Cross Action')",
        [run.id,leadId,qaKey,lead.linkedin_url]);
    }
    await db.tx(q=>control.enqueue(q,{id:runIds[0],operator_id:operatorId,config_version:configVersion},lead,
      'INSPECT_PROFILE',`cross-connect:${runIds[0]}`,null,{actorProfileKey:actorKey}));
    const commentRequest=await control.queueInspection({runId:runIds[1],leadId,type:'INSPECT_COMMENT_STATE',postUrl});
    const connectCommand=(await control.claim(installation)).command;
    const commentCommand=(await control.claim(installation)).command;
    assert.equal(connectCommand.type,'INSPECT_PROFILE');assert.equal(commentCommand.id,commentRequest.id);
    await control.acknowledge(installation,{commandId:commentCommand.id,status:'observed',facts:{profileMatched:true,profileKey:qaKey,
      pageReady:true,postUrls:[postUrl],targetPostPresent:true,targetPostAuthoredByLead:true,viewerMatched:true,
      commentBoxAvailable:true,diagnosticCode:'OK'}});
    const draft=await control.createCommentDraft({runId:runIds[1],leadId,inspectionCommandId:commentCommand.id,body:'Approved QA race comment.'});
    const outcomes=await Promise.allSettled([
      control.acknowledge(installation,{commandId:connectCommand.id,status:'observed',facts:{profileMatched:true,
        profileKey:qaKey,pageReady:true,viewerMatched:true,connectAvailable:true,diagnosticCode:'OK'}}),
      control.reviewCommentDraft({draftId:draft.id,decision:'approve',reviewer:'qa_reviewer'})
    ]);
    assert.equal(outcomes.filter(x=>x.status==='rejected'&&!/ACTION_CONFLICT/.test(x.reason?.message||'')).length,0,
      JSON.stringify(outcomes.map(x=>x.status==='rejected'?{status:x.status,message:x.reason?.message,code:x.reason?.code}:{status:x.status})));
    const intents=(await db.query(`SELECT action_type,state FROM callum_v2.action_intents WHERE operator_id=$1 AND lead_id=$2
      AND state IN ('reserved','submitted','reconcile_required')`,[operatorId,leadId])).rows;
    assert.equal(intents.length,1);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.commands WHERE operator_id=$1 AND lead_id=$2 AND type IN ('EXECUTE_CONNECT','EXECUTE_COMMENT')",
      [operatorId,leadId])).rows[0].n,1);
  }finally{
    if(previousQa===undefined)delete process.env.V2_QA_PROFILE_KEY;else process.env.V2_QA_PROFILE_KEY=previousQa;
    if(previousConfig!==null)await control.activateConfig(previousConfig,'dev').catch(()=>{});
    await db.close();
  }
});

test('different V2 operators cannot reserve Connect for one profile under different lead IDs', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),fixtureId=randomUUID();
  const profileKey=`qa-global-target-${fixtureId.slice(0,8)}`;
  const actorKey=`qa-actor-${fixtureId.slice(0,8)}`;
  try{
    await control.seed();
    const configVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const claims=[];
    for(let i=0;i<2;i++){
      const operatorId=`v2global_${i}_${fixtureId.slice(0,8)}`;
      await control.createOperator(operatorId,'dev',1);
      const issued=await control.createInstallation(operatorId,'2.5.1','a142581d',`https://www.linkedin.com/in/${actorKey}/`);
      const installation=await control.installation(issued.token);
      const leadId=randomUUID();
      const run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
        [operatorId,installation.id,configVersion])).rows[0];
      const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
      await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
        [run.id,leadId,profileKey,lead.linkedin_url]);
      await db.tx(q=>control.enqueue(q,{id:run.id,operator_id:operatorId,config_version:configVersion},lead,
        'INSPECT_PROFILE',`global:${run.id}`,null,{actorProfileKey:actorKey}));
      claims.push({installation,command:(await control.claim(installation)).command});
    }
    const results=await Promise.all(claims.map(({installation,command})=>control.acknowledge(installation,{
      commandId:command.id,status:'observed',facts:{profileMatched:true,profileKey,pageReady:true,viewerMatched:true,
        connectAvailable:true,diagnosticCode:'OK'}})));
    assert.deepEqual(results.map(x=>x.stage).sort(),['awaiting_action','paused']);
    const counts=(await db.query(`SELECT
      (SELECT count(*)::INT4 FROM callum_v2.action_targets WHERE action_type='connect' AND target_key=$1) AS targets,
      (SELECT count(*)::INT4 FROM callum_v2.action_intents WHERE action_type='connect' AND target_key=$1) AS intents,
      (SELECT count(*)::INT4 FROM callum_v2.commands WHERE type='EXECUTE_CONNECT' AND target_profile_key=$1) AS actions`,
      [profileKey])).rows[0];
    assert.deepEqual(counts,{targets:1,intents:1,actions:1});
  }finally{await db.close();}
});
