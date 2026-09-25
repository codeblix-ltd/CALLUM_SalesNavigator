import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../apps/control-plane/db.mjs';
import { ControlPlane } from '../apps/control-plane/service.mjs';
import { DEFAULT_CONFIG } from '../packages/linkedin-config/index.mjs';

const enabled=process.env.V2_TEST_DB==='1' && !!process.env.COCKROACH_DATABASE_URL;
test('withdrawal intent authorizes once and uncertainty only reconciles by observation', {skip:!enabled}, async()=>{
  const db=openDatabase(),control=new ControlPlane(db);
  const operatorId=`v2withdraw_${randomUUID().slice(0,8)}`;
  const qaKey='qa-withdraw-fixture';
  const previousQa=process.env.V2_QA_PROFILE_KEY;
  let previousConfig=null;
  try {
    await control.seed();
    previousConfig=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    await control.createOperator(operatorId,'dev',0);
    const issued=await control.createInstallation(operatorId,'2.4.0','25cf3adf');
    const installation=await control.installation(issued.token);
    const draft=await control.createConfig(DEFAULT_CONFIG,'2.4.0');
    const version=Number(draft.version);
    await control.activateConfig(version,'dev');
    process.env.V2_QA_PROFILE_KEY=qaKey;
    async function fixture(ageDays) {
      const leadId=randomUUID();
      const run=(await db.query(`INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version)
        VALUES ($1,$2,'live_canary',$3) RETURNING id`,[operatorId,installation.id,version])).rows[0];
      await db.query(`INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url,full_name)
        VALUES ($1,$2,$3,$4,'QA Test')`,[run.id,leadId,qaKey,`https://www.linkedin.com/in/${qaKey}/`]);
      const inspected=await control.queueInspection({runId:run.id,leadId,type:'INSPECT_PENDING_INVITATION'});
      const claimed=await control.claim(installation);
      assert.equal(claimed.command.id,inspected.id);
      await control.acknowledge(installation,{commandId:inspected.id,status:'observed',facts:{
        profileMatched:true,profileKey:qaKey,pageReady:true,invitationFound:true,invitationNameMatched:true,
        invitationWithdrawAvailable:true,invitationAgeDays:ageDays,diagnosticCode:'OK'}});
      return {runId:run.id,leadId,inspectionCommandId:inspected.id};
    }
    const first=await fixture(35);
    const queued=await control.queueWithdrawal(first);
    assert.equal(queued.type,'EXECUTE_WITHDRAW');
    await control.setFlag('withdrawal',true);
    assert.equal((await control.claim(installation)).command,null);
    await control.setFlag('withdrawal',false);
    const action=await control.claim(installation);
    assert.equal(action.command.id,queued.id);
    assert.equal(action.command.targetUrl,'https://www.linkedin.com/mynetwork/invitation-manager/sent/');
    assert.equal((await control.claim(installation)).command,null);
    assert.equal((await control.authorizeAction(installation,queued.id)).authorized,true);
    await assert.rejects(()=>control.authorizeAction(installation,queued.id),/ACTION_NOT_AUTHORIZED/);
    const confirmation={profileMatched:true,profileKey:qaKey,pageReady:true,invitationFound:false,invitationNameMatched:true,
      invitationAgeDays:35,withdrawalTargetVerified:true,withdrawalConfirmationOpened:true,
      withdrawalPostcondition:true,diagnosticCode:'OK'};
    assert.equal((await control.acknowledge(installation,{commandId:queued.id,status:'confirmed',facts:confirmation})).stage,'completed');
    assert.equal((await control.acknowledge(installation,{commandId:queued.id,status:'confirmed',facts:confirmation})).duplicate,true);
    await assert.rejects(()=>control.queueWithdrawal(first),/WITHDRAWAL_ALREADY_RESERVED/);
    assert.equal((await db.query('SELECT state FROM callum_v2.action_intents WHERE run_id=$1',[first.runId])).rows[0].state,'confirmed');
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.pay_ledger WHERE run_id=$1',[first.runId])).rows[0].n,0);

    const young=await fixture(29);
    await assert.rejects(()=>control.queueWithdrawal(young),/WITHDRAWAL_PRECONDITION_FAILED/);
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.action_intents WHERE run_id=$1',[young.runId])).rows[0].n,0);

    const lost=await fixture(45);
    const lostQueue=await control.queueWithdrawal(lost);
    const lostAction=await control.claim(installation);
    assert.equal(lostAction.command.id,lostQueue.id);
    await control.authorizeAction(installation,lostQueue.id);
    await db.query("UPDATE callum_v2.commands SET lease_expires_at=now()-INTERVAL '1 second' WHERE id=$1",[lostQueue.id]);
    const reconcile=await control.claim(installation);
    assert.equal(reconcile.command.type,'INSPECT_PENDING_INVITATION');
    assert.equal(reconcile.command.payload.reconcile,true);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.commands WHERE run_id=$1 AND type='EXECUTE_WITHDRAW'",[lost.runId])).rows[0].n,1);
    assert.equal((await control.acknowledge(installation,{commandId:reconcile.command.id,status:'observed',facts:{
      profileMatched:false,profileKey:null,pageReady:true,invitationFound:false,diagnosticCode:'INVITATION_NOT_FOUND'}})).stage,'paused');
    assert.equal((await db.query('SELECT state FROM callum_v2.action_intents WHERE run_id=$1',[lost.runId])).rows[0].state,'reconcile_required');
    assert.equal((await control.acknowledge(installation,{commandId:lostQueue.id,status:'confirmed',facts:{...confirmation,invitationAgeDays:45}})).stage,'completed');
    assert.equal((await db.query('SELECT stage FROM callum_v2.run_leads WHERE run_id=$1',[lost.runId])).rows[0].stage,'completed');
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.commands WHERE run_id=$1 AND type='EXECUTE_WITHDRAW'",[lost.runId])).rows[0].n,1);

    const stopped=await fixture(40);
    const stoppedQueue=await control.queueWithdrawal(stopped);
    const stoppedClaim=await control.claim(installation);
    assert.equal(stoppedClaim.command.id,stoppedQueue.id);
    await control.setFlag('withdrawal',true);
    await assert.rejects(()=>control.authorizeAction(installation,stoppedQueue.id),/ACTION_NOT_AUTHORIZED/);
    assert.equal((await control.acknowledge(installation,{commandId:stoppedQueue.id,status:'not_submitted',facts:{
      profileMatched:true,profileKey:qaKey,pageReady:true,invitationFound:true,invitationNameMatched:true,
      invitationWithdrawAvailable:true,invitationAgeDays:40,diagnosticCode:'KILL_SWITCH'}})).stage,'paused');
    await control.setFlag('withdrawal',false);
    assert.equal((await db.query('SELECT state FROM callum_v2.action_intents WHERE run_id=$1',[stopped.runId])).rows[0].state,'cancelled');
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.events WHERE run_id=$1 AND event_type='withdrawal_authorized'",[stopped.runId])).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.pay_ledger WHERE run_id=$1',[stopped.runId])).rows[0].n,0);
  } finally {
    if(previousQa===undefined)delete process.env.V2_QA_PROFILE_KEY;else process.env.V2_QA_PROFILE_KEY=previousQa;
    await control.setFlag('withdrawal',false).catch(()=>{});
    if(previousConfig!==null)await control.activateConfig(previousConfig,'dev').catch(()=>{});
    await db.close();
  }
});
