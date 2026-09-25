import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../apps/control-plane/db.mjs';
import { ControlPlane } from '../apps/control-plane/service.mjs';
import { DEFAULT_CONFIG } from '../packages/linkedin-config/index.mjs';

const enabled=process.env.V2_TEST_DB==='1' && !!process.env.COCKROACH_DATABASE_URL;
test('read-only inspections preserve lead stage and scope contact email', {skip:!enabled}, async()=>{
  const db=openDatabase(),control=new ControlPlane(db);
  const operatorId=`v2inspect_${randomUUID().slice(0,8)}`;
  const previousQa=process.env.V2_QA_PROFILE_KEY;
  let previousConfig=null;
  try {
    await control.seed();
    previousConfig=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    await control.createOperator(operatorId,'dev',0);
    const issued=await control.createInstallation(operatorId,'2.1.0','b820d227');
    const installation=await control.installation(issued.token);
    const draft=await control.createConfig(DEFAULT_CONFIG,'2.1.0');
    const version=Number(draft.version);
    await control.activateConfig(version,'dev');
    const legacy=await control.createInstallation(operatorId,'2.0.0','b820d227');
    const legacyInstallation=await control.installation(legacy.token);
    await assert.rejects(()=>control.claim(legacyInstallation),/CONFIG_INCOMPATIBLE/);
    async function fixture(mode,key) {
      const leadId=randomUUID();
      const run=(await db.query(`INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version)
        VALUES ($1,$2,$3,$4) RETURNING id`,[operatorId,installation.id,mode,version])).rows[0];
      await db.query(`INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url,full_name)
        VALUES ($1,$2,$3,$4,'QA Test')`,[run.id,leadId,key,`https://www.linkedin.com/in/${key}/`]);
      return {runId:run.id,leadId,key};
    }
    const shadow=await fixture('shadow','qa-inspection-test');
    await assert.rejects(()=>control.queueInspection({...shadow,type:'EXTRACT_CONTACT_INFO'}),/QA_RECIPIENT_REQUIRED/);
    const post='https://www.linkedin.com/feed/update/urn:li:activity:123456789';
    const queued=await control.queueInspection({...shadow,type:'INSPECT_COMMENT_STATE',postUrl:post});
    assert.equal(queued.type,'INSPECT_COMMENT_STATE');
    const claimed=await control.claim(installation);
    assert.equal(claimed.command.type,'INSPECT_COMMENT_STATE');
    assert.equal(claimed.command.payload.postUrl,post);
    const result=await control.acknowledge(installation,{commandId:claimed.command.id,status:'observed',facts:{
      profileMatched:true,profileKey:shadow.key,pageReady:true,connectAvailable:true,
      postUrls:[post,'https://evil.example/posts/no'],targetPostPresent:true,commentBoxAvailable:true,
      contactEmail:'should-not-store@example.com',diagnosticCode:'OK'}});
    assert.equal(result.stage,'awaiting_observation');
    assert.equal((await db.query('SELECT count(*)::INT4 n FROM callum_v2.action_intents WHERE run_id=$1',[shadow.runId])).rows[0].n,0);
    const commentFacts=(await db.query('SELECT facts FROM callum_v2.observations WHERE command_id=$1',[claimed.command.id])).rows[0].facts;
    assert.deepEqual(commentFacts.postUrls,[post]);
    assert.equal(commentFacts.contactEmail,null);
    const mismatchedPost=await fixture('shadow','qa-inspection-mismatch');
    const otherPost='https://www.linkedin.com/feed/update/urn:li:activity:987654321';
    await control.queueInspection({...mismatchedPost,type:'INSPECT_COMMENT_STATE',postUrl:otherPost});
    const mismatchedClaim=await control.claim(installation);
    await control.acknowledge(installation,{commandId:mismatchedClaim.command.id,status:'observed',facts:{
      profileMatched:true,profileKey:mismatchedPost.key,pageReady:true,postUrls:[post],targetPostPresent:true,diagnosticCode:'OK'}});
    const mismatchedFacts=(await db.query('SELECT facts FROM callum_v2.observations WHERE command_id=$1',[mismatchedClaim.command.id])).rows[0].facts;
    assert.equal(mismatchedFacts.targetPostPresent,false);

    process.env.V2_QA_PROFILE_KEY=shadow.key;
    const canary=await fixture('live_canary',shadow.key);
    const contact=await control.queueInspection({...canary,type:'EXTRACT_CONTACT_INFO'});
    assert.equal(contact.type,'EXTRACT_CONTACT_INFO');
    await control.setFlag('contact',true);
    assert.equal((await control.claim(installation)).command,null);
    await control.setFlag('contact',false);
    const contactClaim=await control.claim(installation);
    assert.equal(contactClaim.command.type,'EXTRACT_CONTACT_INFO');
    const contactResult=await control.acknowledge(installation,{commandId:contactClaim.command.id,status:'observed',facts:{
      profileMatched:true,profileKey:canary.key,pageReady:true,contactInfoOpened:true,
      contactEmail:'QA@Example.com',postUrls:[post],diagnosticCode:'OK'}});
    assert.equal(contactResult.stage,'awaiting_observation');
    const stored=(await db.query('SELECT facts FROM callum_v2.observations WHERE command_id=$1',[contactClaim.command.id])).rows[0].facts;
    assert.equal(stored.contactEmail,'qa@example.com');
    assert.deepEqual(stored.postUrls,[]);
    const overview=await control.overview();
    assert.equal(overview.observations.some(row=>row.command_id===contactClaim.command.id && row.contact_email_present===true),true);
    assert.equal(JSON.stringify(overview.observations).includes('qa@example.com'),false);
    const uncertain=await fixture('live_canary',shadow.key);
    await control.queueInspection({...uncertain,type:'EXTRACT_CONTACT_INFO'});
    const uncertainClaim=await control.claim(installation);
    await control.acknowledge(installation,{commandId:uncertainClaim.command.id,status:'uncertain',facts:{
      profileMatched:true,profileKey:uncertain.key,pageReady:true,contactInfoOpened:true,
      contactEmail:'forged@example.com',diagnosticCode:'POSTCONDITION_UNKNOWN'}});
    const uncertainFacts=(await db.query('SELECT facts FROM callum_v2.observations WHERE command_id=$1',[uncertainClaim.command.id])).rows[0].facts;
    assert.equal(uncertainFacts.contactEmail,null);
  } finally {
    if(previousQa===undefined)delete process.env.V2_QA_PROFILE_KEY;else process.env.V2_QA_PROFILE_KEY=previousQa;
    await control.setFlag('contact',false).catch(()=>{});
    if(previousConfig!==null)await control.activateConfig(previousConfig,'dev').catch(()=>{});
    await db.close();
  }
});
