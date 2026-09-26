import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('separate control-plane instances lease and authorize one action once', {skip:!enabled},async()=>{
  const firstDb=openDatabase(),secondDb=openDatabase();
  const first=new ControlPlane(firstDb),second=new ControlPlane(secondDb);
  const operatorId=`v2claim_${randomUUID().slice(0,8)}`;
  const actorKey=`qa-actor-${randomUUID().slice(0,8)}`;
  const previousQa=process.env.V2_QA_PROFILE_KEY;
  try{
    await first.seed();
    await first.createOperator(operatorId,'dev',1);
    const issued=await first.createInstallation(operatorId,'2.5.1','e439fb3',`https://www.linkedin.com/in/${actorKey}/`);
    const installation=await first.installation(issued.token);
    const configVersion=Number((await firstDb.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const leadId=randomUUID(),profileKey=`qa-multi-claim-${leadId.slice(0,8)}`;
    process.env.V2_QA_PROFILE_KEY=profileKey;
    const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
    const run=(await firstDb.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
      [operatorId,installation.id,configVersion])).rows[0];
    await firstDb.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
      [run.id,leadId,profileKey,lead.linkedin_url]);
    await firstDb.tx(q=>first.enqueue(q,{id:run.id,operator_id:operatorId,config_version:configVersion},lead,
      'INSPECT_PROFILE',`multi-claim:${run.id}`,null,{actorProfileKey:actorKey}));

    const firstClaims=await Promise.all([first.claim(installation),second.claim(installation)]);
    const inspections=firstClaims.map(x=>x.command).filter(Boolean);
    assert.equal(inspections.length,1,'one instance leases the inspection');
    assert.equal(inspections[0].type,'INSPECT_PROFILE');
    await first.acknowledge(installation,{commandId:inspections[0].id,status:'observed',facts:{
      profileMatched:true,profileKey,pageReady:true,viewerMatched:true,connectAvailable:true,diagnosticCode:'OK'}});

    const actionClaims=await Promise.all([first.claim(installation),second.claim(installation)]);
    const actions=actionClaims.map(x=>x.command).filter(Boolean);
    assert.equal(actions.length,1,'one instance leases the action');
    assert.equal(actions[0].type,'EXECUTE_CONNECT');
    const action=actions[0];
    const authorizations=await Promise.allSettled([
      first.authorizeAction(installation,action.id),second.authorizeAction(installation,action.id)
    ]);
    assert.equal(authorizations.filter(x=>x.status==='fulfilled'&&x.value.authorized).length,1);
    assert.equal(authorizations.filter(x=>x.status==='rejected'&&x.reason.message==='ACTION_NOT_AUTHORIZED').length,1);
    assert.equal((await firstDb.query("SELECT count(*)::INT4 n FROM callum_v2.events WHERE run_id=$1 AND event_type='connection_authorized'",[run.id])).rows[0].n,1);

    await firstDb.query("UPDATE callum_v2.commands SET lease_expires_at=now()-INTERVAL '1 second' WHERE id=$1",[action.id]);
    const recoveryClaims=await Promise.all([first.claim(installation),second.claim(installation)]);
    const recovery=recoveryClaims.map(x=>x.command).filter(Boolean);
    assert.equal(recovery.length,1,'one instance leases reconciliation');
    assert.equal(recovery[0].type,'INSPECT_PROFILE');
    assert.equal(recovery[0].payload.reconcile,true);
    assert.equal((await firstDb.query("SELECT count(*)::INT4 n FROM callum_v2.commands WHERE run_id=$1 AND type='EXECUTE_CONNECT'",[run.id])).rows[0].n,1);
    assert.equal((await firstDb.query("SELECT count(*)::INT4 n FROM callum_v2.command_attempts WHERE command_id=$1",[action.id])).rows[0].n,1);
  }finally{
    if(previousQa===undefined)delete process.env.V2_QA_PROFILE_KEY;else process.env.V2_QA_PROFILE_KEY=previousQa;
    await firstDb.close();
    await secondDb.close();
  }
});
