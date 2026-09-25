const $ = id => document.getElementById(id);
async function refresh() {
  try {
    const x = await chrome.runtime.sendMessage({ kind: 'V2_STATUS' });
    for (const [id, value] of Object.entries({ version:x.version, build:x.build.sha, protocol:x.build.protocol,
      adapter:x.build.adapter, config:x.configVersion ?? '—', environment:x.environment,
      installation:x.installationId ? x.installationId.slice(0,8) : '—', status:x.error || x.state })) $(id).textContent = String(value);
    const saved = await chrome.storage.local.get('v2Environment');
    $('environmentInput').value = saved.v2Environment || 'local';
  } catch { $('message').textContent = 'Local storage or worker unavailable. No action will run.'; }
}
$('save').addEventListener('click', async () => {
  try {
    const token = $('token').value.trim();
    if (token.length < 30) throw new Error('Enter a V2 installation token.');
    await chrome.storage.local.set({ v2Token: token, v2Environment: $('environmentInput').value });
    $('token').value = '';
    $('message').textContent = 'Saved. Checking V2 control plane…';
    await chrome.runtime.sendMessage({ kind:'V2_POLL' });
    await refresh();
  } catch (error) { $('message').textContent = error.message; }
});
$('poll').addEventListener('click', async () => { await chrome.runtime.sendMessage({ kind:'V2_POLL' }); await refresh(); });
void refresh();
