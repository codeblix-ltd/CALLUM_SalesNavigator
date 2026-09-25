const optionalSelectorKeys = ['postScope', 'postDetailScope', 'postLink', 'commentButton', 'postAuthor', 'viewerProfile', 'viewerMenuTrigger', 'viewerMenu', 'viewerMenuProfile', 'commentItem', 'commentOptionButton', 'commentAuthor', 'commentText', 'commentEditor', 'commentSubmit', 'contactLink', 'contactDialog', 'contactEmail', 'invitationPage', 'invitationCard', 'invitationProfile', 'invitationAge', 'invitationWithdraw', 'withdrawDialog', 'withdrawConfirm'];
const allowedKeys = new Set(['profileHeading', 'actionScope', 'connect', 'more', 'pending', 'connected', ...optionalSelectorKeys, 'labels', 'degree', 'waitMs']);
const allowedSelectorKeys = new Set(['profileHeading', 'actionScope', 'connect', 'more', 'pending', 'connected']);
const unsafeSelector = /[{};\\]|:has\(|:contains\(|script|iframe|input\[type=.password/i;
export function validateConfig(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(k => !allowedKeys.has(k))) throw new Error('CONFIG_INVALID');
  for (const key of allowedSelectorKeys) {
    const list = x[key];
    if (!Array.isArray(list) || list.length < 1 || list.length > 12 || list.some(s => typeof s !== 'string' || s.length > 180 || !s.length || unsafeSelector.test(s))) throw new Error('CONFIG_INVALID');
  }
  for (const key of optionalSelectorKeys) {
    const list = x[key];
    if (list !== undefined && (!Array.isArray(list) || list.length < 1 || list.length > 12 || list.some(s => typeof s !== 'string' || s.length > 180 || !s.length || unsafeSelector.test(s)))) throw new Error('CONFIG_INVALID');
  }
  for (const key of ['degree']) {
    if (!Array.isArray(x[key]) || x[key].length !== 3 || x[key].some(s => typeof s !== 'string' || s.length > 24)) throw new Error('CONFIG_INVALID');
  }
  if (!x.labels || typeof x.labels !== 'object' || Array.isArray(x.labels) || Object.keys(x.labels).some(k => !['connect','more','pending','connected','send','viewerMenu','commentSubmit','contactInfo','invitationPage','invitationWithdraw','invitationSent','invitationAgo','invitationDay','invitationWeek','invitationMonth','invitationYear','withdrawDialog','withdrawConfirm'].includes(k))) throw new Error('CONFIG_INVALID');
  for (const key of ['connect','more','pending','connected','send']) {
    const list = x.labels[key];
    if (!Array.isArray(list) || list.length < 1 || list.length > 12 || list.some(s => typeof s !== 'string' || s.length < 2 || s.length > 40 || /[<>]/.test(s))) throw new Error('CONFIG_INVALID');
  }
  for (const key of ['viewerMenu','commentSubmit','contactInfo','invitationPage','invitationWithdraw','invitationSent','invitationAgo','invitationDay','invitationWeek','invitationMonth','invitationYear','withdrawDialog','withdrawConfirm']) {
    const list=x.labels[key];
    if (list !== undefined && (!Array.isArray(list) || list.length < 1 || list.length > 12 || list.some(s => typeof s !== 'string' || s.length < 1 || s.length > 40 || /[<>]/.test(s)))) throw new Error('CONFIG_INVALID');
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
  postScope: ['main [data-urn*="urn:li:activity:"]', 'main .feed-shared-update-v2', 'main .profile-creator-shared-feed-update__container', 'main section[role="list"] [role="listitem"]'],
  postDetailScope: ['main [role="listitem"]'],
  postLink: ['a[href*="/feed/update/urn:li:activity:"]', 'a[href*="/posts/"]'],
  commentButton: ['button[aria-label="Comment"]', 'button.comment-button', 'a[aria-label="Comment"][href*="/feed/update/"]'],
  postAuthor: ['.update-components-actor__meta-link[href*="/in/"]', '.feed-shared-actor__container-link[href*="/in/"]', 'a[data-control-name="actor"]', 'a[href*="/in/"]'],
  viewerProfile: ['header a[href*="/in/"]', 'nav a[href*="/in/"]'],
  viewerMenuTrigger: ['nav button[aria-expanded]'],
  viewerMenu: ['[role="menu"]'],
  viewerMenuProfile: ['a[href*="/in/"]'],
  commentItem: ['.comments-comment-item', '[data-id^="urn:li:comment:"]'],
  commentOptionButton: ['button[aria-label^="View more options for"]'],
  commentAuthor: ['.comments-post-meta__profile-link[href*="/in/"]', 'a[href*="/in/"]'],
  commentText: ['.comments-comment-item__main-content', '.comments-comment-item-content-body'],
  commentEditor: ['[contenteditable="true"][role="textbox"]', '.comments-comment-box__form [contenteditable="true"]'],
  commentSubmit: ['button.comments-comment-box__submit-button', 'button[aria-label="Post comment"]', 'button[type="submit"]'],
  contactLink: ['a[href*="/overlay/contact-info/"]', 'a[href*="/contact-info/"]'],
  contactDialog: ['[role="dialog"]', '.artdeco-modal'],
  contactEmail: ['a[href^="mailto:"]'],
  invitationPage: ['main h1', 'main h2', 'main [aria-current="page"]'],
  invitationCard: ['main [role="listitem"]', 'main div[componentkey]'],
  invitationProfile: ['a[href*="/in/"]'],
  invitationAge: ['p', 'span'],
  invitationWithdraw: ['button[aria-label*="Withdraw"]', 'a[aria-label*="Withdraw"]'],
  withdrawDialog: ['[role="dialog"]', '.artdeco-modal'],
  withdrawConfirm: ['button[aria-label="Withdraw"]', 'button[data-control-name="withdraw"]'],
  labels: { connect: ['Connect', 'Se connecter', 'Vernetzen'], more: ['More', 'Plus', 'Mehr'], pending: ['Pending', 'Invitation sent', 'Request sent', 'En attente'], connected: ['Message', 'Envoyer un message'], send: ['Send without a note', 'Send', 'Envoyer'], viewerMenu: ['Me', 'Moi', 'Ich'], commentSubmit: ['Post', 'Publish'], contactInfo: ['Contact info', 'Coordonnées', 'Kontaktinfo'], invitationPage: ['Sent', 'Sent invitations'], invitationWithdraw: ['Withdraw'], invitationSent: ['Sent'], invitationAgo: ['ago'], invitationDay: ['day','days'], invitationWeek: ['week','weeks'], invitationMonth: ['month','months'], invitationYear: ['year','years'], withdrawDialog: ['Withdraw invitation'], withdrawConfirm: ['Withdraw'] },
  degree: ['1st', '2nd', '3rd'],
  waitMs: 3000
});
