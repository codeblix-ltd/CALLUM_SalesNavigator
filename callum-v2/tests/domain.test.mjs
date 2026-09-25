import test from 'node:test';
import assert from 'node:assert/strict';
import { decideObservation, commandAfterLeaseExpiry, isPayable, deterministicLeadOrder } from '../packages/domain/state.mjs';

const ready = { profileMatched:true, pageReady:true, connectAvailable:true, pendingVisible:false, connectedVisible:false };
test('shadow chooses decisions without creating an action', () => {
  assert.deepEqual(decideObservation('shadow',ready), { stage:'completed', event:'shadow_would_connect' });
  assert.deepEqual(decideObservation('synthetic',ready), { stage:'completed', event:'shadow_would_connect' });
});
test('live action needs fresh matched state and pending never clicks', () => {
  assert.deepEqual(decideObservation('live_canary',ready), { stage:'awaiting_action', event:'connection_reserved' });
  assert.equal(decideObservation('live_canary',{...ready,profileMatched:false}).stage,'paused');
  assert.equal(decideObservation('live_canary',{...ready,pendingVisible:true}).event,'already_pending');
  assert.equal(decideObservation('live_canary',{...ready,connectedVisible:true}).event,'already_connected');
  assert.equal(decideObservation('live_canary',{...ready,connectAvailable:false}).stage,'paused');
});
test('uncertain action leases reconcile by observation and absent outcome pauses', () => {
  assert.equal(commandAfterLeaseExpiry('EXECUTE_CONNECT'),'reconcile_required');
  assert.equal(commandAfterLeaseExpiry('INSPECT_PROFILE'),'retry_observation');
  assert.equal(decideObservation('live_canary',ready,true).stage,'paused');
  assert.equal(decideObservation('live_canary',{...ready,pendingVisible:true},true).event,'connection_reconciled');
});
test('pay requires a confirmed intent and a versioned enabled rule', () => {
  const rule={enabled:true,event_type:'connection_confirmed',amount_minor:123,currency:'USD',version:7};
  assert.equal(isPayable('confirmed','connection_confirmed',rule),true);
  for (const state of ['reserved','submitted','reconcile_required','not_observed']) assert.equal(isPayable(state,'connection_confirmed',rule),false);
  assert.equal(isPayable('confirmed','connection_confirmed',{...rule,enabled:false}),false);
});
test('selection order is deterministic', () => {
  assert.deepEqual([{id:'c'},{id:'a'},{id:'b'}].sort(deterministicLeadOrder).map(x=>x.id),['a','b','c']);
});
