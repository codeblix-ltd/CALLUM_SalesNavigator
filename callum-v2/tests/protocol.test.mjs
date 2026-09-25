import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertCommand, linkedInPostUrl, profileKeyFromUrl, sanitizeResult, PROTOCOL_VERSION } from '../packages/protocol/index.mjs';

const command=()=>({id:randomUUID(),runId:randomUUID(),leadId:randomUUID(),traceId:randomUUID(),operatorId:'antish',
  type:'INSPECT_PROFILE',targetProfileKey:'qa-test',targetUrl:'https://www.linkedin.com/in/qa-test/',configVersion:1,
  protocolVersion:PROTOCOL_VERSION,idempotencyKey:'initial:long-stable-key',expiresAt:new Date(Date.now()+60000).toISOString()});
test('protocol rejects stale, cross-site and incompatible commands',()=>{
  assert.doesNotThrow(()=>assertCommand(command()));
  assert.throws(()=>assertCommand({...command(),expiresAt:new Date(Date.now()-1000).toISOString()}),/COMMAND_EXPIRED/);
  assert.throws(()=>assertCommand({...command(),targetUrl:'https://example.com/in/qa-test/'}),/COMMAND_TARGET_INVALID/);
  assert.throws(()=>assertCommand({...command(),protocolVersion:999}),/COMMAND_VERSION_INVALID/);
  assert.throws(()=>assertCommand({...command(),type:'EXECUTE_CONNECT'}),/COMMAND_INTENT_MISSING/);
  const invitation={...command(),type:'INSPECT_PENDING_INVITATION',targetUrl:'https://www.linkedin.com/mynetwork/invitation-manager/sent/'};
  assert.doesNotThrow(()=>assertCommand(invitation));
  assert.throws(()=>assertCommand({...invitation,targetUrl:'https://www.linkedin.com/in/qa-test/'}),/COMMAND_TARGET_INVALID/);
  assert.throws(()=>assertCommand({...invitation,targetUrl:'https://www.linkedin.com/mynetwork/invitation-manager/sent/?x=1'}),/COMMAND_TARGET_INVALID/);
  assert.throws(()=>assertCommand({...invitation,type:'EXECUTE_WITHDRAW'}),/COMMAND_INTENT_MISSING/);
  assert.doesNotThrow(()=>assertCommand({...invitation,type:'EXECUTE_WITHDRAW',actionIntentId:randomUUID()}));
});
test('profile key normalization excludes unrelated hosts and paths',()=>{
  assert.equal(profileKeyFromUrl('https://www.linkedin.com/in/QA-Test/?trk=foo'),'qa-test');
  assert.equal(profileKeyFromUrl('https://evil.example/in/QA-Test/'),null);
  assert.equal(profileKeyFromUrl('https://www.linkedin.com/company/example/'),null);
});
test('result strips unneeded page content and unknown diagnostics',()=>{
  const x=sanitizeResult({commandId:randomUUID(),status:'observed',facts:{profileMatched:true,profileKey:'QA-Test',pageReady:true,wholePage:'private',diagnosticCode:'PASSWORD_DUMP'}});
  assert.equal(x.facts.profileKey,'qa-test');assert.equal(x.facts.diagnosticCode,'UNEXPECTED_BROWSER_STATE');
  assert.equal('wholePage' in x.facts,false);
});
test('post and contact facts are bounded to explicit LinkedIn evidence',()=>{
  const good='https://www.linkedin.com/feed/update/urn:li:activity:123456789';
  assert.equal(linkedInPostUrl(`${good}?tracking=1`),good);
  assert.equal(linkedInPostUrl('https://evil.example/posts/abc'),null);
  const result=sanitizeResult({commandId:randomUUID(),status:'observed',facts:{postUrls:[good,good,'https://evil.example/posts/abc'],contactEmail:'QA@Example.com',wholePage:'private'}});
  assert.deepEqual(result.facts.postUrls,[good]);
  assert.equal(result.facts.contactEmail,'qa@example.com');
  assert.equal('wholePage' in result.facts,false);
  const invitation=sanitizeResult({commandId:randomUUID(),status:'observed',facts:{invitationFound:true,invitationNameMatched:true,invitationAgeDays:32,invitationWithdrawAvailable:true,invitationText:'private'}});
  assert.equal(invitation.facts.invitationAgeDays,32);
  assert.equal('invitationText' in invitation.facts,false);
  const withdrawal=sanitizeResult({commandId:randomUUID(),status:'confirmed',facts:{withdrawalTargetVerified:true,withdrawalConfirmationOpened:true,withdrawalPostcondition:true,invitationAgeDays:35,wholePage:'private'}});
  assert.equal(withdrawal.facts.withdrawalPostcondition,true);
  assert.equal('wholePage' in withdrawal.facts,false);
});
