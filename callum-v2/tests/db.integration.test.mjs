import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../apps/control-plane/db.mjs';
import { ControlPlane } from '../apps/control-plane/service.mjs';

const enabled = process.env.V2_TEST_DB === '1' && !!process.env.COCKROACH_DATABASE_URL;
test('Cockroach V2 command lease, lost ACK, reconciliation, and duplicate pay invariant', { skip: !enabled }, async () => {
  const db=openDatabase();const s=new ControlPlane(db);
  const operatorId=`v2test_${randomUUID().slice(0,8)}`;
  const ruleVersion=Number(String(Date.now()).slice(-12));
  try {
    await s.seed();await s.createOperator(operatorId,'dev',5);
    const issued=await s.createInstallation(operatorId,'2.3.0','68f5971a');
    const install=await s.installation(issued.token);
    // A zero-amount rule verifies attribution without defining compensation.
    await db.query(`INSERT INTO callum_v2.pay_rules(version,event_type,amount_minor,currency,enabled)
      VALUES ($1,'connection_confirmed',0,'USD',true)`,[ruleVersion]);
    async function setup(suffix) {
      const leadId=randomUUID(),target=`callum-v2-fixture-${suffix}`;
      const run=(await db.query(`INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version)
        VALUES ($1,$2,'live_canary',1) RETURNING *`,[operatorId,install.id])).rows[0];
      const lead={id:leadId,profile_key:target,linkedin_url:`https://www.linkedin.com/in/${target}/`};
      await db.query(`INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)`,[run.id,leadId,target,lead.linkedin_url]);
      await db.tx(q=>s.enqueue(q,run,lead,'INSPECT_PROFILE',`fixture:${run.id}:${leadId}`));
      return {run,lead};
    }
    const first=await setup('lost-ack');
    const initial=await s.claim(install);
    assert.equal(initial.command.type,'INSPECT_PROFILE');
    const observed={profileMatched:true,profileKey:first.lead.profile_key,pageReady:true,connectAvailable:true,diagnosticCode:'OK'};
    assert.equal((await s.acknowledge(install,{commandId:initial.command.id,status:'observed',facts:observed})).stage,'awaiting_action');
    const action=await s.claim(install);assert.equal(action.command.type,'EXECUTE_CONNECT');
    assert.equal((await s.claim(install)).command,null,'leased action is not redelivered');
    assert.equal((await s.authorizeAction(install,action.command.id)).authorized,true);
    await assert.rejects(()=>s.authorizeAction(install,action.command.id),/ACTION_NOT_AUTHORIZED/);
    await db.query("UPDATE callum_v2.commands SET lease_expires_at=now()-INTERVAL '1 second' WHERE id=$1",[action.command.id]);
    const recovery=await s.claim(install);
    assert.equal(recovery.command.type,'INSPECT_PROFILE','expired action becomes observation only');
    assert.equal(recovery.command.payload.reconcile,true);
    const pending={...observed,pendingVisible:true,connectAvailable:false,diagnosticCode:'ALREADY_PENDING'};
    assert.equal((await s.acknowledge(install,{commandId:recovery.command.id,status:'observed',facts:pending})).stage,'completed');
    assert.equal((await s.acknowledge(install,{commandId:recovery.command.id,status:'observed',facts:pending})).duplicate,true);
    const one=(await db.query("SELECT count(*)::INT4 n FROM callum_v2.commands WHERE run_id=$1 AND type='EXECUTE_CONNECT'",[first.run.id])).rows[0].n;
    assert.equal(one,1);
    const state=(await db.query('SELECT state FROM callum_v2.action_intents WHERE run_id=$1',[first.run.id])).rows[0].state;
    assert.equal(state,'confirmed');
    const reconciledPay=await db.query(`SELECT e.event_type,l.pay_rule_version FROM callum_v2.pay_ledger l
      JOIN callum_v2.events e ON e.id=l.source_event_id WHERE l.run_id=$1`,[first.run.id]);
    assert.equal(reconciledPay.rows.length,1);
    assert.equal(reconciledPay.rows[0].event_type,'connection_confirmed');
    assert.equal(Number(reconciledPay.rows[0].pay_rule_version),ruleVersion);

    const second=await setup('pay');
    const inspect=await s.claim(install);
    await s.acknowledge(install,{commandId:inspect.command.id,status:'observed',facts:{...observed,profileKey:second.lead.profile_key}});
    const send=await s.claim(install);assert.equal(send.command.type,'EXECUTE_CONNECT');
    await s.authorizeAction(install,send.command.id);
    const confirmed={...pending,profileKey:second.lead.profile_key};
    assert.equal((await s.acknowledge(install,{commandId:send.command.id,status:'confirmed',facts:confirmed})).stage,'completed');
    assert.equal((await s.acknowledge(install,{commandId:send.command.id,status:'confirmed',facts:confirmed})).duplicate,true);
    const ledger=await db.query('SELECT count(*)::INT4 n, min(pay_rule_version)::INT8 AS version FROM callum_v2.pay_ledger WHERE run_id=$1',[second.run.id]);
    assert.equal(ledger.rows[0].n,1);assert.equal(Number(ledger.rows[0].version),ruleVersion);

    const third=await setup('not-submitted');
    const thirdInspect=await s.claim(install);
    await s.acknowledge(install,{commandId:thirdInspect.command.id,status:'observed',facts:{...observed,profileKey:third.lead.profile_key}});
    const thirdAction=await s.claim(install);
    await s.authorizeAction(install,thirdAction.command.id);
    const skipped=await s.acknowledge(install,{commandId:thirdAction.command.id,status:'not_submitted',facts:{...pending,profileKey:third.lead.profile_key}});
    assert.equal(skipped.stage,'completed');
    const notSent=(await db.query('SELECT state FROM callum_v2.action_intents WHERE run_id=$1',[third.run.id])).rows[0];
    assert.equal(notSent.state,'cancelled');
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.pay_ledger WHERE run_id=$1',[third.run.id])).rows[0].n,0);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.commands WHERE run_id=$1 AND idempotency_key LIKE 'reconcile:%'",[third.run.id])).rows[0].n,0);

    const fourth=await setup('late-queued');
    const fourthInspect=await s.claim(install);
    await s.acknowledge(install,{commandId:fourthInspect.command.id,status:'observed',facts:{...observed,profileKey:fourth.lead.profile_key}});
    const fourthAction=await s.claim(install);
    await s.authorizeAction(install,fourthAction.command.id);
    await db.query("UPDATE callum_v2.commands SET lease_expires_at=now()-INTERVAL '1 second' WHERE id=$1",[fourthAction.command.id]);
    await db.tx(q=>s.recoverExpired(q,operatorId));
    const queued=(await db.query("SELECT status FROM callum_v2.commands WHERE run_id=$1 AND idempotency_key LIKE 'reconcile:%'",[fourth.run.id])).rows[0];
    assert.equal(queued.status,'pending');
    await s.acknowledge(install,{commandId:fourthAction.command.id,status:'confirmed',facts:{...pending,profileKey:fourth.lead.profile_key}});
    const cancelled=(await db.query("SELECT status FROM callum_v2.commands WHERE run_id=$1 AND idempotency_key LIKE 'reconcile:%'",[fourth.run.id])).rows[0];
    assert.equal(cancelled.status,'cancelled','late confirmation cancels queued reconciliation');

    const fifth=await setup('late-leased');
    const fifthInspect=await s.claim(install);
    await s.acknowledge(install,{commandId:fifthInspect.command.id,status:'observed',facts:{...observed,profileKey:fifth.lead.profile_key}});
    const fifthAction=await s.claim(install);
    await s.authorizeAction(install,fifthAction.command.id);
    await db.query("UPDATE callum_v2.commands SET lease_expires_at=now()-INTERVAL '1 second' WHERE id=$1",[fifthAction.command.id]);
    const fifthReconcile=await s.claim(install);
    assert.equal(fifthReconcile.command.payload.reconcile,true);
    await s.acknowledge(install,{commandId:fifthAction.command.id,status:'confirmed',facts:{...pending,profileKey:fifth.lead.profile_key}});
    const staleResult=await s.acknowledge(install,{commandId:fifthReconcile.command.id,status:'observed',facts:{profileMatched:false,profileKey:fifth.lead.profile_key,pageReady:false,diagnosticCode:'PROFILE_MISMATCH'}});
    assert.equal(staleResult.stage,'completed','leased stale reconciliation cannot undo a confirmed intent');
    assert.equal((await db.query('SELECT stage FROM callum_v2.run_leads WHERE run_id=$1',[fifth.run.id])).rows[0].stage,'completed');
  } finally {
    await db.query('UPDATE callum_v2.pay_rules SET enabled=false WHERE version=$1',[ruleVersion]).catch(()=>{});
    await db.close();
  }
});
