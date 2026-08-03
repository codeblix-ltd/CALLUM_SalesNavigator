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
  let workflowTabId = null;
  try {
    const dashboard = await ScoutApi.authenticatedAction("scouts:getDashboard");
    if (specificLeadId) {
      lead = dashboard.activeLead;
      if (!lead || lead.id !== specificLeadId) {
        throw new Error("The selected lead is no longer the active Scout lead. Refresh the extension and try again.");
      }
    } else {
      lead = await ScoutApi.authenticatedAction("scouts:claimNextLead");
    }

    if (!lead || !lead.linkedinUrl) {
      throw new Error("No available lead with a valid LinkedIn URL found.");
    }

    const requestedProfileUrl = normalizeLinkedInProfileUrl(lead.linkedinUrl);
    const localSettings = await chrome.storage.local.get("validateBeforeCommenting");
    const automationOptions = {
      postEngagements: clampInteger(
        dashboard.settings?.postEngagements ?? 2,
        0,
        10,
      ),
      validateBeforeCommenting:
        localSettings.validateBeforeCommenting ?? true,
    };

    // Lead imports can contain LinkedIn's opaque /in/AC... member URL. Open it
    // first so LinkedIn can redirect to the public vanity URL; appending the
    // activity route before that redirect produces a non-activity profile page.
    const tab = await chrome.tabs.create({
      url: requestedProfileUrl,
      active: true,
    });
    workflowTabId = tab.id;
    await waitForTabComplete(tab.id);
    const profileUrl = await waitForResolvedLinkedInProfileUrl(
      tab.id,
      requestedProfileUrl,
    );
    let engagementResponse = {
      ok: true,
      result: { engagedCount: 0, totalProcessed: 0, skipped: true },
    };

    if (automationOptions.postEngagements > 0) {
      const recentActivityUrl = `${profileUrl}/recent-activity/all/`;

      // Step 1 from doc.md: open recent activity, then Like, expand, read,
      // draft, optionally validate, and comment on the configured post count.
      await chrome.tabs.update(tab.id, { url: recentActivityUrl });
      await waitForTabComplete(tab.id);
      await waitForContentScript(tab.id);
      engagementResponse = await sendMessageToTab(tab.id, {
        type: "EXECUTE_POST_ENGAGEMENT",
        options: automationOptions,
      });

      if (!engagementResponse?.ok) {
        throw new Error(
          engagementResponse?.error ||
            "Post engagement failed on the recent activity page.",
        );
      }

      // Mark engaged only after the post workflow completes successfully.
      await ScoutApi.authenticatedAction("scouts:updateLeadStatus", {
        leadId: lead.id,
        status: "engaged",
        email: null,
        error: null,
      });

      await chrome.tabs.update(tab.id, { url: profileUrl });
      await waitForTabComplete(tab.id);
    } else {
      await waitForContentScript(tab.id);
      await sendMessageToTab(tab.id, {
        type: "SHOW_AUTOMATION_STATUS",
        status: "Post engagement is disabled (0); continuing to connection.",
      });
    }

    // Step 2 from doc.md: return to the profile root and use
    // More -> Connect -> Send without a note.
    await waitForContentScript(tab.id);
    const connectResponse = await sendMessageToTab(tab.id, {
      type: "EXECUTE_CONNECTION_REQUEST",
      options: {
        expectedProfileName: lead.fullName,
        expectedProfileUrl: profileUrl,
      },
    });

    if (!connectResponse?.ok) {
      throw new Error(
        connectResponse?.error ||
          "Connection request failed on the profile page.",
      );
    }

    await ScoutApi.authenticatedAction("scouts:updateLeadStatus", {
      leadId: lead.id,
      status: "connection_requested",
      email: null,
      error: null,
    });

    await updateBadge();
    return {
      leadId: lead.id,
      leadName: lead.fullName,
      status: "connection_requested",
      engagedCount: engagementResponse.result?.engagedCount ?? 0,
      engagementSkipped: automationOptions.postEngagements === 0,
    };
  } catch (error) {
    const message = cleanError(error);
    if (workflowTabId) {
      await sendMessageToTab(workflowTabId, {
        type: "SHOW_AUTOMATION_ERROR",
        error: message,
      }).catch(() => {});
    }
    await ScoutApi.authenticatedAction("scouts:reportError", {
      leadId: lead?.id ?? null,
      message,
    }).catch(() => {});
    throw new Error(message);
  }
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
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    const timeout = setTimeout(
      () => finish(new Error("LinkedIn did not finish loading within 45 seconds.")),
      45_000,
    );

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") finish();
      })
      .catch((error) => finish(error));
  });
}

async function waitForContentScript(tabId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    const response = await sendMessageToTab(tabId, { type: "GET_PAGE_INFO" });
    if (response?.url) return response;
    lastError = response?.error || lastError;
    await sleep(250);
  }
  throw new Error(
    lastError ||
      "The automation script did not attach to the LinkedIn page within 20 seconds.",
  );
}

async function waitForResolvedLinkedInProfileUrl(
  tabId,
  requestedProfileUrl,
  timeoutMs = 30_000,
) {
  const requestedSlug = linkedInProfileSlug(requestedProfileUrl);
  const mustRedirect = isOpaqueLinkedInProfileSlug(requestedSlug);
  const deadline = Date.now() + timeoutMs;
  let lastProfileUrl = "";
  let lastUrlChangeAt = Date.now();

  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    const currentProfileUrl = tryNormalizeLinkedInProfileUrl(tab.url);
    if (currentProfileUrl && currentProfileUrl !== lastProfileUrl) {
      lastProfileUrl = currentProfileUrl;
      lastUrlChangeAt = Date.now();
    }

    if (currentProfileUrl && Date.now() - lastUrlChangeAt >= 1_000) {
      const currentSlug = linkedInProfileSlug(currentProfileUrl);
      if (!mustRedirect || currentSlug !== requestedSlug) {
        return currentProfileUrl;
      }
    }
    await sleep(250);
  }

  if (lastProfileUrl && !mustRedirect) return lastProfileUrl;
  throw new Error(
    "LinkedIn did not redirect the imported member URL to a public profile URL within 30 seconds.",
  );
}

function normalizeLinkedInProfileUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("The lead has an invalid LinkedIn profile URL.");
  }

  if (
    url.protocol !== "https:" ||
    !/(^|\.)linkedin\.com$/i.test(url.hostname)
  ) {
    throw new Error("The lead URL must be an HTTPS LinkedIn profile URL.");
  }

  const match = url.pathname.match(/^\/in\/([^/]+)/i);
  if (!match) {
    throw new Error("The lead URL must use the linkedin.com/in/profile format.");
  }
  return `https://www.linkedin.com/in/${match[1]}`;
}

function tryNormalizeLinkedInProfileUrl(value) {
  try {
    return normalizeLinkedInProfileUrl(value);
  } catch {
    return null;
  }
}

function linkedInProfileSlug(value) {
  return new URL(value).pathname.split("/").filter(Boolean)[1] || "";
}

function isOpaqueLinkedInProfileSlug(value) {
  return /^AC[ow][A-Za-z0-9_-]{15,}$/.test(String(value));
}

function clampInteger(value, minimum, maximum) {
  const number = Math.trunc(Number(value));
  return Math.max(
    minimum,
    Math.min(maximum, Number.isFinite(number) ? number : minimum),
  );
}

function cleanError(error) {
  return String(error instanceof Error ? error.message : error || "Automation failed.")
    .replace(/^Error:\s*/i, "")
    .split("\n")[0];
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
