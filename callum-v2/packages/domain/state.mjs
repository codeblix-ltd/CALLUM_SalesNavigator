export function decideObservation(mode, facts, isReconcile = false) {
  if (!facts.profileMatched || !facts.pageReady) return { stage: 'paused', event: 'browser_failure' };
  if (facts.pendingVisible) return { stage: 'completed', event: isReconcile ? 'connection_reconciled' : 'already_pending' };
  if (facts.connectedVisible) return { stage: 'completed', event: 'already_connected' };
  if (isReconcile) return { stage: 'paused', event: 'connection_not_observed' };
  if (!facts.connectAvailable) return { stage: 'paused', event: 'action_unavailable' };
  if (mode !== 'live_canary') return { stage: 'completed', event: 'shadow_would_connect' };
  return { stage: 'awaiting_action', event: 'connection_reserved' };
}

export function commandAfterLeaseExpiry(commandType) {
  return ['EXECUTE_CONNECT','EXECUTE_WITHDRAW','EXECUTE_COMMENT'].includes(commandType) ? 'reconcile_required' : 'retry_observation';
}

export function isPayable(intentState, eventType, rule) {
  return intentState === 'confirmed' && rule?.enabled === true && rule.event_type === eventType && Number.isSafeInteger(Number(rule.amount_minor));
}

export function deterministicLeadOrder(a, b) {
  return String(a.id).localeCompare(String(b.id));
}
