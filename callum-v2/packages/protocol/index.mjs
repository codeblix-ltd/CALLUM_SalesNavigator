export const PROTOCOL_VERSION = 1;
export const COMMAND_TYPES = new Set(['INSPECT_PROFILE', 'EXECUTE_CONNECT', 'INSPECT_COMMENT_STATE', 'EXTRACT_CONTACT_INFO']);
export const ACTION_TYPES = new Set(['EXECUTE_CONNECT']);
export const DIAGNOSTIC_CODES = new Set([
  'OK', 'PROFILE_MISMATCH', 'PAGE_HYDRATING', 'ACTION_UNAVAILABLE', 'ALREADY_PENDING',
  'ALREADY_CONNECTED', 'BACKEND_UNAVAILABLE', 'TAB_CLOSED', 'NAVIGATION_FAILED',
  'CONFIG_INVALID', 'CONFIG_INCOMPATIBLE', 'STORAGE_UNAVAILABLE', 'POSTCONDITION_UNKNOWN',
  'COMMAND_EXPIRED', 'KILL_SWITCH', 'UNEXPECTED_BROWSER_STATE', 'NO_RECENT_POSTS',
  'CONTACT_INFO_EMPTY'
]);

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const profile = /^[a-z0-9_%.-]{2,120}$/i;
export function assertCommand(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('COMMAND_INVALID');
  for (const key of ['id', 'runId', 'leadId', 'traceId']) if (!uuid.test(value[key] || '')) throw new Error('COMMAND_INVALID');
  if (!COMMAND_TYPES.has(value.type) || typeof value.operatorId !== 'string' || !value.operatorId) throw new Error('COMMAND_INVALID');
  if (!profile.test(value.targetProfileKey || '') || !isLinkedInProfileUrl(value.targetUrl)) throw new Error('COMMAND_TARGET_INVALID');
  if (!Number.isSafeInteger(value.configVersion) || value.protocolVersion !== PROTOCOL_VERSION) throw new Error('COMMAND_VERSION_INVALID');
  if (!uuid.test(value.actionIntentId || '') && ACTION_TYPES.has(value.type)) throw new Error('COMMAND_INTENT_MISSING');
  if (typeof value.idempotencyKey !== 'string' || value.idempotencyKey.length < 12 || value.idempotencyKey.length > 200) throw new Error('COMMAND_INVALID');
  if (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now) throw new Error('COMMAND_EXPIRED');
  return value;
}

export function isLinkedInProfileUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ['www.linkedin.com', 'linkedin.com'].includes(url.hostname) && /^\/in\/[a-z0-9_%.-]+\/?$/i.test(url.pathname);
  } catch { return false; }
}

export function profileKeyFromUrl(raw) {
  if (!isLinkedInProfileUrl(raw)) return null;
  return decodeURIComponent(new URL(raw).pathname.split('/')[2]).toLowerCase();
}

export function linkedInPostUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(url.hostname)) return null;
    if (!/^\/(?:feed\/update\/urn:li:activity:\d+|posts\/[a-z0-9_%.-]+)\/?$/i.test(url.pathname)) return null;
    return `https://www.linkedin.com${url.pathname.replace(/\/$/, '')}`;
  } catch { return null; }
}

export function sanitizeFacts(raw) {
  const x = raw && typeof raw === 'object' ? raw : {};
  const postUrls = Array.isArray(x.postUrls) ? [...new Set(x.postUrls.map(linkedInPostUrl).filter(Boolean))].slice(0, 5) : [];
  const contactEmail = typeof x.contactEmail === 'string' && x.contactEmail.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x.contactEmail) ? x.contactEmail.toLowerCase() : null;
  return {
    profileMatched: x.profileMatched === true,
    profileKey: profile.test(x.profileKey || '') ? x.profileKey.toLowerCase() : null,
    relationship: ['first', 'second', 'third', 'unknown'].includes(x.relationship) ? x.relationship : 'unknown',
    connectAvailable: x.connectAvailable === true,
    pendingVisible: x.pendingVisible === true,
    connectedVisible: x.connectedVisible === true,
    pageReady: x.pageReady === true,
    postUrls,
    targetPostPresent: x.targetPostPresent === true,
    commentBoxAvailable: x.commentBoxAvailable === true,
    contactInfoOpened: x.contactInfoOpened === true,
    contactEmail,
    diagnosticCode: DIAGNOSTIC_CODES.has(x.diagnosticCode) ? x.diagnosticCode : 'UNEXPECTED_BROWSER_STATE'
  };
}

export function sanitizeResult(raw) {
  if (!raw || typeof raw !== 'object' || !uuid.test(raw.commandId || '')) throw new Error('RESULT_INVALID');
  if (!['observed', 'confirmed', 'uncertain', 'not_submitted'].includes(raw.status)) throw new Error('RESULT_INVALID');
  return { commandId: raw.commandId, status: raw.status, facts: sanitizeFacts(raw.facts) };
}
