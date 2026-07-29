importScripts("config.js");

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
  if (message?.type !== "REFRESH_TOTAL") return false;
  updateBadge()
    .then((stats) => sendResponse({ ok: true, stats }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function updateBadge() {
  const stats = await fetchStats();
  await chrome.storage.local.set({ leadStats: stats, leadStatsUpdatedAt: Date.now() });
  await chrome.action.setBadgeBackgroundColor({ color: "#6347D8" });
  await chrome.action.setBadgeText({ text: compactNumber(stats.total) });
  return stats;
}

async function fetchStats() {
  const siteUrl = globalThis.LEADS_EXTENSION_CONFIG?.CONVEX_SITE_URL;
  if (!siteUrl || siteUrl.includes("your-deployment")) {
    throw new Error("Extension is not configured. Run npm run extension:config.");
  }
  const response = await fetch(`${siteUrl}/api/leads/stats`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Stats request failed (${response.status}).`);
  return response.json();
}

function compactNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000) return `${Math.floor(number / 100_000) / 10}M`;
  if (number >= 1_000) return `${Math.floor(number / 100) / 10}K`;
  return String(number);
}
