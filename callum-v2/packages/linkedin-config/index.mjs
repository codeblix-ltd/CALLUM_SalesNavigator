const allowedKeys = new Set(['profileHeading', 'actionScope', 'connect', 'more', 'pending', 'connected', 'labels', 'degree', 'waitMs']);
const allowedSelectorKeys = new Set(['profileHeading', 'actionScope', 'connect', 'more', 'pending', 'connected']);
const unsafeSelector = /[{};\\]|:has\(|:contains\(|script|iframe|input\[type=.password/i;
export function validateConfig(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(k => !allowedKeys.has(k))) throw new Error('CONFIG_INVALID');
  for (const key of allowedSelectorKeys) {
    const list = x[key];
    if (!Array.isArray(list) || list.length < 1 || list.length > 12 || list.some(s => typeof s !== 'string' || s.length > 180 || !s.length || unsafeSelector.test(s))) throw new Error('CONFIG_INVALID');
  }
  for (const key of ['degree']) {
    if (!Array.isArray(x[key]) || x[key].length !== 3 || x[key].some(s => typeof s !== 'string' || s.length > 24)) throw new Error('CONFIG_INVALID');
  }
  if (!x.labels || typeof x.labels !== 'object' || Array.isArray(x.labels) || Object.keys(x.labels).some(k => !['connect','more','pending','connected','send'].includes(k))) throw new Error('CONFIG_INVALID');
  for (const key of ['connect','more','pending','connected','send']) {
    const list = x.labels[key];
    if (!Array.isArray(list) || list.length < 1 || list.length > 12 || list.some(s => typeof s !== 'string' || s.length < 2 || s.length > 40 || /[<>]/.test(s))) throw new Error('CONFIG_INVALID');
  }
  if (!Number.isInteger(x.waitMs) || x.waitMs < 250 || x.waitMs > 10000) throw new Error('CONFIG_INVALID');
  return structuredClone(x);
}

export const DEFAULT_CONFIG = Object.freeze({
  profileHeading: ['main h1', 'main section h2'],
  actionScope: ['main .pv-top-card', 'main .ph5', 'main section'],
  connect: ['button[aria-label*="Invite"][aria-label*="connect"]', 'button[aria-label="Connect"]', 'a[href*="/preload/custom-invite/"]'],
  more: ['button[aria-label="More"]', 'button[aria-label*="More actions"]'],
  pending: ['button[aria-label*="Pending"]', 'button[aria-label*="Invitation sent"]'],
  connected: ['button[aria-label*="Message"]'],
  labels: { connect: ['Connect', 'Se connecter', 'Vernetzen'], more: ['More', 'Plus', 'Mehr'], pending: ['Pending', 'Invitation sent', 'Request sent', 'En attente'], connected: ['Message', 'Envoyer un message'], send: ['Send without a note', 'Send', 'Envoyer'] },
  degree: ['1st', '2nd', '3rd'],
  waitMs: 3000
});
