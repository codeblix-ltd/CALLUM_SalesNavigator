import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';
import {DEFAULT_CONFIG} from '../packages/linkedin-config/index.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;
test('reviewed QA comment authorizes once, then reconciles uncertain submission without resend', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),operatorId=`v2comment_${randomUUID().slice(0,8)}`;
  const previousQa=process.env.V2_QA_PROFILE_KEY,qaKey='qa-comment-test',actorKey='qa-comment-actor';
  const postId=BigInt('0x'+randomUUID().replaceAll('-','').slice(0,12));
  const post=`https://www.linkedin.com/feed/update/urn:li:activity:${postId}`;
  let previousConfig=null,ruleVersion=null;
  try{
    await control.seed();
    previousConfig=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    await control.createOperator(operatorId,'dev',0);
    const issued=await control.createInstallation(operatorId,'2.5.0','a1b2c3d4',`https://www.linkedin.com/in/${actorKey}/`);
    const installation=await control.installation(issued.token);
    assert.equal(installation.actor_profile_key,actorKey);
    const config=await control.createConfig(DEFAULT_CONFIG,'2.5.0');
    await control.activateConfig(Number(config.version),'dev');
    process.env.V2_QA_PROFILE_KEY=qaKey;
    const leadId=randomUUID();
    const run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
      [operatorId,installation.id,config.version])).rows[0];
    await db.query("INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url,full_name) VALUES ($1,$2,$3,$4,'QA Comment Test')",
      [run.id,leadId,qaKey,`https://www.linkedin.com/in/${qaKey}/`]);
    const scoped={runId:run.id,leadId};
    const requested=await control.queueInspection({...scoped,type:'INSPECT_COMMENT_STATE',postUrl:post});
    const inspected=await control.claim(installation);
    assert.equal(inspected.command.id,requested.id);
    assert.equal(inspected.command.payload.actorProfileKey,actorKey);
    await control.acknowledge(installation,{commandId:requested.id,status:'observed',facts:{
      profileMatched:true,profileKey:qaKey,pageReady:true,postUrls:[post],targetPostPresent:true,
      targetPostAuthoredByLead:true,viewerMatched:true,commentBoxAvailable:true,diagnosticCode:'OK'}});
    const draft=await control.createCommentDraft({...scoped,inspectionCommandId:requested.id,body:'Approved QA comment.'});
    assert.equal(draft.status,'draft');
    await db.query("UPDATE callum_v2.run_leads SET stage='completed' WHERE run_id=$1",[run.id]);
    await db.query("UPDATE callum_v2.runs SET status='completed' WHERE id=$1",[run.id]);
    const approved=await control.reviewCommentDraft({draftId:draft.id,decision:'approve',reviewer:'qa_reviewer'});
    assert.equal(approved.status,'approved');
    assert.equal((await db.query('SELECT status FROM callum_v2.runs WHERE id=$1',[run.id])).rows[0].status,'running');
    await assert.rejects(()=>control.reviewCommentDraft({draftId:draft.id,decision:'approve',reviewer:'qa_reviewer'}),/COMMENT_DRAFT_NOT_OPEN/);
    await control.setFlag('comment',true);
    assert.equal((await control.claim(installation)).command,null);
    await control.setFlag('comment',false);
    const action=(await control.claim(installation)).command;
    assert.equal(action.type,'EXECUTE_COMMENT');
    assert.equal(action.targetUrl,post);
    assert.equal(action.payload.approvedText,'Approved QA comment.');
    assert.equal((await control.authorizeAction(installation,action.id)).authorized,true);
    await assert.rejects(()=>control.authorizeAction(installation,action.id),/ACTION_NOT_AUTHORIZED/);
    ruleVersion=Date.now();
    await db.query("INSERT INTO callum_v2.pay_rules(version,event_type,amount_minor,currency,enabled) VALUES ($1,'comment_confirmed',0,'USD',true)",[ruleVersion]);
    assert.equal((await control.acknowledge(installation,{commandId:action.id,status:'uncertain',facts:{
      profileMatched:true,profileKey:qaKey,pageReady:true,postUrls:[post],targetPostPresent:true,
      targetPostAuthoredByLead:true,viewerMatched:true,commentTargetVerified:true,commentEditorVerified:true,
      diagnosticCode:'POSTCONDITION_UNKNOWN'}})).stage,'reconcile_required');
    const reconciliation=(await control.claim(installation)).command;
    assert.equal(reconciliation.type,'INSPECT_COMMENT_STATE');
    assert.equal(reconciliation.targetUrl,post);
    assert.equal(reconciliation.payload.reconcile,true);
    assert.equal(reconciliation.payload.approvedText,'Approved QA comment.');
    const outcome=await control.acknowledge(installation,{commandId:reconciliation.id,status:'observed',facts:{
      profileMatched:true,profileKey:qaKey,pageReady:true,postUrls:[post],targetPostPresent:true,
      targetPostAuthoredByLead:true,viewerMatched:true,ownCommentPresent:true,commentBoxAvailable:true,diagnosticCode:'OK'}});
    assert.equal(outcome.stage,'completed');
    assert.equal((await control.acknowledge(installation,{commandId:reconciliation.id,status:'observed',facts:{}})).duplicate,true);
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.pay_ledger WHERE action_intent_id=$1',[approved.actionIntentId])).rows[0].n,1);
    assert.equal((await db.query('SELECT state FROM callum_v2.action_intents WHERE id=$1',[approved.actionIntentId])).rows[0].state,'confirmed');
    assert.equal((await control.claim(installation)).command,null);

    const lateLeadId=randomUUID(),latePost=`https://www.linkedin.com/feed/update/urn:li:activity:${postId+1n}`;
    const lateRun=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
      [operatorId,installation.id,config.version])).rows[0];
    await db.query("INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url,full_name) VALUES ($1,$2,$3,$4,'QA Comment Test')",
      [lateRun.id,lateLeadId,qaKey,`https://www.linkedin.com/in/${qaKey}/`]);
    const lateScope={runId:lateRun.id,leadId:lateLeadId};
    await control.queueInspection({...lateScope,type:'INSPECT_COMMENT_STATE',postUrl:latePost});
    const lateInspect=(await control.claim(installation)).command;
    await control.acknowledge(installation,{commandId:lateInspect.id,status:'observed',facts:{profileMatched:true,profileKey:qaKey,pageReady:true,
      postUrls:[latePost],targetPostPresent:true,targetPostAuthoredByLead:true,viewerMatched:true,commentBoxAvailable:true,diagnosticCode:'OK'}});
    const lateDraft=await control.createCommentDraft({...lateScope,inspectionCommandId:lateInspect.id,body:'Another approved QA comment.'});
    const lateApproved=await control.reviewCommentDraft({draftId:lateDraft.id,decision:'approve',reviewer:'qa_reviewer'});
    const lateAction=(await control.claim(installation)).command;
    await control.authorizeAction(installation,lateAction.id);
    await db.query("UPDATE callum_v2.commands SET lease_expires_at=now()-INTERVAL '1 second' WHERE id=$1",[lateAction.id]);
    await db.tx(q=>control.recoverExpired(q,operatorId));
    const lateReconcile=(await control.claim(installation)).command;
    assert.equal(lateReconcile.type,'INSPECT_COMMENT_STATE');
    assert.equal((await control.acknowledge(installation,{commandId:lateReconcile.id,status:'observed',facts:{profileMatched:true,profileKey:qaKey,
      pageReady:true,postUrls:[latePost],targetPostPresent:true,targetPostAuthoredByLead:true,viewerMatched:true,
      ownCommentPresent:true,diagnosticCode:'OK'}})).stage,'completed');
    assert.equal((await control.acknowledge(installation,{commandId:lateAction.id,status:'uncertain',facts:{diagnosticCode:'POSTCONDITION_UNKNOWN'}})).stage,'completed');
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.pay_ledger WHERE action_intent_id=$1',[lateApproved.actionIntentId])).rows[0].n,1);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.commands WHERE run_id=$1 AND type='EXECUTE_COMMENT'",[lateRun.id])).rows[0].n,1);

    const directLeadId=randomUUID(),directPost=`https://www.linkedin.com/feed/update/urn:li:activity:${postId+2n}`;
    const directRun=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
      [operatorId,installation.id,config.version])).rows[0];
    await db.query("INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url,full_name) VALUES ($1,$2,$3,$4,'QA Comment Test')",
      [directRun.id,directLeadId,qaKey,`https://www.linkedin.com/in/${qaKey}/`]);
    const directScope={runId:directRun.id,leadId:directLeadId};
    await control.queueInspection({...directScope,type:'INSPECT_COMMENT_STATE',postUrl:directPost});
    const directInspect=(await control.claim(installation)).command;
    await control.acknowledge(installation,{commandId:directInspect.id,status:'observed',facts:{profileMatched:true,profileKey:qaKey,pageReady:true,
      postUrls:[directPost],targetPostPresent:true,targetPostAuthoredByLead:true,viewerMatched:true,commentBoxAvailable:true,diagnosticCode:'OK'}});
    const directDraft=await control.createCommentDraft({...directScope,inspectionCommandId:directInspect.id,body:'Direct approved QA comment.'});
    const directApproved=await control.reviewCommentDraft({draftId:directDraft.id,decision:'approve',reviewer:'qa_reviewer'});
    const directAction=(await control.claim(installation)).command;
    await control.authorizeAction(installation,directAction.id);
    assert.equal((await control.acknowledge(installation,{commandId:directAction.id,status:'confirmed',facts:{profileMatched:true,
      profileKey:qaKey,pageReady:true,postUrls:[directPost],targetPostPresent:true,targetPostAuthoredByLead:true,viewerMatched:true,
      ownCommentPresent:true,commentTargetVerified:true,commentEditorVerified:true,commentPostcondition:true,diagnosticCode:'OK'}})).stage,'completed');
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.pay_ledger WHERE action_intent_id=$1',[directApproved.actionIntentId])).rows[0].n,1);
  }finally{
    if(previousQa===undefined)delete process.env.V2_QA_PROFILE_KEY;else process.env.V2_QA_PROFILE_KEY=previousQa;
    await control.setFlag('comment',false).catch(()=>{});
    if(ruleVersion!==null)await db.query('UPDATE callum_v2.pay_rules SET enabled=false WHERE version=$1',[ruleVersion]).catch(()=>{});
    if(previousConfig!==null)await control.activateConfig(previousConfig,'dev').catch(()=>{});
    await db.close();
  }
});
