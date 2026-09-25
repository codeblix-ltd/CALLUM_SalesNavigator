importScripts('build-info.js', 'config.js');

const ENDPOINTS = Object.freeze({ local: 'http://localhost:8788', staging: 'https://api-v2.careeraccelerator.net' });
let busy = false;
let last = { state: 'idle', configVersion: null, installationId: null, error: null, environment: 'local' };

async function settings() {
  let x;
  try { x = await chrome.storage.local.get(['v2Token', 'v2Environment']); }
  catch { throw new Error('STORAGE_UNAVAILABLE'); }
  return { token: x.v2Token || null, environment: x.v2Environment === 'staging' ? 'staging' : 'local' };
}
async function api(endpoint, token, path, payload = null) {
  const response = await fetch(endpoint + path, {
    method: payload === null ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(payload === null ? {} : { 'content-type': 'application/json' }) },
    body: payload === null ? undefined : JSON.stringify(payload),
    cache: 'no-store'
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'BACKEND_UNAVAILABLE');
  return data;
}
function assertCommand(c, configVersion) {
  if (!c || !['INSPECT_PROFILE', 'EXECUTE_CONNECT', 'INSPECT_COMMENT_STATE', 'EXTRACT_CONTACT_INFO', 'INSPECT_PENDING_INVITATION', 'EXECUTE_WITHDRAW','EXECUTE_COMMENT'].includes(c.type) || c.protocolVersion !== CALLUM_V2_BUILD.protocol || c.configVersion !== configVersion) throw new Error('CONFIG_INCOMPATIBLE');
  const url = new URL(c.targetUrl);
  const validPath=['INSPECT_PENDING_INVITATION','EXECUTE_WITHDRAW'].includes(c.type) ? /^\/mynetwork\/invitation-manager\/sent\/?$/i.test(url.pathname) && !url.search && !url.hash : /^\/in\/[a-z0-9_%.-]+\/?$/i.test(url.pathname);
  if (url.protocol !== 'https:' || !['linkedin.com','www.linkedin.com'].includes(url.hostname) || !validPath) throw new Error('PROFILE_MISMATCH');
  if (Date.parse(c.expiresAt) <= Date.now() || !c.id || !c.actionIntentId && ['EXECUTE_CONNECT','EXECUTE_WITHDRAW','EXECUTE_COMMENT'].includes(c.type)) throw new Error('COMMAND_EXPIRED');
}
async function targetTab(url) {
  const tabs = await chrome.tabs.query({ url: ['https://www.linkedin.com/*', 'https://linkedin.com/*'] });
  const existing = tabs.find(tab => tab.url?.split('?')[0].replace(/\/$/, '') === url.replace(/\/$/, ''));
  const tab = existing || await chrome.tabs.create({ url, active: true });
  if (existing && existing.url !== url) await chrome.tabs.update(tab.id, { url, active: true });
  if (tab.status === 'complete' && existing?.url === url) return tab.id;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdate); chrome.tabs.onRemoved.removeListener(onRemove); reject(new Error('NAVIGATION_FAILED')); }, 30000);
    function finish(fn) { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdate); chrome.tabs.onRemoved.removeListener(onRemove); fn(); }
    function onUpdate(id, change) { if (id === tab.id && change.status === 'complete') finish(resolve); }
    function onRemove(id) { if (id === tab.id) finish(() => reject(new Error('TAB_CLOSED'))); }
    chrome.tabs.onUpdated.addListener(onUpdate); chrome.tabs.onRemoved.addListener(onRemove);
  });
  return tab.id;
}
async function primitive(tabId, command, config) {
  const result = await chrome.tabs.sendMessage(tabId, { kind: 'CALLUM_V2_PRIMITIVE', command, config });
  if (!result || result.commandId !== command.id) throw new Error('UNEXPECTED_BROWSER_STATE');
  return result;
}
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const { token, environment } = await settings();
    last.environment = environment;
    if (!token) { last = { ...last, state: 'not_connected', error: null }; return; }
    const endpoint = ENDPOINTS[environment];
    const identity = await api(endpoint, token, '/api/installation');
    last.installationId = identity.id;
    const claimed = await api(endpoint, token, '/api/commands/claim', {});
    last.configVersion = claimed.config.version;
    CallumConfig.validate(claimed.config.value);
    const command = claimed.command;
    if (!command) { last = { ...last, state: 'waiting', error: null }; return; }
    assertCommand(command, claimed.config.version);
    last = { ...last, state: `running ${command.type}`, error: null };
    let result;
    let primitiveStarted = false;
    try {
      const tabId = await targetTab(command.targetUrl);
      if (['EXECUTE_CONNECT','EXECUTE_WITHDRAW','EXECUTE_COMMENT'].includes(command.type)) {
        const authorization=await api(endpoint, token, `/api/commands/${command.id}/authorize`, {});
        if(authorization.authorized!==true)throw new Error('ACTION_NOT_AUTHORIZED');
      }
      primitiveStarted = true;
      result = await primitive(tabId, command, claimed.config.value);
    } catch (error) {
      const code = ['TAB_CLOSED','NAVIGATION_FAILED','ACTION_NOT_AUTHORIZED','BACKEND_UNAVAILABLE','CONFIG_INCOMPATIBLE'].includes(error.message) ? error.message : 'UNEXPECTED_BROWSER_STATE';
      result = { commandId: command.id, status: ['EXECUTE_CONNECT','EXECUTE_WITHDRAW','EXECUTE_COMMENT'].includes(command.type) ? (primitiveStarted ? 'uncertain' : 'not_submitted') : 'observed',
        facts: { profileMatched: false, profileKey: null, pageReady: false, diagnosticCode: code } };
    }
    await api(endpoint, token, `/api/commands/${command.id}/ack`, result);
    last = { ...last, state: 'waiting', error: null };
  } catch (error) {
    last = { ...last, state: 'paused', error: /^[A-Z_]+$/.test(error.message || '') ? error.message : 'BACKEND_UNAVAILABLE' };
  } finally { busy = false; }
}

chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('v2-poll', { periodInMinutes: 1 }); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('v2-poll', { periodInMinutes: 1 }); void poll(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'v2-poll') void poll(); });
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.kind === 'V2_STATUS') { sendResponse({ ...last, build: CALLUM_V2_BUILD, version: chrome.runtime.getManifest().version }); return; }
  if (message?.kind === 'V2_POLL') { void poll().then(() => sendResponse({ ...last, build: CALLUM_V2_BUILD, version: chrome.runtime.getManifest().version })); return true; }
});
