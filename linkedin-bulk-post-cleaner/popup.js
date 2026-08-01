const $ = (id) => document.getElementById(id);
const fields = [
  "companyId", "authorName", "profileSlug", "maxDeletes",
  "maxIdleScrolls", "minDelay", "maxDelay"
];
let activeTab = null;
let pollTimer = null;

function setStatus(text) {
  $("status").textContent = text;
}

function configFromForm() {
  return {
    companyId: $("companyId").value.trim(),
    authorName: $("authorName").value.trim(),
    profileSlug: $("profileSlug").value.trim().replace(/^\/+|\/+$/g, ""),
    maxDeletes: Number($("maxDeletes").value),
    maxIdleScrolls: Number($("maxIdleScrolls").value),
    minDelay: Number($("minDelay").value),
    maxDelay: Number($("maxDelay").value)
  };
}

async function saveSettings() {
  await chrome.storage.local.set({ cleanerSettings: configFromForm() });
}

async function loadSettings() {
  const { cleanerSettings } = await chrome.storage.local.get("cleanerSettings");
  if (!cleanerSettings) return;
  for (const field of fields) {
    if (cleanerSettings[field] !== undefined) $(field).value = cleanerSettings[field];
  }
}

function validAdminUrl(url, companyId) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.linkedin.com") return false;
    const expected = companyId
      ? `/company/${companyId}/admin/page-posts/published`
      : "/admin/page-posts/published";
    return parsed.pathname.includes(expected);
  } catch {
    return false;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureInjected() {
  if (!activeTab?.id) throw new Error("No active tab.");
  await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["content.js"] });
}

async function send(command, payload = {}) {
  await ensureInjected();
  return chrome.tabs.sendMessage(activeTab.id, { source: "linkedin-page-post-cleaner", command, ...payload });
}

function updateConfirmation() {
  $("start").disabled = !(
    $("permanent").checked &&
    $("confirmText").value.trim() === "DELETE" &&
    activeTab && validAdminUrl(activeTab.url, $("companyId").value.trim())
  );
}

function updateControls(state) {
  const running = Boolean(state?.running);
  const paused = Boolean(state?.paused);
  $("pause").disabled = !running || paused;
  $("resume").disabled = !running || !paused;
  $("stop").disabled = !running;
  if (!state) return;
  const lines = [
    `Running: ${running ? "yes" : "no"}${paused ? " (paused)" : ""}`,
    `Matched: ${state.matched ?? 0}`,
    `Deleted: ${state.deleted ?? 0}`,
    `Errors: ${state.errors ?? 0}`,
    `Empty scrolls: ${state.idleScrolls ?? 0}`,
    state.lastMessage || "Ready."
  ];
  setStatus(lines.join("\n"));
}

async function refreshState() {
  if (!activeTab || !validAdminUrl(activeTab.url, $("companyId").value.trim())) return;
  try {
    const response = await send("status");
    updateControls(response?.state);
  } catch {
    updateControls(null);
  }
}

async function initialize() {
  await loadSettings();
  activeTab = await getActiveTab();
  const ok = activeTab && validAdminUrl(activeTab.url, $("companyId").value.trim());
  $("pageStatus").className = `notice ${ok ? "ok" : "error"}`;
  $("pageStatus").textContent = ok
    ? "Correct LinkedIn published-posts admin page detected."
    : "Open the matching LinkedIn Page → Admin → Posts → Published page first.";
  updateConfirmation();
  if (ok) await refreshState();
  pollTimer = setInterval(refreshState, 1000);
}

for (const field of fields) {
  $(field).addEventListener("change", async () => {
    await saveSettings();
    activeTab = await getActiveTab();
    const ok = activeTab && validAdminUrl(activeTab.url, $("companyId").value.trim());
    $("pageStatus").className = `notice ${ok ? "ok" : "error"}`;
    $("pageStatus").textContent = ok
      ? "Correct LinkedIn published-posts admin page detected."
      : "The active tab does not match this Company ID and admin route.";
    updateConfirmation();
  });
}

$("permanent").addEventListener("change", updateConfirmation);
$("confirmText").addEventListener("input", updateConfirmation);

$("scan").addEventListener("click", async () => {
  try {
    await saveSettings();
    const response = await send("scan", { config: configFromForm() });
    const sample = (response.matches || []).slice(0, 8)
      .map((m, i) => `${i + 1}. ${m.author} | ${m.date || "no date"} | ${m.urn || "no URN"}`)
      .join("\n");
    setStatus(`Visible matching posts: ${response.count}\n${sample || "No matches visible."}`);
  } catch (error) {
    setStatus(`Scan failed: ${error.message}`);
  }
});

$("start").addEventListener("click", async () => {
  try {
    const config = configFromForm();
    if (!config.authorName && !config.profileSlug) throw new Error("Enter an author name or profile slug.");
    if (config.minDelay > config.maxDelay) throw new Error("Minimum delay cannot exceed maximum delay.");
    await saveSettings();
    const response = await send("start", { config });
    updateControls(response.state);
  } catch (error) {
    setStatus(`Could not start: ${error.message}`);
  }
});

$("pause").addEventListener("click", async () => updateControls((await send("pause")).state));
$("resume").addEventListener("click", async () => updateControls((await send("resume")).state));
$("stop").addEventListener("click", async () => updateControls((await send("stop")).state));

window.addEventListener("unload", () => clearInterval(pollTimer));
initialize().catch((error) => setStatus(`Initialization failed: ${error.message}`));
