importScripts("config.js");
importScripts("convex-client.js");

const REFRESH_ALARM = "refresh-lead-total";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 30 });
  void updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  void updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) void updateBadge();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "REFRESH_SCOUT_DASHBOARD") return false;
  updateBadge()
    .then((dashboard) => sendResponse({ ok: true, dashboard }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function updateBadge() {
  const auth = await ScoutApi.getAuth();
  if (!auth) {
    await chrome.action.setBadgeText({ text: "" });
    return null;
  }
  const dashboard = await ScoutApi.authenticatedAction("scouts:getDashboard");
  await chrome.storage.local.set({
    scoutDashboard: dashboard,
    scoutDashboardUpdatedAt: Date.now(),
  });
  await chrome.action.setBadgeBackgroundColor({ color: "#6347D8" });
  await chrome.action.setBadgeText({
    text: compactNumber(dashboard.counts.fresh),
  });
  return dashboard;
}

function compactNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000) return `${Math.floor(number / 100_000) / 10}M`;
  if (number >= 1_000) return `${Math.floor(number / 100) / 10}K`;
  return String(number);
}
