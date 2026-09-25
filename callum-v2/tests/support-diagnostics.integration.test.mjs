import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('support can trace failures and reconciliation without receiving a contact email', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db),operatorId=`v2support_${randomUUID().slice(0,8)}`;
  const previousQa=process.env.V2_QA_PROFILE_KEY,profileKey=`qa-support-${randomUUID().slice(0,8)}`;
  const actorKey=`qa-actor-${randomUUID().slice(0,8)}`;
  try{
    await control.seed();await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.5.1','0cb9a83',`https://www.linkedin.com/in/${actorKey}/`);
    const installation=await control.installation(issued.token);
    process.env.V2_QA_PROFILE_KEY=profileKey;
    const version=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    async function fixture(){
      const leadId=randomUUID(),run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
        [operatorId,installation.id,version])).rows[0];
      const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
      await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
        [run.id,leadId,profileKey,lead.linkedin_url]);
      return {run,lead};
    }
    const observed=await fixture();
    await db.tx(q=>control.enqueue(q,{id:observed.run.id,operator_id:operatorId,config_version:version},observed.lead,
      'INSPECT_PROFILE',`support:${observed.run.id}`));
    const profile=(await control.claim(installation)).command;
    assert.equal((await control.acknowledge(installation,{commandId:profile.id,status:'observed',facts:{
      profileMatched:false,profileKey,pageReady:false,diagnosticCode:'PROFILE_MISMATCH'}})).stage,'paused');

    const contact=await control.queueInspection({runId:observed.run.id,leadId:observed.lead.id,type:'EXTRACT_CONTACT_INFO'});
    assert.equal((await control.claim(installation)).command.id,contact.id);
    await control.acknowledge(installation,{commandId:contact.id,status:'observed',facts:{
      profileMatched:true,profileKey,pageReady:true,contactInfoOpened:true,
      contactEmail:'sensitive-fixture@example.com',diagnosticCode:'OK'}});
    assert.equal((await db.query('SELECT facts FROM callum_v2.observations WHERE command_id=$1',[contact.id])).rows[0].facts.contactEmail,
      'sensitive-fixture@example.com');
    await db.tx(q=>control.diagnostic(q,installation,{id:contact.id,run_id:observed.run.id,lead_id:observed.lead.id,action_intent_id:null},
      'privacy_probe','OK'));

    const actionFixture=await fixture();
    await db.tx(q=>control.enqueue(q,{id:actionFixture.run.id,operator_id:operatorId,config_version:version},actionFixture.lead,
      'INSPECT_PROFILE',`support-action:${actionFixture.run.id}`,null,{expectedName:'QA Fixture',actorProfileKey:actorKey}));
    const preflight=(await control.claim(installation)).command;
    await control.acknowledge(installation,{commandId:preflight.id,status:'observed',facts:{
      profileMatched:true,profileKey,pageReady:true,viewerMatched:true,connectAvailable:true,diagnosticCode:'OK'}});
    const action=(await control.claim(installation)).command;
    const intent={id:action.actionIntentId};
    assert.equal((await control.authorizeAction(installation,action.id)).authorized,true);
    assert.equal((await control.acknowledge(installation,{commandId:action.id,status:'uncertain',facts:{
      profileMatched:true,profileKey,pageReady:true,viewerMatched:true,diagnosticCode:'POSTCONDITION_UNKNOWN'}})).stage,'reconcile_required');

    const diagnostics=(await control.overview()).diagnostics;
    const failure=diagnostics.find(row=>row.command_id===profile.id && row.stage==='observation');
    assert.ok(failure);
    assert.equal(failure.operator_id,operatorId);
    assert.equal(failure.run_id,observed.run.id);
    assert.equal(failure.lead_id,observed.lead.id);
    assert.equal(failure.trace_id,profile.traceId);
    assert.equal(failure.installation_id,installation.id);
    assert.equal(failure.extension_version,'2.5.1');
    assert.equal(failure.build_sha,'0cb9a83');
    assert.equal(Number(failure.config_version),version);
    assert.equal(failure.command_type,'INSPECT_PROFILE');
    assert.equal(failure.command_status,'completed');
    assert.equal(failure.lead_stage,'paused');
    assert.equal(failure.attempt_count,1);
    assert.equal(failure.profile_matched,'false');
    assert.equal(failure.page_ready,'false');
    const privacy=diagnostics.find(row=>row.command_id===contact.id && row.stage==='privacy_probe');
    assert.ok(privacy);
    assert.equal(privacy.contact_email_present,true);
    assert.equal(JSON.stringify(privacy).includes('sensitive-fixture@example.com'),false);
    const uncertain=diagnostics.find(row=>row.command_id===action.id && row.stage==='action');
    assert.ok(uncertain);
    assert.equal(uncertain.action_intent_id,intent.id);
    assert.equal(uncertain.intent_state,'reconcile_required');
    assert.equal(uncertain.reconciliation_status,'pending');
    assert.equal(uncertain.attempt_count,1);
    assert.equal(uncertain.code,'POSTCONDITION_UNKNOWN');
  }finally{
    if(previousQa===undefined)delete process.env.V2_QA_PROFILE_KEY;else process.env.V2_QA_PROFILE_KEY=previousQa;
    await db.close();
  }
});
