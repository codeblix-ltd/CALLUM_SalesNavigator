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
  if (message?.type === "REFRESH_SCOUT_DASHBOARD") {
    updateBadge()
      .then((dashboard) => sendResponse({ ok: true, dashboard }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "START_AUTO_LEAD") {
    runAutoLeadWorkflow(message.leadId)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "AUTOMATE_ACTIVE_TAB") {
    automateActiveTab(message.action)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});

async function runAutoLeadWorkflow(specificLeadId) {
  let lead = null;
  if (specificLeadId) {
    const dashboard = await ScoutApi.authenticatedAction("scouts:getDashboard");
    lead = dashboard.activeLead;
  }

  if (!lead) {
    lead = await ScoutApi.authenticatedAction("scouts:claimNextLead");
  }

  if (!lead || !lead.linkedinUrl) {
    throw new Error("No available lead with a valid LinkedIn URL found.");
  }

  const profileUrl = lead.linkedinUrl.replace(/\/+$/, "");
  const recentActivityUrl = `${profileUrl}/recent-activity/all/`;

  // Step 1: Open recent activity page and run post engagement
  const tab = await chrome.tabs.create({ url: recentActivityUrl, active: true });
  await waitForTabComplete(tab.id);
  await sleep(2500);

  // Send engagement command to content script
  const engagementResponse = await sendMessageToTab(tab.id, {
    type: "EXECUTE_POST_ENGAGEMENT",
  });

  if (!engagementResponse?.ok) {
    throw new Error(engagementResponse?.error || "Post engagement failed on recent activity page.");
  }

  // Update status in Scout database -> engaged
  await ScoutApi.authenticatedAction("scouts:updateLeadStatus", {
    leadId: lead.id,
    status: "engaged",
    error: null,
  });

  // Step 2: Navigate to profile root and send connection request
  await chrome.tabs.update(tab.id, { url: profileUrl });
  await waitForTabComplete(tab.id);
  await sleep(2500);

  const connectResponse = await sendMessageToTab(tab.id, {
    type: "EXECUTE_CONNECTION_REQUEST",
  });

  if (!connectResponse?.ok) {
    throw new Error(connectResponse?.error || "Connection request failed on profile page.");
  }

  // Update status in Scout database -> connection_requested
  await ScoutApi.authenticatedAction("scouts:updateLeadStatus", {
    leadId: lead.id,
    status: "connection_requested",
    error: null,
  });

  await updateBadge();
  return { leadId: lead.id, leadName: lead.fullName, status: "connection_requested" };
}

async function automateActiveTab(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error("No active tab found.");
  }

  if (action === "post_engagement") {
    return sendMessageToTab(tab.id, { type: "EXECUTE_POST_ENGAGEMENT" });
  } else if (action === "connection_request") {
    return sendMessageToTab(tab.id, { type: "EXECUTE_CONNECTION_REQUEST" });
  } else {
    return sendMessageToTab(tab.id, { type: "EXECUTE_FULL_LEAD_AUTOMATION" });
  }
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
