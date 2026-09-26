import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../apps/control-plane/db.mjs';
import { ControlPlane } from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;
test('a scoped kill switch leaves later eligible read-only work claimable', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db);
  const operatorId=`v2flags_${randomUUID().slice(0,8)}`;
  let installationId=null,runId=null;
  try{
    await control.seed();
    await control.createOperator(operatorId,'dev',0);
    const issued=await control.createInstallation(operatorId,'2.5.2','e3a969d');
    installationId=issued.id;
    const installation=await control.installation(issued.token);
    const configVersion=Number((await db.query(`SELECT active_config_version FROM callum_v2.release_channels
      WHERE channel='dev'`)).rows[0].active_config_version);
    const run=(await db.query(`INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version)
      VALUES ($1,$2,'shadow',$3) RETURNING id`,[operatorId,installation.id,configVersion])).rows[0];
    runId=run.id;
    const blockedLead=randomUUID(),eligibleLead=randomUUID();
    const blockedKey=`qa-flag-${blockedLead.slice(0,8)}`;
    const eligibleKey=`qa-flag-${eligibleLead.slice(0,8)}`;
    for(const [leadId,key] of [[blockedLead,blockedKey],[eligibleLead,eligibleKey]]){
      await db.query(`INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url)
        VALUES ($1,$2,$3,$4)`,[runId,leadId,key,`https://www.linkedin.com/in/${key}/`]);
    }
    const blocked=await db.tx(q=>control.enqueue(q,{id:runId,operator_id:operatorId,config_version:configVersion},
      {id:blockedLead,profile_key:blockedKey,linkedin_url:'https://www.linkedin.com/mynetwork/invitation-manager/sent/'},
      'INSPECT_PENDING_INVITATION',`flag:${runId}:blocked`));
    const eligible=await db.tx(q=>control.enqueue(q,{id:runId,operator_id:operatorId,config_version:configVersion},
      {id:eligibleLead,profile_key:eligibleKey,linkedin_url:`https://www.linkedin.com/in/${eligibleKey}/`},
      'INSPECT_PROFILE',`flag:${runId}:eligible`));
    await db.query("UPDATE callum_v2.commands SET created_at=now()-INTERVAL '5 minutes' WHERE id=$1",[blocked.id]);
    await control.setFlag('withdrawal',true);
    const first=(await control.claim(installation)).command;
    assert.equal(first?.id,eligible.id,'later read-only work bypasses the scoped flag');
    assert.equal((await db.query('SELECT status FROM callum_v2.commands WHERE id=$1',[blocked.id])).rows[0].status,'pending');
    await control.setFlag('withdrawal',false);
    const resumed=(await control.claim(installation)).command;
    assert.equal(resumed?.id,blocked.id,'clearing the scoped flag restores the earlier command');
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.action_intents WHERE run_id=$1',[runId])).rows[0].n,0);
  }finally{
    await control.setFlag('withdrawal',false).catch(()=>{});
    if(runId)await control.pauseRun(runId).catch(()=>{});
    if(installationId)await control.revokeInstallation(installationId).catch(()=>{});
    await control.disableOperator(operatorId,true).catch(()=>{});
    await db.close();
  }
});
