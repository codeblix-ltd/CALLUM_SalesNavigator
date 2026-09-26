import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('an expired inspection backlog drains across bounded claims', {skip:!enabled,timeout:180000},async()=>{
  const db=openDatabase(),control=new ControlPlane(db);
  const operatorId=`v2recovery_${randomUUID().slice(0,8)}`;
  let runId=null;
  try{
    await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.5.2','8e180901');
    const installation=await control.installation(issued.token);
    const configVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'"))
      .rows[0].active_config_version);
    const run=(await db.query(`INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version)
      VALUES ($1,$2,'synthetic',$3) RETURNING id,operator_id,config_version`,
      [operatorId,issued.id,configVersion])).rows[0];
    runId=run.id;
    await db.tx(async q=>{
      for(let i=0;i<10;i++){
        const leadId=randomUUID(),profileKey=`qa-recovery-${i}-${leadId.slice(0,8)}`;
        const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
        await q.query(`INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url)
          VALUES ($1,$2,$3,$4)`,[run.id,lead.id,lead.profile_key,lead.linkedin_url]);
        await control.enqueue(q,run,lead,'INSPECT_PROFILE',`recovery-batch:${run.id}:${i}`);
      }
    });
    await db.query("UPDATE callum_v2.commands SET expires_at=now()-INTERVAL '1 second' WHERE run_id=$1",[run.id]);
    assert.equal((await control.expiredCommandIds(db,operatorId)).length,8);

    const first=await control.claim(installation);
    assert.equal(first.command?.type,'INSPECT_PROFILE');
    const untouched=(await db.query(`SELECT id FROM callum_v2.commands
      WHERE run_id=$1 AND status='pending' AND expires_at<now() ORDER BY id`,[run.id])).rows;
    assert.equal(untouched.length,2,'two expired commands remain after the first bounded recovery');
    // Simulate sparse polls: the renewed first batch has expired again. The two
    // untouched commands have older effective expiries and must not starve.
    await db.query(`UPDATE callum_v2.commands SET expires_at=now()-INTERVAL '1 second'
      WHERE run_id=$1 AND status='pending' AND expires_at>now()`,[run.id]);

    const second=await control.claim(installation);
    assert.equal(second.command?.type,'INSPECT_PROFILE');
    assert.notEqual(second.command.id,first.command.id);
    const stillUntouched=(await db.query(`SELECT count(*)::INT4 AS n FROM callum_v2.commands
      WHERE id IN ($1,$2) AND status='pending' AND expires_at<now()`,untouched.map(x=>x.id))).rows[0].n;
    assert.equal(stillUntouched,0,'the original backlog is recovered before re-expired work');
    const third=await control.claim(installation);
    assert.equal(third.command?.type,'INSPECT_PROFILE');
    assert.notEqual(third.command.id,second.command.id);
    const afterThird=(await db.query(`SELECT
      count(*) FILTER (WHERE status='pending' AND expires_at<now())::INT4 AS expired,
      count(*) FILTER (WHERE status='leased')::INT4 AS leased,
      count(*) FILTER (WHERE type LIKE 'EXECUTE_%')::INT4 AS actions
      FROM callum_v2.commands WHERE run_id=$1`,[run.id])).rows[0];
    assert.equal(afterThird.expired,0);
    assert.equal(afterThird.leased,3);
    assert.equal(afterThird.actions,0);
    assert.equal((await db.query('SELECT count(*)::INT4 AS n FROM callum_v2.action_intents WHERE run_id=$1',[run.id])).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::INT4 AS n FROM callum_v2.pay_ledger WHERE run_id=$1',[run.id])).rows[0].n,0);
  }finally{
    if(runId)await db.query("UPDATE callum_v2.runs SET status='paused',updated_at=now() WHERE id=$1 AND status='running'",[runId]).catch(()=>{});
    await db.query('UPDATE callum_v2.operators SET enabled=false WHERE id=$1',[operatorId]).catch(()=>{});
    await db.close();
  }
});
