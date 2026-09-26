import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane,CURRENT_EXTENSION_VERSION} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('claim does not lease a command that expires after its row is locked',
  {skip:!enabled,timeout:120000},async()=>{
    const db=openDatabase(),control=new ControlPlane(db),operatorId=`v2expiry_${randomUUID().slice(0,8)}`;
    let installationId=null,runId=null;
    try{
      await control.seed();
      await control.createOperator(operatorId,'dev',0);
      const issued=await control.createInstallation(operatorId,CURRENT_EXTENSION_VERSION,'3677576');
      installationId=issued.id;
      const installation=await control.installation(issued.token);
      const configVersion=Number((await db.query(`SELECT active_config_version FROM callum_v2.release_channels
        WHERE channel='dev'`)).rows[0].active_config_version);
      const run=(await db.query(`INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version)
        VALUES ($1,$2,'synthetic',$3) RETURNING id`,[operatorId,installation.id,configVersion])).rows[0];
      runId=run.id;
      const leadId=randomUUID(),profileKey=`qa-expiry-${leadId.slice(0,8)}`;
      const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
      await db.query(`INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url)
        VALUES ($1,$2,$3,$4)`,[run.id,leadId,profileKey,lead.linkedin_url]);
      const pending=await db.tx(q=>control.enqueue(q,{id:run.id,operator_id:operatorId,config_version:configVersion},
        lead,'INSPECT_PROFILE',`expiry:${run.id}`));
      await db.query("UPDATE callum_v2.commands SET expires_at=statement_timestamp()+INTERVAL '15 seconds' WHERE id=$1",[pending.id]);

      let held=false;
      const delayed=new ControlPlane({...db,tx:fn=>db.tx(q=>fn({query:async(sql,args)=>{
        if(!held&&sql.includes('SELECT count(*)::INT4 AS n FROM callum_v2.command_attempts')){
          held=true;
          const remaining=Number((await q.query(`SELECT extract(epoch FROM (expires_at-statement_timestamp()))*1000 AS ms
            FROM callum_v2.commands WHERE id=$1`,[pending.id])).rows[0].ms);
          assert.ok(remaining>0,'candidate was locked before expiry');
          await delay(Math.ceil(remaining)+400);
          const expired=(await q.query(`SELECT expires_at<statement_timestamp() AS expired
            FROM callum_v2.commands WHERE id=$1`,[pending.id])).rows[0].expired;
          assert.equal(expired,true,'command expired while claim held its row lock');
        }
        return q.query(sql,args);
      }}))});
      delayed.expiredCommandIds=async()=>[];
      delayed.pendingCandidate=async()=>({id:pending.id});
      const claimed=await delayed.claim(installation);
      assert.equal(held,true);
      assert.equal(claimed.command,null);
      const state=(await db.query(`SELECT status,installation_id,lease_expires_at FROM callum_v2.commands
        WHERE id=$1`,[pending.id])).rows[0];
      assert.equal(state.status,'pending');
      assert.equal(state.installation_id,null);
      assert.equal(state.lease_expires_at,null);
      assert.equal((await db.query(`SELECT count(*)::INT4 AS n FROM callum_v2.command_attempts
        WHERE command_id=$1`,[pending.id])).rows[0].n,0);
    }finally{
      if(runId)await control.pauseRun(runId).catch(()=>{});
      if(installationId)await control.revokeInstallation(installationId).catch(()=>{});
      await control.disableOperator(operatorId,true).catch(()=>{});
      await db.close();
    }
  });
