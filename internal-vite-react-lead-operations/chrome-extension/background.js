importScripts("config.js");
importScripts("convex-client.js");

const REFRESH_ALARM = "refresh-lead-total";
const PREMIUM_URL = "https://www.linkedin.com/premium/my-premium/";
const CONNECTIONS_URL =
  "https://www.linkedin.com/mynetwork/invite-connect/connections/";
const DEFAULT_INVITATION_NOTE =
  "Hi, I saw your profile and would like to connect.";

let premiumCheckPromise = null;
let workflowPromise = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 30 });
  void initializeExtensionDefaults();
  refreshBadgeInBackground();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeExtensionDefaults();
  refreshBadgeInBackground();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refreshBadgeInBackground();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "REFRESH_SCOUT_DASHBOARD") {
    updateBadge()
      .then((dashboard) => sendResponse({ ok: true, dashboard }))
      .catch((error) => sendResponse({ ok: false, error: cleanError(error) }));
    return true;
  }

  if (message?.type === "START_AUTO_LEAD") {
    startDailyWorkflow(message.leadId)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: cleanError(error) }));
    return true;
  }

  if (message?.type === "CHECK_LINKEDIN_PREMIUM") {
    verifyLinkedInPremium()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: cleanError(error) }));
    return true;
  }

  return false;
});

async function initializeExtensionDefaults() {
  const current = await chrome.storage.local.get([
    "validateBeforeCommenting",
    "invitationNote",
    "linkedInPremium",
  ]);
  const defaults = {};
  if (current.validateBeforeCommenting === undefined) {
    defaults.validateBeforeCommenting = false;
  }
  if (!current.invitationNote) defaults.invitationNote = DEFAULT_INVITATION_NOTE;
  if (current.linkedInPremium === undefined) defaults.linkedInPremium = false;
  if (Object.keys(defaults).length > 0) await chrome.storage.local.set(defaults);
}

function startDailyWorkflow(specificLeadId) {
  if (workflowPromise) return workflowPromise;
  workflowPromise = runDailyWorkflow(specificLeadId).finally(() => {
    workflowPromise = null;
  });
  return workflowPromise;
}

async function runDailyWorkflow(specificLeadId) {
  let dashboard = await ScoutApi.authenticatedAction("scouts:getDashboard");
  if (!dashboard.settings?.onboardingCompleted) {
    throw new Error("Finish setup before you start.");
  }

  const review = await reviewAcceptedConnections(dashboard);
  dashboard = await ScoutApi.authenticatedAction("scouts:getDashboard");
  const availableRequestSlots = specificLeadId
    ? Math.min(1, dashboard.usage.requestRemaining)
    : dashboard.usage.requestRemaining;
  const results = [];

  for (let index = 0; index < availableRequestSlots; index++) {
    if (dashboard.usage.engagementRemaining <= 0) break;
    let lead;
    if (specificLeadId && index === 0) {
      lead = dashboard.activeLead;
      if (!lead || lead.id !== specificLeadId) {
        throw new Error(
          "This lead is no longer available. Refresh the extension and try again.",
        );
      }
    } else {
      lead = await ScoutApi.authenticatedAction("scouts:claimNextLead");
    }
    if (!lead?.linkedinUrl) break;

    try {
      results.push(
        await runLeadWorkflow(lead, dashboard.settings, dashboard.usage),
      );
    } catch (error) {
      const message = cleanError(error);
      if (/no recent posts|no supported post permalink/i.test(message)) {
        await ScoutApi.authenticatedAction("scouts:updateLeadStatus", {
          leadId: lead.id,
          status: "skipped",
          email: null,
          error: message,
        }).catch(() => {});
      } else {
        await ScoutApi.authenticatedAction("scouts:reportError", {
          leadId: lead.id,
          message,
        }).catch(() => {});
      }
      throw new Error(message);
    }
    dashboard = await ScoutApi.authenticatedAction("scouts:getDashboard");
    if (specificLeadId) break;
  }

  await updateBadge();
  return {
    reviewedConnections: review.reviewed,
    acceptedMatched: review.acceptedMatched,
    contactsChecked: review.contactsChecked,
    emailsCollected: review.emailsCollected,
    requestsSent: results.length,
    leads: results,
    requestLimitReached: results.length >= availableRequestSlots,
  };
}

async function reviewAcceptedConnections(dashboard) {
  const empty = {
    reviewed: false,
    acceptedMatched: 0,
    contactsChecked: 0,
    emailsCollected: 0,
  };
  if (!dashboard.hasSentConnectionRequest) return empty;

  const plan = await ScoutApi.authenticatedAction(
    "scouts:getConnectionReviewPlan",
  );
  if (!plan.shouldReview) return empty;

  const tab = await chrome.tabs.create({ url: CONNECTIONS_URL, active: true });
  if (!tab?.id) throw new Error("We couldn’t open your LinkedIn connections.");
  let reviewResult;
  try {
    await waitForTabComplete(tab.id);
    await waitForContentScript(tab.id);
    const scan = await sendMessageToTab(tab.id, {
      type: "SCAN_RECENT_CONNECTIONS",
      options: {
        checkpoint: plan.checkpoint,
        cutoffDate: plan.cutoffDate,
        maxProfiles: 250,
      },
    });
    if (!scan?.ok) {
      throw new Error(scan?.error || "We couldn’t check new connections.");
    }
    reviewResult = await ScoutApi.authenticatedAction(
      "scouts:recordConnectionReview",
      {
        connections: scan.result.connections,
        top: scan.result.top,
      },
    );
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }

  const contactLeads = uniqueLeads([
    ...(plan.contactLeads || []),
    ...(reviewResult.acceptedLeads || []),
  ]);
  let contactsChecked = 0;
  let emailsCollected = 0;
  for (const lead of contactLeads) {
    const result = await collectAcceptedContact(lead).catch(async (error) => {
      await ScoutApi.authenticatedAction("scouts:reportError", {
        leadId: lead.id,
        message: cleanError(error),
      }).catch(() => {});
      return null;
    });
    if (!result) continue;
    contactsChecked += 1;
    if (result.email) emailsCollected += 1;
  }
  return {
    reviewed: true,
    acceptedMatched: Number(reviewResult.matched || 0),
    contactsChecked,
    emailsCollected,
  };
}

async function collectAcceptedContact(lead) {
  const requestedProfileUrl = normalizeLinkedInProfileUrl(lead.profileUrl);
  const tab = await chrome.tabs.create({ url: requestedProfileUrl, active: true });
  if (!tab?.id) throw new Error("We couldn’t open this LinkedIn profile.");
  try {
    await waitForTabComplete(tab.id);
    const profileUrl = await waitForResolvedLinkedInProfileUrl(
      tab.id,
      requestedProfileUrl,
    );
    await waitForContentScript(tab.id);
    const contact = await sendMessageToTab(tab.id, {
      type: "EXTRACT_CONTACT_INFO",
      options: { expectedProfileUrl: profileUrl },
    });
    if (!contact?.ok) {
      throw new Error(contact?.error || "We couldn’t read the contact info.");
    }
    return ScoutApi.authenticatedAction("scouts:recordContactInfo", {
      leadId: lead.id,
      profileUrl,
      email: contact.result.email || null,
    });
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function runLeadWorkflow(lead, settings, usage) {
  let workflowTabId = null;
  let connectionReserved = false;
  let requestSubmitted = false;
  let workflowCompleted = false;
  try {
    let includeNote = Boolean(settings.includeNote && settings.linkedinPremium);
    let noteDisabledForEligibility = false;
    if (includeNote) {
      const eligibility = await verifyLinkedInPremium();
      if (!eligibility.premium) {
        includeNote = false;
        noteDisabledForEligibility = true;
        await disableInvitationNoteSetting(settings).catch(() => {});
      }
    }

    const requestedProfileUrl = normalizeLinkedInProfileUrl(lead.linkedinUrl);
    const localSettings = await chrome.storage.local.get([
      "validateBeforeCommenting",
      "invitationNote",
    ]);
    const postEngagements = Math.min(
      clampInteger(settings.postEngagements ?? 3, 1, 10),
      clampInteger(usage.engagementRemaining ?? 0, 0, 250),
    );
    if (postEngagements < 1) {
      throw new Error("You’ve used all your likes for today.");
    }
    const automationOptions = {
      leadId: lead.id,
      postEngagements,
      validateBeforeCommenting:
        localSettings.validateBeforeCommenting ?? false,
      includeNote,
      invitationNote: String(
        localSettings.invitationNote || DEFAULT_INVITATION_NOTE,
      )
        .trim()
        .slice(0, 300),
    };

    const tab = await chrome.tabs.create({ url: requestedProfileUrl, active: true });
    workflowTabId = tab.id;
    await waitForTabComplete(tab.id);
    const profileUrl = await waitForResolvedLinkedInProfileUrl(
      tab.id,
      requestedProfileUrl,
    );
    await ScoutApi.authenticatedAction("scouts:recordProfileVisit", {
      leadId: lead.id,
      resolvedLinkedinUrl: profileUrl,
    });

    const recentActivityUrl = `${profileUrl}/recent-activity/all/`;
    await chrome.tabs.update(tab.id, { url: recentActivityUrl });
    await waitForTabComplete(tab.id);
    await waitForContentScript(tab.id);
    const engagementResponse = await sendMessageToTab(tab.id, {
      type: "EXECUTE_POST_ENGAGEMENT",
      options: { ...automationOptions, profileUrl },
    });
    if (!engagementResponse?.ok) {
      throw new Error(
        engagementResponse?.error ||
          "We couldn’t finish this lead’s posts.",
      );
    }

    await chrome.tabs.update(tab.id, { url: profileUrl });
    await waitForTabComplete(tab.id);
    await waitForContentScript(tab.id);
    if (noteDisabledForEligibility) {
      await sendMessageToTab(tab.id, {
        type: "SHOW_AUTOMATION_STATUS",
        status:
          "Premium is not active, so no note will be added.",
      });
    }

    await ScoutApi.authenticatedAction("scouts:reserveConnectionRequest", {
      leadId: lead.id,
    });
    connectionReserved = true;
    const connectResponse = await sendMessageToTab(tab.id, {
      type: "EXECUTE_CONNECTION_REQUEST",
      options: {
        expectedProfileName: lead.fullName,
        expectedProfileUrl: profileUrl,
        includeNote,
        invitationNote: automationOptions.invitationNote,
      },
    });
    if (!connectResponse?.ok) {
      throw new Error(
        connectResponse?.error || "We couldn’t send the connection request.",
      );
    }
    requestSubmitted = true;
    await ScoutApi.authenticatedAction("scouts:completeConnectionRequest", {
      leadId: lead.id,
      profileUrl,
    });
    workflowCompleted = true;
    return {
      leadId: lead.id,
      leadName: lead.fullName,
      status: "connection_requested",
      profileUrl,
      engagedCount: engagementResponse.result?.engagedCount ?? 0,
    };
  } catch (error) {
    const message = cleanError(error);
    if (connectionReserved && !requestSubmitted) {
      await ScoutApi.authenticatedAction("scouts:releaseConnectionRequest", {
        leadId: lead.id,
      }).catch(() => {});
    }
    if (workflowTabId) {
      await sendMessageToTab(workflowTabId, {
        type: "SHOW_AUTOMATION_ERROR",
        error: message,
      }).catch(() => {});
    }
    throw new Error(message);
  } finally {
    if (workflowCompleted && workflowTabId) {
      await chrome.tabs.remove(workflowTabId).catch(() => {});
    }
  }
}

function uniqueLeads(leads) {
  const unique = new Map();
  for (const lead of leads) {
    if (lead?.id && !unique.has(lead.id)) unique.set(lead.id, lead);
  }
  return [...unique.values()];
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

function verifyLinkedInPremium() {
  if (premiumCheckPromise) return premiumCheckPromise;
  premiumCheckPromise = inspectLinkedInPremium().finally(() => {
    premiumCheckPromise = null;
  });
  return premiumCheckPromise;
}

async function inspectLinkedInPremium() {
  const tab = await chrome.tabs.create({ url: PREMIUM_URL, active: false });
  if (!tab?.id) throw new Error("We couldn’t open LinkedIn to check Premium.");
  try {
    const finalUrl = await waitForStableTabUrl(tab.id);
    let inspection = {
      premium: false,
      evidence: "LinkedIn did not open the Premium page. Try again.",
    };
    if (isLinkedInPremiumUrl(finalUrl)) {
      await waitForContentScript(tab.id);
      const response = await sendMessageToTab(tab.id, {
        type: "INSPECT_PREMIUM_ACCOUNT",
      });
      if (!response?.ok) {
        throw new Error(
          response?.error || "We couldn’t check your Premium plan.",
        );
      }
      inspection = {
        premium: response.premium === true,
        evidence: String(response.evidence || "").trim(),
      };
    }
    await chrome.storage.local.set({
      linkedInPremium: inspection.premium,
      linkedInPremiumCheckedAt: Date.now(),
      linkedInPremiumEvidence: inspection.evidence,
    });
    return inspection;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function waitForStableTabUrl(tabId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = "";
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    const currentUrl = tab.pendingUrl || tab.url || "";
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      stableSince = Date.now();
    }
    if (lastUrl && tab.status === "complete" && Date.now() - stableSince >= 2_500) {
      return lastUrl;
    }
    await sleep(250);
  }
  if (lastUrl) return lastUrl;
  throw new Error("LinkedIn didn’t finish the Premium check. Try again.");
}

function isLinkedInPremiumUrl(value) {
  try {
    const url = new URL(String(value));
    return (
      /(^|\.)linkedin\.com$/i.test(url.hostname) &&
      url.pathname.replace(/\/+$/, "") === "/premium/my-premium"
    );
  } catch {
    return false;
  }
}

async function disableInvitationNoteSetting(settings) {
  await ScoutApi.authenticatedAction("scouts:updateSettings", {
    postEngagements: Number(settings.postEngagements ?? 3),
    linkedinPremium: Boolean(settings.linkedinPremium),
    premiumVerified: Boolean(settings.linkedinPremiumVerified),
    connectionDailyLimit: Number(settings.connectionDailyLimit ?? 20),
    onboardingCompleted: Boolean(settings.onboardingCompleted),
    includeNote: false,
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
      if (id === tabId && changeInfo.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timeout = setTimeout(
      () => finish(new Error("LinkedIn took too long to load. Try again.")),
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
      "Callum Scout couldn’t start on the LinkedIn page. Reload the page and try again.",
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
      if (!mustRedirect || currentSlug !== requestedSlug) return currentProfileUrl;
    }
    await sleep(250);
  }
  if (lastProfileUrl && !mustRedirect) return lastProfileUrl;
  throw new Error(
    "LinkedIn couldn’t open this lead’s profile. Try again.",
  );
}

function normalizeLinkedInProfileUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("This lead’s LinkedIn link does not work.");
  }
  if (url.protocol !== "https:" || !/(^|\.)linkedin\.com$/i.test(url.hostname)) {
    throw new Error("This lead’s LinkedIn link does not work.");
  }
  const match = url.pathname.match(/^\/in\/([^/]+)/i);
  if (!match) throw new Error("This lead’s LinkedIn link does not work.");
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
  return String(error instanceof Error ? error.message : error || "Something went wrong. Try again.")
    .replace(/^Error:\s*/i, "")
    .split("\n")[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  await chrome.action.setBadgeText({ text: compactNumber(dashboard.counts.fresh) });
  return dashboard;
}

function refreshBadgeInBackground() {
  void updateBadge().catch(async (error) => {
    await chrome.action.setBadgeText({ text: "" }).catch(() => {});
    console.warn("Callum Scout badge refresh failed:", cleanError(error));
  });
}

function compactNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000) return `${Math.floor(number / 100_000) / 10}M`;
  if (number >= 1_000) return `${Math.floor(number / 100) / 10}K`;
  return String(number);
}
