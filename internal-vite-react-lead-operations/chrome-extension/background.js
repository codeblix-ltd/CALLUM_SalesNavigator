importScripts("config.js");
importScripts("convex-client.js");

const REFRESH_ALARM = "refresh-lead-total";
const PREMIUM_URL = "https://www.linkedin.com/premium/my-premium/";
const CONNECTIONS_URL =
  "https://www.linkedin.com/mynetwork/invite-connect/connections/";
const SENT_INVITATIONS_URL =
  "https://www.linkedin.com/mynetwork/invitation-manager/sent/";
const DEFAULT_INVITATION_NOTE =
  "Hi, I saw your profile and would like to connect.";
const AUTO_LEAD_RUN_STATE_KEY = "autoLeadRunState";
const AUTOMATION_HOME_URL = chrome.runtime.getURL("automation.html");
const AUTOMATION_GROUP_TITLE = "CALLUM AUTOMATION";
const ACTIVE_RUN_STATUSES = new Set(["running", "pausing"]);
const CONNECTION_COMPLETION_RETRY_DELAYS_MS = [0, 750, 2_000];

let premiumCheckPromise = null;
let workflowPromise = null;
let workflowControlRequest = null;
let activeRunId = null;
let activeWorkflowTabId = null;
let activeAutomationWindowId = null;
let runStateInitializationPromise = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 30 });
  void initializeExtensionDefaults();
  void ensureAutoLeadRunState();
  refreshBadgeInBackground();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeExtensionDefaults();
  void ensureAutoLeadRunState();
  refreshBadgeInBackground();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refreshBadgeInBackground();
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (
    windowId === activeAutomationWindowId &&
    workflowPromise &&
    !workflowControlRequest
  ) {
    workflowControlRequest = {
      runId: activeRunId,
      action: "pause",
      reason:
        "The automation window was closed. The run paused safely; Resume will open a protected window and continue.",
    };
    void pauseRunAfterAutomationWindowClosed();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (
    tabId !== activeWorkflowTabId ||
    !workflowPromise ||
    workflowControlRequest
  ) {
    return;
  }
  void requestWorkflowControl("pause", {
    reason:
      "The automation tab was closed. The run paused safely; Resume will open a protected tab and continue.",
  }).catch((error) => {
    console.warn(
      "Could not pause after the automation tab closed:",
      cleanError(error),
    );
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "REFRESH_SCOUT_DASHBOARD") {
    reconcileLocallyConfirmedConnectionRequests()
      .catch((error) => {
        console.warn(
          "Could not reconcile locally confirmed requests:",
          cleanError(error),
        );
      })
      .then(() => updateBadge())
      .then((dashboard) => sendResponse({ ok: true, dashboard }))
      .catch((error) => sendResponse({ ok: false, error: cleanError(error) }));
    return true;
  }

  if (message?.type === "START_AUTO_LEAD") {
    startDailyWorkflow(message.leadId, { resume: false })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: cleanError(error) }));
    return true;
  }

  if (message?.type === "GET_AUTO_LEAD_RUN_STATE") {
    getAutoLeadRunState()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: cleanError(error) }));
    return true;
  }

  if (message?.type === "PAUSE_AUTO_LEAD") {
    requestWorkflowControl("pause")
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: cleanError(error) }));
    return true;
  }

  if (message?.type === "RESUME_AUTO_LEAD") {
    resumeDailyWorkflow()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: cleanError(error) }));
    return true;
  }

  if (message?.type === "STOP_AUTO_LEAD") {
    requestWorkflowControl("stop")
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: cleanError(error) }));
    return true;
  }

  if (message?.type === "CHECK_LINKEDIN_PREMIUM") {
    verifyLinkedInPremium()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: cleanError(error) }));
    return true;
  }

  if (message?.type === "AUTO_WITHDRAW_OLD_REQUESTS") {
    autoWithdrawOldRequests()
      .then((result) => sendResponse({ ok: true, result }))
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

async function startDailyWorkflow(specificLeadId, { resume = false } = {}) {
  await ensureAutoLeadRunState();
  if (workflowPromise) return workflowPromise;

  let previousState = await readAutoLeadRunState();
  previousState = await reconcileLocallyConfirmedConnectionRequests(
    previousState,
  );
  if (resume && previousState.status !== "paused") {
    throw new Error("This run is not paused, so there is nothing to resume.");
  }
  if (!resume && previousState.status === "paused") {
    throw new Error("This run is paused. Resume it or stop it before starting again.");
  }

  const runId = resume ? previousState.runId : createRunId();
  const inheritedPendingRequests = collectLocallyConfirmedConnectionRequests(
    previousState,
  );
  const progress = resume
    ? normalizeRunProgress(previousState.progress)
    : defaultRunProgress();
  if (!resume && inheritedPendingRequests.length > 0) {
    progress.pendingConnectionRequests = inheritedPendingRequests;
  }
  const runContext = {
    runId,
    resume,
    progress,
    automationWindowId: null,
    automationHomeTabId: null,
    automationTabGroupId: null,
  };
  const startedAt = resume
    ? Number(previousState.startedAt || Date.now())
    : Date.now();
  workflowControlRequest = null;
  const automationContext = await prepareAutomationWindow(
    runContext,
    resume ? previousState : null,
    resume ? null : previousState,
  );
  Object.assign(runContext, automationContext);
  activeRunId = runId;
  activeAutomationWindowId = runContext.automationWindowId;
  try {
    await writeAutoLeadRunState({
      ...(resume ? previousState : defaultAutoLeadRunState()),
      status: "running",
      runId,
      specificLeadId: resume ? previousState.specificLeadId || null : specificLeadId || null,
      startedAt,
      resumedAt: resume ? Date.now() : null,
      pausedAt: null,
      stoppedAt: null,
      completedAt: null,
      phase: resume ? previousState.phase || "preparing" : "preparing",
      message: resume
        ? "Resuming from the last completed step..."
        : "Preparing today’s work...",
      currentLead: resume ? previousState.currentLead || null : null,
      automationWindowId: runContext.automationWindowId,
      automationHomeTabId: runContext.automationHomeTabId,
      automationTabGroupId: runContext.automationTabGroupId,
      progress: runContext.progress,
      result: null,
      error: null,
    });
  } catch (error) {
    activeRunId = null;
    activeAutomationWindowId = null;
    await closeManagedAutomationWindow(
      runContext.automationWindowId,
      runContext.automationHomeTabId,
    ).catch(() => {});
    throw error;
  }

  workflowPromise = runDailyWorkflow(
    resume ? previousState.specificLeadId || null : specificLeadId,
    runContext,
  )
    .then(async (result) => {
      const state = await updateActiveRunState(runContext, {
        status: "completed",
        phase: "completed",
        message: "Today’s work is complete.",
        currentLead: null,
        completedAt: Date.now(),
        progress: result.progress,
        result: result.summary,
      });
      return { status: "completed", result: result.summary, state };
    })
    .catch(async (error) => {
      const requestedControl = getRequestedWorkflowControl(runContext);
      if (isWorkflowControlError(error) || requestedControl) {
        const control = error.control || requestedControl;
        const state = await finalizeControlledRun(runContext, control);
        return { status: control === "pause" ? "paused" : "stopped", state };
      }
      await updateActiveRunState(runContext, {
        status: "failed",
        phase: "failed",
        message: cleanError(error),
        currentLead: null,
        completedAt: Date.now(),
        error: cleanError(error),
      });
      throw error;
    })
    .finally(() => {
      workflowPromise = null;
      workflowControlRequest = null;
      activeRunId = null;
      activeWorkflowTabId = null;
      activeAutomationWindowId = null;
    });
  return workflowPromise;
}

async function resumeDailyWorkflow() {
  if (workflowPromise) await workflowPromise.catch(() => {});
  const state = await getAutoLeadRunState();
  return startDailyWorkflow(state.specificLeadId, { resume: true });
}

async function runDailyWorkflow(specificLeadId, runContext) {
  const progress = runContext.progress;
  throwIfWorkflowControlled(runContext);
  await updateRunProgress(runContext, progress, {
    phase: "preparing",
    message: runContext.resume
      ? "Checking the saved run before continuing..."
      : "Checking today’s limits...",
  });
  let dashboard = await ScoutApi.authenticatedAction("scouts:getDashboard");
  if (!dashboard.settings?.onboardingCompleted) {
    throw new Error("Finish setup before you start.");
  }

  let review = progress.review;
  if (!progress.reviewComplete) {
    await updateRunProgress(runContext, progress, {
      phase: "reviewing_connections",
      message: "Checking new connections and contact details...",
    });
    review = await reviewAcceptedConnections(dashboard, runContext);
    progress.review = review;
    progress.reviewComplete = true;
    await checkpointRun(runContext, progress, {
      phase: "withdrawing_old_requests",
      message: "Checking old sent requests...",
      currentLead: null,
    });
  }

  let autoWithdraw = progress.autoWithdraw;
  if (!progress.autoWithdrawComplete) {
    autoWithdraw = await autoWithdrawOldRequests(runContext).catch((error) => {
      if (isWorkflowControlError(error)) throw error;
      console.warn("Auto withdraw old requests failed:", cleanError(error));
      return { withdrawnCount: 0 };
    });
    progress.autoWithdraw = autoWithdraw;
    progress.autoWithdrawComplete = true;
    await checkpointRun(runContext, progress, {
      phase: "working_leads",
      message: "Starting today’s leads...",
      currentLead: null,
    });
  }

  dashboard = await ScoutApi.authenticatedAction("scouts:getDashboard");
  if (progress.targetRequests === null) {
    progress.targetRequests = specificLeadId
      ? Math.min(1, dashboard.usage.requestRemaining)
      : dashboard.usage.requestRemaining;
  }
  const availableRequestSlots = progress.targetRequests;
  const results = progress.results;
  const failedLeads = progress.failedLeads;
  const pendingConnectionLeadIds = new Set(
    collectLocallyConfirmedConnectionRequests({ progress }).map(
      (request) => request.leadId,
    ),
  );
  if (specificLeadId && pendingConnectionLeadIds.has(specificLeadId)) {
    progress.processedLeads = Math.max(progress.processedLeads, 1);
  }

  for (let index = progress.processedLeads; index < availableRequestSlots; index++) {
    throwIfWorkflowControlled(runContext);
    if (
      dashboard.usage.engagementRemaining <= 0 &&
      dashboard.activeLead?.status !== "engaged"
    ) {
      break;
    }
    let lead;
    if (specificLeadId && index === 0) {
      lead = dashboard.activeLead;
      if (!lead || lead.id !== specificLeadId) {
        throw new Error(
          "This lead is no longer available. Refresh the extension and try again.",
        );
      }
    } else {
      lead = await ScoutApi.authenticatedAction("scouts:claimNextLead", {
        excludeLeadIds: [...pendingConnectionLeadIds],
      });
    }
    if (!lead?.linkedinUrl) break;

    await checkpointRun(runContext, progress, {
      phase: lead.status === "engaged" ? "connecting" : "engaging",
      message:
        lead.status === "engaged"
          ? `Resuming ${lead.fullName} at the connection step...`
          : `Working on ${lead.fullName}...`,
      currentLead: {
        id: lead.id,
        fullName: lead.fullName,
        status: lead.status || "viewed",
      },
    });

    let connectionSyncPending = false;
    try {
      results.push(
        await runLeadWorkflow(
          lead,
          dashboard.settings,
          dashboard.usage,
          runContext,
          progress,
        ),
      );
      progress.requestsSent += 1;
    } catch (error) {
      if (isWorkflowControlError(error)) throw error;
      const message = cleanError(error);
      const requestSent = error?.requestSubmitted === true;
      if (requestSent) {
        progress.requestsSent += 1;
        connectionSyncPending = error?.persistencePending === true;
        if (connectionSyncPending) {
          pendingConnectionLeadIds.add(lead.id);
          progress.pendingConnectionRequests = upsertPendingConnectionRequest(
            progress.pendingConnectionRequests,
            {
              leadId: lead.id,
              leadName: lead.fullName,
              profileUrl: error?.profileUrl || lead.linkedinUrl,
              confirmedAt: Date.now(),
            },
          );
        }
        results.push({
          leadId: lead.id,
          leadName: lead.fullName,
          status: connectionSyncPending
            ? "connection_requested_pending_sync"
            : "connection_requested",
          profileUrl: error?.profileUrl || lead.linkedinUrl,
          engagedCount: error?.engagedCount ?? 0,
        });
      } else {
        const status =
          /no recent posts|no supported post permalink/i.test(message)
            ? "skipped"
            : "failed";
        try {
          await ScoutApi.authenticatedAction("scouts:updateLeadStatus", {
            leadId: lead.id,
            status,
            email: null,
            error: message,
          });
        } catch (statusError) {
          await ScoutApi.authenticatedAction("scouts:reportError", {
            leadId: lead.id,
            message,
          }).catch(() => {});
          console.warn(
            "Could not record the failed lead status:",
            cleanError(statusError),
          );
        }
        failedLeads.push({
          leadId: lead.id,
          leadName: lead.fullName,
          message,
          requestSent: false,
        });
        if (specificLeadId) throw new Error(message);
      }
    }
    progress.processedLeads += 1;
    await checkpointRun(runContext, progress, {
      phase: "working_leads",
      message: `${progress.processedLeads} of ${availableRequestSlots} leads finished in this run.`,
      currentLead: null,
    });
    dashboard = await ScoutApi.authenticatedAction("scouts:getDashboard");
    if (specificLeadId) break;
  }

  await updateBadge();
  const summary = {
    reviewedConnections: review.reviewed,
    acceptedMatched: review.acceptedMatched,
    contactsChecked: review.contactsChecked,
    emailsCollected: review.emailsCollected,
    withdrawnCount: Number(autoWithdraw?.withdrawnCount || 0),
    requestsSent: progress.requestsSent,
    failedLeads,
    leads: results,
    requestLimitReached: dashboard.usage.requestRemaining <= 0,
  };
  return { summary, progress };
}

function ensureAutoLeadRunState() {
  if (!runStateInitializationPromise) {
    runStateInitializationPromise = recoverAutoLeadRunState();
  }
  return runStateInitializationPromise;
}

async function recoverAutoLeadRunState() {
  const state = await readAutoLeadRunState();
  if (!state.runId) {
    return writeAutoLeadRunState(defaultAutoLeadRunState());
  }
  if (ACTIVE_RUN_STATUSES.has(state.status) && !workflowPromise) {
    return writeAutoLeadRunState({
      ...state,
      status: "paused",
      phase: "paused",
      pausedAt: Date.now(),
      message:
        "The extension paused this run safely. Resume to continue from the last completed step.",
    });
  }
  return state;
}

async function getAutoLeadRunState() {
  await ensureAutoLeadRunState();
  return readAutoLeadRunState();
}

async function readAutoLeadRunState() {
  const stored = await chrome.storage.local.get(AUTO_LEAD_RUN_STATE_KEY);
  return normalizeAutoLeadRunState(stored[AUTO_LEAD_RUN_STATE_KEY]);
}

async function writeAutoLeadRunState(state) {
  const next = normalizeAutoLeadRunState({
    ...state,
    updatedAt: Date.now(),
  });
  await chrome.storage.local.set({ [AUTO_LEAD_RUN_STATE_KEY]: next });
  return next;
}

async function updateActiveRunState(runContext, patch) {
  const current = await readAutoLeadRunState();
  if (current.runId !== runContext.runId) return current;
  if (current.status === "stopped" && patch.status !== "stopped") return current;
  return writeAutoLeadRunState({ ...current, ...patch });
}

async function updateRunProgress(runContext, progress, patch = {}) {
  return updateActiveRunState(runContext, {
    ...patch,
    progress: normalizeRunProgress(progress),
  });
}

async function checkpointRun(runContext, progress, patch = {}) {
  await updateRunProgress(runContext, progress, patch);
  throwIfWorkflowControlled(runContext);
}

function throwIfWorkflowControlled(runContext) {
  const control = getRequestedWorkflowControl(runContext);
  if (control) throw new WorkflowControlError(control);
}

function getRequestedWorkflowControl(runContext) {
  return workflowControlRequest?.runId === runContext.runId &&
    ["pause", "stop"].includes(workflowControlRequest.action)
    ? workflowControlRequest.action
    : null;
}

function isWorkflowControlError(error) {
  return (
    error instanceof WorkflowControlError ||
    error?.name === "WorkflowControlError"
  );
}

class WorkflowControlError extends Error {
  constructor(control) {
    super(control === "pause" ? "Run paused." : "Run stopped.");
    this.name = "WorkflowControlError";
    this.control = control;
  }
}

async function requestWorkflowControl(action, { reason = null } = {}) {
  await ensureAutoLeadRunState();
  const state = await readAutoLeadRunState();
  if (action === "pause") {
    if (state.status === "paused" || state.status === "pausing") return state;
    if (state.status !== "running") return state;

    workflowControlRequest = { runId: state.runId, action: "pause", reason };
    const next = await writeAutoLeadRunState({
      ...state,
      status: workflowPromise ? "pausing" : "paused",
      phase: workflowPromise ? state.phase : "paused",
      pausedAt: workflowPromise ? null : Date.now(),
      message: reason ||
        (workflowPromise
          ? "Pausing after the current safe step..."
          : "Paused. Resume to continue from the last completed step."),
    });
    if (activeWorkflowTabId) {
      await sendStatusToProtectedActiveTab(
        state,
        "Pausing after the current safe step...",
      );
    }
    return next;
  }

  if (action !== "stop") throw new Error("Unknown run control.");
  if (["idle", "completed", "stopped"].includes(state.status)) return state;

  workflowControlRequest = { runId: state.runId, action: "stop" };
  const automationWindowId = state.automationWindowId || activeAutomationWindowId;
  const automationHomeTabId = state.automationHomeTabId || null;
  const next = await writeAutoLeadRunState({
    ...state,
    status: "stopped",
    phase: "stopped",
    message: "Run stopped completely. Start again whenever you are ready.",
    specificLeadId: null,
    currentLead: null,
    automationWindowId: null,
    automationHomeTabId: null,
    automationTabGroupId: null,
    progress: null,
    result: null,
    stoppedAt: Date.now(),
    completedAt: Date.now(),
  });
  if (activeWorkflowTabId && automationWindowId) {
    await sendStatusToProtectedActiveTab(state, "Stopped.");
  }
  activeAutomationWindowId = null;
  await closeManagedAutomationWindow(
    automationWindowId,
    automationHomeTabId,
  ).catch(() => {});
  return next;
}

async function finalizeControlledRun(runContext, control) {
  const state = await readAutoLeadRunState();
  if (state.runId !== runContext.runId || state.status === "stopped") {
    return state;
  }
  if (control === "stop") {
    return writeAutoLeadRunState({
      ...state,
      status: "stopped",
      phase: "stopped",
      message: "Run stopped completely. Start again whenever you are ready.",
      specificLeadId: null,
      currentLead: null,
      automationWindowId: null,
      automationHomeTabId: null,
      automationTabGroupId: null,
      progress: null,
      result: null,
      stoppedAt: Date.now(),
      completedAt: Date.now(),
    });
  }
  return writeAutoLeadRunState({
    ...state,
    status: "paused",
    phase: "paused",
    message: workflowControlRequest?.reason ||
      "Paused. Resume to continue from the last completed step.",
    pausedAt: Date.now(),
  });
}

function defaultAutoLeadRunState() {
  return {
    status: "idle",
    runId: null,
    specificLeadId: null,
    startedAt: null,
    resumedAt: null,
    pausedAt: null,
    stoppedAt: null,
    completedAt: null,
    updatedAt: Date.now(),
    phase: "idle",
    message: "Ready to start today’s work.",
    currentLead: null,
    automationWindowId: null,
    automationHomeTabId: null,
    automationTabGroupId: null,
    progress: null,
    result: null,
    error: null,
  };
}

function defaultRunProgress() {
  return {
    reviewComplete: false,
    review: emptyConnectionReview(),
    autoWithdrawComplete: false,
    autoWithdraw: { withdrawnCount: 0 },
    targetRequests: null,
    processedLeads: 0,
    requestsSent: 0,
    results: [],
    failedLeads: [],
    pendingConnectionRequests: [],
  };
}

function normalizeRunProgress(value) {
  const fallback = defaultRunProgress();
  if (!value || typeof value !== "object") return fallback;
  return {
    reviewComplete: value.reviewComplete === true,
    review: {
      ...fallback.review,
      ...(value.review && typeof value.review === "object" ? value.review : {}),
    },
    autoWithdrawComplete: value.autoWithdrawComplete === true,
    autoWithdraw:
      value.autoWithdraw && typeof value.autoWithdraw === "object"
        ? value.autoWithdraw
        : fallback.autoWithdraw,
    targetRequests:
      value.targetRequests === null || value.targetRequests === undefined
        ? null
        : Math.max(0, Math.trunc(Number(value.targetRequests) || 0)),
    processedLeads: Math.max(0, Math.trunc(Number(value.processedLeads) || 0)),
    requestsSent: Math.max(0, Math.trunc(Number(value.requestsSent) || 0)),
    results: Array.isArray(value.results) ? value.results : [],
    failedLeads: Array.isArray(value.failedLeads) ? value.failedLeads : [],
    pendingConnectionRequests: Array.isArray(value.pendingConnectionRequests)
      ? value.pendingConnectionRequests
      : [],
  };
}

function upsertPendingConnectionRequest(requests, request) {
  const next = Array.isArray(requests) ? [...requests] : [];
  const existingIndex = next.findIndex(
    (item) => item?.leadId === request.leadId,
  );
  if (existingIndex >= 0) next[existingIndex] = request;
  else next.push(request);
  return next;
}

function collectLocallyConfirmedConnectionRequests(state) {
  const progress = state?.progress || {};
  const result = state?.result || {};
  const candidates = [
    ...(Array.isArray(progress.pendingConnectionRequests)
      ? progress.pendingConnectionRequests
      : []),
    ...(Array.isArray(progress.failedLeads)
      ? progress.failedLeads.filter((lead) => lead?.requestSent === true)
      : []),
    ...(Array.isArray(result.failedLeads)
      ? result.failedLeads.filter((lead) => lead?.requestSent === true)
      : []),
  ];
  const unique = new Map();
  for (const candidate of candidates) {
    const leadId = String(candidate?.leadId || "").trim();
    if (!leadId || unique.has(leadId)) continue;
    unique.set(leadId, { ...candidate, leadId });
  }
  return [...unique.values()];
}

async function reconcileLocallyConfirmedConnectionRequests(state = null) {
  const current = state || (await readAutoLeadRunState());
  const confirmed = collectLocallyConfirmedConnectionRequests(current);
  if (confirmed.length === 0) return current;

  const reconciledLeadIds = new Set();
  for (const request of confirmed) {
    const args = { leadId: request.leadId };
    if (request.profileUrl) args.profileUrl = request.profileUrl;
    try {
      await completeConnectionRequestWithRetry(args);
      reconciledLeadIds.add(request.leadId);
    } catch (error) {
      console.warn(
        `Connection request sync is still pending for ${request.leadId}:`,
        cleanError(error),
      );
    }
  }
  if (reconciledLeadIds.size === 0) return current;

  const progress = current.progress
    ? normalizeRunProgress({
        ...current.progress,
        pendingConnectionRequests:
          current.progress.pendingConnectionRequests?.filter(
            (request) => !reconciledLeadIds.has(request?.leadId),
          ) || [],
        failedLeads:
          current.progress.failedLeads?.filter(
            (lead) =>
              !(
                lead?.requestSent === true &&
                reconciledLeadIds.has(lead?.leadId)
              ),
          ) || [],
      })
    : null;
  const result = current.result
    ? {
        ...current.result,
        failedLeads:
          current.result.failedLeads?.filter(
            (lead) =>
              !(
                lead?.requestSent === true &&
                reconciledLeadIds.has(lead?.leadId)
              ),
          ) || [],
      }
    : null;
  const recoveredFailedRun =
    current.status === "failed" &&
    current.progress?.failedLeads?.some(
      (lead) =>
        lead?.requestSent === true && reconciledLeadIds.has(lead?.leadId),
    ) &&
    (progress?.failedLeads?.length || 0) === 0;

  return writeAutoLeadRunState({
    ...current,
    status: recoveredFailedRun ? "completed" : current.status,
    phase: recoveredFailedRun ? "completed" : current.phase,
    message: recoveredFailedRun
      ? "The sent connection request is confirmed and synced."
      : current.message,
    error: recoveredFailedRun ? null : current.error,
    completedAt: recoveredFailedRun ? Date.now() : current.completedAt,
    progress,
    result,
  });
}

function normalizeAutoLeadRunState(value) {
  const fallback = defaultAutoLeadRunState();
  if (!value || typeof value !== "object") return fallback;
  const allowedStatuses = new Set([
    "idle",
    "running",
    "pausing",
    "paused",
    "stopped",
    "completed",
    "failed",
  ]);
  return {
    ...fallback,
    ...value,
    status: allowedStatuses.has(value.status) ? value.status : "idle",
    progress: value.progress ? normalizeRunProgress(value.progress) : null,
    currentLead:
      value.currentLead && typeof value.currentLead === "object"
        ? value.currentLead
        : null,
  };
}

function emptyConnectionReview() {
  return {
    reviewed: false,
    acceptedMatched: 0,
    contactsChecked: 0,
    emailsCollected: 0,
  };
}

async function prepareAutomationWindow(
  runContext,
  resumeState = null,
  previousStateToClose = null,
) {
  if (resumeState) {
    const existing = await getManagedAutomationContext(resumeState).catch(
      () => null,
    );
    if (existing) {
      await chrome.windows.update(existing.automationWindowId, { focused: true });
      await chrome.tabs.update(existing.automationHomeTabId, { active: true });
      return existing;
    }
    await closeManagedAutomationWindow(
      resumeState.automationWindowId,
      resumeState.automationHomeTabId,
    ).catch(() => {});
  }

  if (previousStateToClose?.automationWindowId) {
    await closeManagedAutomationWindow(
      previousStateToClose.automationWindowId,
      previousStateToClose.automationHomeTabId,
    ).catch(() => {});
  }

  throwIfWorkflowControlled(runContext);
  const created = await chrome.windows.create({
    url: AUTOMATION_HOME_URL,
    type: "normal",
    focused: true,
    width: 1180,
    height: 820,
  });
  if (!created?.id) {
    throw new Error("We couldn’t open the dedicated automation window.");
  }
  const tabs = created.tabs?.length
    ? created.tabs
    : await chrome.tabs.query({ windowId: created.id });
  const homeTab = tabs.find(
    (tab) => tab.url === AUTOMATION_HOME_URL || tab.pendingUrl === AUTOMATION_HOME_URL,
  );
  if (!homeTab?.id) {
    await chrome.windows.remove(created.id).catch(() => {});
    throw new Error("The automation window opened without its status tab.");
  }
  try {
    const groupId = await chrome.tabs.group({
      tabIds: homeTab.id,
      createProperties: { windowId: created.id },
    });
    await styleAutomationTabGroup(groupId);
    return {
      automationWindowId: created.id,
      automationHomeTabId: homeTab.id,
      automationTabGroupId: groupId,
    };
  } catch (error) {
    await chrome.windows.remove(created.id).catch(() => {});
    throw error;
  }
}

async function getManagedAutomationContext(state) {
  const windowId = Number(state.automationWindowId);
  const homeTabId = Number(state.automationHomeTabId);
  if (!Number.isInteger(windowId) || !Number.isInteger(homeTabId)) return null;
  const window = await chrome.windows.get(windowId, { populate: true });
  const homeTab = window.tabs?.find((tab) => tab.id === homeTabId);
  if (!isManagedAutomationHomeTab(homeTab, windowId)) {
    return null;
  }

  let groupId = Number(state.automationTabGroupId);
  let group = Number.isInteger(groupId)
    ? await chrome.tabGroups.get(groupId).catch(() => null)
    : null;
  if (!group || group.windowId !== windowId) {
    groupId = Number(homeTab.groupId);
    group = Number.isInteger(groupId) && groupId >= 0
      ? await chrome.tabGroups.get(groupId).catch(() => null)
      : null;
    if (!group || group.windowId !== windowId) {
      groupId = await chrome.tabs.group({
        tabIds: homeTabId,
        createProperties: { windowId },
      });
    }
  }
  await styleAutomationTabGroup(groupId);
  const staleWorkerTabIds = (window.tabs || [])
    .filter((tab) => tab.id !== homeTabId && tab.groupId === groupId)
    .map((tab) => tab.id)
    .filter(Number.isInteger);
  if (staleWorkerTabIds.length > 0) {
    await chrome.tabs.remove(staleWorkerTabIds).catch(() => {});
  }
  return {
    automationWindowId: windowId,
    automationHomeTabId: homeTabId,
    automationTabGroupId: groupId,
  };
}

async function styleAutomationTabGroup(groupId) {
  await chrome.tabGroups.update(groupId, {
    title: AUTOMATION_GROUP_TITLE,
    color: "purple",
    collapsed: false,
  });
}

async function closeManagedAutomationWindow(windowId, homeTabId) {
  if (!Number.isInteger(Number(windowId)) || !Number.isInteger(Number(homeTabId))) {
    return false;
  }
  const homeTab = await chrome.tabs.get(Number(homeTabId)).catch(() => null);
  if (!isManagedAutomationHomeTab(homeTab, Number(windowId))) {
    return false;
  }
  await chrome.windows.remove(Number(windowId));
  return true;
}

async function createAutomationTab(runContext, url, { active = true } = {}) {
  throwIfWorkflowControlled(runContext);
  await assertAutomationWindow(runContext);
  const tab = await chrome.tabs.create({
    windowId: runContext.automationWindowId,
    url,
    active,
  });
  if (!tab?.id) throw new Error("The automation tab did not open.");
  try {
    const groupId = await chrome.tabs.group({
      tabIds: tab.id,
      groupId: runContext.automationTabGroupId,
    });
    if (groupId !== runContext.automationTabGroupId) {
      throw new Error("The automation tab opened outside its protected group.");
    }
  } catch (error) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    throw error;
  }
  setActiveWorkflowTab(runContext, tab.id);
  return tab;
}

async function assertAutomationWindow(runContext) {
  const windowId = Number(runContext.automationWindowId);
  if (!Number.isInteger(windowId) || windowId !== activeAutomationWindowId) {
    throw new Error("The dedicated automation window is not available.");
  }
  await chrome.windows.get(windowId);
}

async function assertAutomationTab(runContext, tabId) {
  await assertAutomationWindow(runContext);
  const tab = await chrome.tabs.get(tabId);
  if (!isProtectedAutomationTab(tab, runContext)) {
    throw new Error(
      "Automation stopped because its tab was moved outside the protected window.",
    );
  }
  return tab;
}

function isProtectedAutomationTab(tab, runContext) {
  return Boolean(
    tab &&
      tab.windowId === runContext.automationWindowId &&
      tab.groupId === runContext.automationTabGroupId,
  );
}

function isManagedAutomationHomeTab(tab, windowId) {
  return Boolean(
    tab &&
      tab.windowId === windowId &&
      (tab.url === AUTOMATION_HOME_URL ||
        tab.pendingUrl === AUTOMATION_HOME_URL),
  );
}

async function waitForAutomationContentScript(runContext, tabId) {
  await assertAutomationTab(runContext, tabId);
  const page = await waitForContentScript(tabId);
  await assertAutomationTab(runContext, tabId);
  const marker = await sendMessageToTab(tabId, {
    type: "SET_AUTOMATION_CONTEXT",
    runId: runContext.runId,
    groupTitle: AUTOMATION_GROUP_TITLE,
  });
  if (!marker?.ok) {
    throw new Error("We couldn’t mark the protected automation tab.");
  }
  return page;
}

async function sendAutomationMessageToTab(runContext, tabId, message) {
  await assertAutomationTab(runContext, tabId);
  return sendMessageToTab(tabId, message);
}

async function sendStatusToProtectedActiveTab(state, status) {
  if (!activeWorkflowTabId) return;
  const tab = await chrome.tabs.get(activeWorkflowTabId).catch(() => null);
  if (!isProtectedAutomationTab(tab, state)) return;
  await sendMessageToTab(activeWorkflowTabId, {
    type: "SHOW_AUTOMATION_STATUS",
    status,
  }).catch(() => {});
}

async function pauseRunAfterAutomationWindowClosed() {
  activeAutomationWindowId = null;
  const state = await requestWorkflowControl("pause", {
    reason:
      "The automation window was closed. The run paused safely; Resume will open a protected window and continue.",
  });
  if (state.runId) {
    await writeAutoLeadRunState({
      ...state,
      automationWindowId: null,
      automationHomeTabId: null,
      automationTabGroupId: null,
    });
  }
}

function createRunId() {
  return globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function setActiveWorkflowTab(runContext, tabId) {
  throwIfWorkflowControlled(runContext);
  activeWorkflowTabId = tabId;
}

function clearActiveWorkflowTab(tabId) {
  if (activeWorkflowTabId === tabId) activeWorkflowTabId = null;
}

async function reviewAcceptedConnections(dashboard, runContext) {
  const empty = emptyConnectionReview();
  if (!dashboard.hasSentConnectionRequest) return empty;

  throwIfWorkflowControlled(runContext);
  const plan = await ScoutApi.authenticatedAction(
    "scouts:getConnectionReviewPlan",
  );
  if (!plan.shouldReview) return empty;

  const tab = await createAutomationTab(runContext, CONNECTIONS_URL);
  if (!tab?.id) throw new Error("We couldn’t open your LinkedIn connections.");
  let reviewResult;
  try {
    await waitForTabComplete(tab.id);
    throwIfWorkflowControlled(runContext);
    await waitForAutomationContentScript(runContext, tab.id);
    const scan = await sendAutomationMessageToTab(runContext, tab.id, {
      type: "SCAN_RECENT_CONNECTIONS",
      options: {
        checkpoint: plan.checkpoint,
        cutoffDate: plan.cutoffDate,
        maxProfiles: 250,
      },
    });
    throwIfWorkflowControlled(runContext);
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
    throwIfWorkflowControlled(runContext);
  } finally {
    clearActiveWorkflowTab(tab.id);
    await chrome.tabs.remove(tab.id).catch(() => {});
  }

  const contactLeads = uniqueLeads([
    ...(plan.contactLeads || []),
    ...(reviewResult.acceptedLeads || []),
  ]);
  let contactsChecked = 0;
  let emailsCollected = 0;
  for (const lead of contactLeads) {
    throwIfWorkflowControlled(runContext);
    await updateActiveRunState(runContext, {
      phase: "reviewing_contacts",
      message: `Checking contact details for ${lead.fullName}...`,
      currentLead: {
        id: lead.id,
        fullName: lead.fullName,
        status: "accepted",
      },
    });
    const result = await collectAcceptedContact(lead, runContext).catch(async (error) => {
      if (isWorkflowControlError(error)) throw error;
      await ScoutApi.authenticatedAction("scouts:reportError", {
        leadId: lead.id,
        message: cleanError(error),
      }).catch(() => {});
      return null;
    });
    if (!result) continue;
    contactsChecked += 1;
    if (result.email) emailsCollected += 1;
    throwIfWorkflowControlled(runContext);
  }
  return {
    reviewed: true,
    acceptedMatched: Number(reviewResult.matched || 0),
    contactsChecked,
    emailsCollected,
  };
}

async function autoWithdrawOldRequests(runContext = null) {
  if (runContext) throwIfWorkflowControlled(runContext);
  const scoutOps = await ScoutApi.authenticatedAction(
    "scouts:getScoutOperations",
    {},
  ).catch(() => null);
  const oldRequests = scoutOps?.oldRequests || [];

  if (!oldRequests || oldRequests.length === 0) {
    return {
      withdrawnCount: 0,
      withdrawnLeads: [],
      message: "No requests >=30 days old found in DB.",
    };
  }

  const tab = runContext
    ? await createAutomationTab(runContext, SENT_INVITATIONS_URL)
    : await chrome.tabs.create({ url: SENT_INVITATIONS_URL, active: true });
  if (!tab?.id) {
    throw new Error("We couldn’t open your LinkedIn sent invitations.");
  }

  try {
    await waitForTabComplete(tab.id);
    if (runContext) throwIfWorkflowControlled(runContext);
    if (runContext) await waitForAutomationContentScript(runContext, tab.id);
    else await waitForContentScript(tab.id);

    const withdrawMessage = {
      type: "WITHDRAW_OLD_SENT_INVITATIONS",
      options: { dbLeads: oldRequests },
    };
    const withdrawResponse = runContext
      ? await sendAutomationMessageToTab(runContext, tab.id, withdrawMessage)
      : await sendMessageToTab(tab.id, withdrawMessage);

    if (!withdrawResponse?.ok) {
      if (runContext) throwIfWorkflowControlled(runContext);
      throw new Error(
        withdrawResponse?.error || "Failed to withdraw old invitations.",
      );
    }

    const withdrawnList = withdrawResponse.result?.withdrawn || [];
    for (const item of withdrawnList) {
      if (item.leadId) {
        await ScoutApi.authenticatedAction("scouts:markOldRequestWithdrawn", {
          leadId: item.leadId,
        }).catch((err) => {
          console.warn("Failed to mark lead withdrawn in DB:", item.leadId, err);
        });
      }
    }
    if (runContext) throwIfWorkflowControlled(runContext);

    await updateBadge();
    return {
      withdrawnCount: withdrawnList.length,
      withdrawnLeads: withdrawnList,
    };
  } finally {
    if (runContext) clearActiveWorkflowTab(tab.id);
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function collectAcceptedContact(lead, runContext) {
  const requestedProfileUrl = normalizeLinkedInProfileUrl(lead.profileUrl);
  const tab = await createAutomationTab(runContext, requestedProfileUrl);
  if (!tab?.id) throw new Error("We couldn’t open this LinkedIn profile.");
  try {
    await waitForTabComplete(tab.id);
    throwIfWorkflowControlled(runContext);
    const profileUrl = await waitForResolvedLinkedInProfileUrl(
      tab.id,
      requestedProfileUrl,
    );
    await waitForAutomationContentScript(runContext, tab.id);
    const contact = await sendAutomationMessageToTab(runContext, tab.id, {
      type: "EXTRACT_CONTACT_INFO",
      options: { expectedProfileUrl: profileUrl },
    });
    throwIfWorkflowControlled(runContext);
    if (!contact?.ok) {
      throw new Error(contact?.error || "We couldn’t read the contact info.");
    }
    return ScoutApi.authenticatedAction("scouts:recordContactInfo", {
      leadId: lead.id,
      profileUrl,
      email: contact.result.email || null,
    });
  } finally {
    clearActiveWorkflowTab(tab.id);
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function runLeadWorkflow(lead, settings, usage, runContext, progress) {
  let workflowTabId = null;
  let connectionReserved = false;
  let requestSubmitted = false;
  let connectionPersistencePending = false;
  let completedEngagementCount = 0;
  let resolvedProfileUrl = lead.linkedinUrl;
  try {
    throwIfWorkflowControlled(runContext);
    let includeNote = Boolean(settings.includeNote && settings.linkedinPremium);
    let noteDisabledForEligibility = false;
    if (includeNote) {
      const eligibility = await verifyLinkedInPremium(runContext);
      if (!eligibility.premium) {
        includeNote = false;
        noteDisabledForEligibility = true;
        await disableInvitationNoteSetting(settings).catch(() => {});
      }
    }
    throwIfWorkflowControlled(runContext);

    const requestedProfileUrl = normalizeLinkedInProfileUrl(lead.linkedinUrl);
    const localSettings = await chrome.storage.local.get([
      "validateBeforeCommenting",
      "invitationNote",
    ]);
    const postEngagements = Math.min(
      clampInteger(settings.postEngagements ?? 3, 1, 10),
      clampInteger(usage.engagementRemaining ?? 0, 0, 250),
    );
    const needsEngagement = lead.status !== "engaged";
    if (needsEngagement && postEngagements < 1) {
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

    const tab = await createAutomationTab(runContext, requestedProfileUrl);
    workflowTabId = tab.id;
    await waitForTabComplete(tab.id);
    throwIfWorkflowControlled(runContext);
    const profileUrl = await waitForResolvedLinkedInProfileUrl(
      tab.id,
      requestedProfileUrl,
    );
    resolvedProfileUrl = profileUrl;
    await ScoutApi.authenticatedAction("scouts:recordProfileVisit", {
      leadId: lead.id,
      resolvedLinkedinUrl: profileUrl,
    });
    throwIfWorkflowControlled(runContext);

    let engagementResponse = {
      ok: true,
      result: { engagedCount: 0, resumedAfterEngagement: true },
    };
    if (needsEngagement) {
      const recentActivityUrl = `${profileUrl}/recent-activity/all/`;
      await chrome.tabs.update(tab.id, { url: recentActivityUrl });
      await waitForTabComplete(tab.id);
      throwIfWorkflowControlled(runContext);
      await waitForAutomationContentScript(runContext, tab.id);
      engagementResponse = await sendAutomationMessageToTab(runContext, tab.id, {
        type: "EXECUTE_POST_ENGAGEMENT",
        options: { ...automationOptions, profileUrl },
      });
      if (!engagementResponse?.ok) {
        throwIfWorkflowControlled(runContext);
        throw new Error(
          engagementResponse?.error ||
            "We couldn’t finish this lead’s posts.",
        );
      }
      completedEngagementCount =
        engagementResponse.result?.engagedCount ?? 0;
    }

    await checkpointRun(runContext, progress, {
      phase: "connecting",
      message: `Posts finished for ${lead.fullName}. Preparing the connection request...`,
      currentLead: {
        id: lead.id,
        fullName: lead.fullName,
        status: "engaged",
      },
    });

    await chrome.tabs.update(tab.id, { url: profileUrl });
    await waitForTabComplete(tab.id);
    throwIfWorkflowControlled(runContext);
    await waitForAutomationContentScript(runContext, tab.id);
    if (noteDisabledForEligibility) {
      await sendAutomationMessageToTab(runContext, tab.id, {
        type: "SHOW_AUTOMATION_STATUS",
        status:
          "Premium is not active, so no note will be added.",
      });
    }

    await ScoutApi.authenticatedAction("scouts:reserveConnectionRequest", {
      leadId: lead.id,
    });
    connectionReserved = true;
    throwIfWorkflowControlled(runContext);
    const connectResponse = await sendAutomationMessageToTab(runContext, tab.id, {
      type: "EXECUTE_CONNECTION_REQUEST",
      options: {
        expectedProfileName: lead.fullName,
        expectedProfileUrl: profileUrl,
        includeNote,
        invitationNote: automationOptions.invitationNote,
      },
    });
    if (!connectResponse?.ok) {
      throwIfWorkflowControlled(runContext);
      throw new Error(
        connectResponse?.error || "We couldn’t send the connection request.",
      );
    }
    requestSubmitted = true;
    connectionPersistencePending = true;
    await completeConnectionRequestWithRetry({
      leadId: lead.id,
      profileUrl,
    });
    connectionPersistencePending = false;
    await updateRunProgress(runContext, progress, {
      phase: "working_leads",
      message: `Connection request sent to ${lead.fullName}.`,
      currentLead: {
        id: lead.id,
        fullName: lead.fullName,
        status: "connection_requested",
      },
    });
    return {
      leadId: lead.id,
      leadName: lead.fullName,
      status: "connection_requested",
      profileUrl,
      engagedCount: completedEngagementCount,
    };
  } catch (error) {
    const message = cleanError(error);
    if (connectionReserved && !requestSubmitted) {
      await ScoutApi.authenticatedAction("scouts:releaseConnectionRequest", {
        leadId: lead.id,
      }).catch(() => {});
    }
    const requestedControl = getRequestedWorkflowControl(runContext);
    if (isWorkflowControlError(error) || requestedControl) {
      if (requestSubmitted && connectionPersistencePending) {
        const alreadyRecorded = progress.results.some(
          (result) => result?.leadId === lead.id,
        );
        progress.pendingConnectionRequests = upsertPendingConnectionRequest(
          progress.pendingConnectionRequests,
          {
            leadId: lead.id,
            leadName: lead.fullName,
            profileUrl: resolvedProfileUrl,
            confirmedAt: Date.now(),
          },
        );
        if (!alreadyRecorded) {
          progress.requestsSent += 1;
          progress.processedLeads += 1;
          progress.results.push({
            leadId: lead.id,
            leadName: lead.fullName,
            status: "connection_requested_pending_sync",
            profileUrl: resolvedProfileUrl,
            engagedCount: completedEngagementCount,
          });
        }
        await updateRunProgress(runContext, progress, {
          message:
            "Paused safely after sending the connection request. Resume will continue with the next lead while it syncs.",
          currentLead: null,
        });
      }
      throw isWorkflowControlError(error)
        ? error
        : new WorkflowControlError(requestedControl);
    }
    if (workflowTabId) {
      const feedback = requestSubmitted
        ? {
            type: "SHOW_AUTOMATION_STATUS",
            status:
              "Connection request sent. Callum Scout will finish syncing it automatically.",
          }
        : { type: "SHOW_AUTOMATION_ERROR", error: message };
      await sendAutomationMessageToTab(
        runContext,
        workflowTabId,
        feedback,
      ).catch(() => {});
    }
    const workflowError = new Error(message);
    workflowError.requestSubmitted = requestSubmitted;
    workflowError.persistencePending = connectionPersistencePending;
    workflowError.profileUrl = resolvedProfileUrl;
    workflowError.engagedCount = completedEngagementCount;
    throw workflowError;
  } finally {
    if (workflowTabId) {
      clearActiveWorkflowTab(workflowTabId);
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

function verifyLinkedInPremium(runContext = null) {
  if (runContext) return inspectLinkedInPremium(runContext);
  if (premiumCheckPromise) return premiumCheckPromise;
  premiumCheckPromise = inspectLinkedInPremium(null).finally(() => {
    premiumCheckPromise = null;
  });
  return premiumCheckPromise;
}

async function inspectLinkedInPremium(runContext = null) {
  const tab = runContext
    ? await createAutomationTab(runContext, PREMIUM_URL, { active: false })
    : await chrome.tabs.create({ url: PREMIUM_URL, active: false });
  if (!tab?.id) throw new Error("We couldn’t open LinkedIn to check Premium.");
  try {
    const finalUrl = await waitForStableTabUrl(tab.id);
    let inspection = {
      premium: false,
      evidence: "LinkedIn did not open the Premium page. Try again.",
    };
    if (isLinkedInPremiumUrl(finalUrl)) {
      if (runContext) await waitForAutomationContentScript(runContext, tab.id);
      else await waitForContentScript(tab.id);
      const inspectionMessage = { type: "INSPECT_PREMIUM_ACCOUNT" };
      const response = runContext
        ? await sendAutomationMessageToTab(runContext, tab.id, inspectionMessage)
        : await sendMessageToTab(tab.id, inspectionMessage);
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
    if (runContext) clearActiveWorkflowTab(tab.id);
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

async function completeConnectionRequestWithRetry(args) {
  let lastError = null;
  for (const delayMs of CONNECTION_COMPLETION_RETRY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      await ScoutApi.authenticatedAction(
        "scouts:completeConnectionRequest",
        args,
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("The sent connection request could not be synced.");
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
