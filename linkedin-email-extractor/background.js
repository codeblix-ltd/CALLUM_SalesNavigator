import { WorkEmailApi } from "./api.js";
import { createQueueScheduler } from "./queue-scheduler.js";
import {
  describeHttpFailure,
  isRateLimitFailure,
  isRateLimitMessage,
  isTransientFailure,
  rateLimitAction,
  RATE_LIMIT_RETRY_DELAY_MS,
  retryDelayMs,
} from "./queue-policy.js";

const STORAGE_KEY = "queueState";
const TOOL_PAGE = "https://mailmeteor.com/tools/linkedin-email-finder";
const API_HOST = "tools.mailmeteor.com";
const API_PATH = "/api/email-finder/linkedin";
const RESOLVE_SETTLE_MS = 2200;
const WORKER_PAGE = "worker.html";
const OFFSCREEN_PAGE = "offscreen.html";
const RATE_LIMIT_RETRY_ALARM = "workEmailRateLimitRetry";

const DEFAULT_SETTINGS = Object.freeze({
  concurrency: 4,
  staggerMs: 1800,
  timeoutMs: 300000,
  maxRetries: 3,
  keepFailedTabs: true
});

const tabToJob = new Map();
const captureByTab = new Map();
const requestsByTab = new Map();
const timeoutByTab = new Map();
const resolutionByTab = new Map();
const finishingJobs = new Set();
let stateLock = Promise.resolve();
let processingWindowPromise = null;
let offscreenDocumentPromise = null;
const queueScheduler = createQueueScheduler(() => pumpQueue(), {
  onError(error) {
    pauseQueueAfterInternalError(error).catch((pauseError) => {
      console.error("Queue scheduler and pause handling failed", error, pauseError);
    });
  },
});

function emptyState() {
  return {
    version: 5,
    runId: null,
    running: false,
    paused: false,
    pauseReason: null,
    stopRequested: false,
    createdAt: null,
    completedAt: null,
    updatedAt: Date.now(),
    nextLaunchAllowedAt: 0,
    workerWindowId: null,
    settings: { ...DEFAULT_SETTINGS },
    jobs: []
  };
}

async function readState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeStoredState(stored[STORAGE_KEY]);
}

function normalizeStoredState(stored) {
  if (!stored) return emptyState();
  const storedVersion = Number(stored.version || 0);
  const legacyQueue = storedVersion < 4;
  const legacySettings = stored.settings || {};
  const settings = validateSettings({
    ...legacySettings,
    concurrency: legacyQueue && Number(legacySettings.concurrency) === 1
      ? DEFAULT_SETTINGS.concurrency
      : legacySettings.concurrency,
    timeoutMs: storedVersion < 5 && [60000, 120000].includes(Number(legacySettings.timeoutMs))
      ? DEFAULT_SETTINGS.timeoutMs
      : legacySettings.timeoutMs,
  });
  return {
    ...emptyState(),
    ...stored,
    version: 5,
    settings,
    jobs: (stored.jobs || []).map((job) => ({
      retryCount: 0,
      rateLimitRetryCount: 0,
      nextRetryAt: null,
      lastRetryError: null,
      ...job,
    })),
  };
}

async function writeState(state) {
  state.updatedAt = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function updateState(mutator) {
  const operation = stateLock.then(async () => {
    const state = await readState();
    const result = await mutator(state);
    await writeState(state);
    return { state, result };
  });
  stateLock = operation.catch(() => undefined);
  return operation;
}

function isLinkedInProfileUrl(value) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    return (
      (host === "linkedin.com" || host === "www.linkedin.com") &&
      /^\/in\/[^/?#]+\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function normalizeLinkedInUrl(value) {
  const url = new URL(value.trim());
  url.protocol = "https:";
  url.hostname = "www.linkedin.com";
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function profileSlug(value) {
  try {
    return new URL(value).pathname.split("/").filter(Boolean)[1] || "";
  } catch {
    return "";
  }
}

function requiresRedirectChange(value) {
  // LinkedIn's opaque profile identifiers commonly look like
  // ACwAAD3Xy04BHTT4FFZf2Ez5eHiMedMDtec5wYo. Do not send one to
  // Mailmeteor until LinkedIn has redirected it to the public profile slug.
  return /^AC[A-Za-z0-9_-]{18,}$/.test(profileSlug(value));
}

function validateSettings(input = {}) {
  const concurrency = Math.min(4, Math.max(1, Math.trunc(Number(input.concurrency) || DEFAULT_SETTINGS.concurrency)));
  const staggerMs = Math.min(10000, Math.max(500, Number(input.staggerMs) || DEFAULT_SETTINGS.staggerMs));
  const timeoutMs = Math.min(300000, Math.max(20000, Number(input.timeoutMs) || DEFAULT_SETTINGS.timeoutMs));
  const requestedRetries = Number(input.maxRetries);
  const maxRetries = Math.min(5, Math.max(
    0,
    Math.trunc(Number.isFinite(requestedRetries) ? requestedRetries : DEFAULT_SETTINGS.maxRetries),
  ));
  return {
    concurrency,
    staggerMs,
    timeoutMs,
    maxRetries,
    keepFailedTabs: input.keepFailedTabs !== false
  };
}

function makeJob(input, index) {
  const linkedinUrl = typeof input === "string" ? input : input.linkedinUrl;
  return {
    id: `${Date.now()}-${index}-${crypto.randomUUID()}`,
    index,
    source: typeof input === "string" ? "pasted" : input.source || "database",
    leadId: typeof input === "string" ? null : input.leadId || null,
    leadName: typeof input === "string" ? null : input.fullName || null,
    companyName: typeof input === "string" ? null : input.companyName || null,
    inputLinkedinUrl: linkedinUrl,
    linkedinUrl,
    resolvedLinkedinUrl: null,
    toolUrl: null,
    status: "queued",
    tabId: null,
    startedAt: null,
    finishedAt: null,
    responseUrl: null,
    httpStatus: null,
    result: null,
    rawResponse: null,
    error: null,
    retryCount: 0,
    rateLimitRetryCount: 0,
    nextRetryAt: null,
    lastRetryError: null,
    dbSaveStatus: null
  };
}

async function startRun(rawItems, rawSettings) {
  await requireDatabaseAuth();
  const seen = new Set();
  const invalid = [];
  const items = [];

  for (const raw of rawItems || []) {
    const value = String(typeof raw === "string" ? raw : raw?.linkedinUrl || "").trim();
    if (!value) continue;
    if (!isLinkedInProfileUrl(value)) {
      invalid.push(value);
      continue;
    }
    const normalized = normalizeLinkedInUrl(value);
    const key = typeof raw === "object" && raw?.leadId ? `lead:${raw.leadId}` : normalized;
    if (!seen.has(key)) {
      seen.add(key);
      items.push(typeof raw === "string" ? normalized : { ...raw, linkedinUrl: normalized });
    }
  }

  if (!items.length) {
    throw new Error("Add at least one valid LinkedIn profile URL (linkedin.com/in/...).");
  }

  const current = await readState();
  if (current.running) {
    throw new Error("A queue is already running. Stop it before starting another.");
  }
  if (current.paused && current.jobs?.length) {
    throw new Error("This queue is paused. Resume it from the failed lead or clear it before starting a new queue.");
  }

  const settings = validateSettings(rawSettings);
  await chrome.alarms.clear(RATE_LIMIT_RETRY_ALARM);
  if (current.workerWindowId) await safeCloseWindow(current.workerWindowId);
  const state = {
    version: 5,
    runId: crypto.randomUUID(),
    running: true,
    paused: false,
    pauseReason: null,
    stopRequested: false,
    createdAt: Date.now(),
    completedAt: null,
    updatedAt: Date.now(),
    nextLaunchAllowedAt: 0,
    workerWindowId: null,
    settings,
    jobs: items.map(makeJob)
  };
  await writeState(state);
  schedulePump(0);
  return { accepted: items.length, invalid };
}

async function startDatabaseRun(limit, rawSettings) {
  const requested = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
  const queue = await WorkEmailApi.authenticatedAction("workEmails:listQueue", {
    limit: requested,
  });
  if (!queue?.leads?.length) {
    throw new Error("There are no pending or retryable work-email leads in the database.");
  }
  const result = await startRun(
    queue.leads.map((lead) => ({ ...lead, source: "database" })),
    rawSettings,
  );
  return { ...result, remaining: Number(queue.remaining || queue.leads.length) };
}

function activeJobCount(state) {
  return state.jobs.filter((job) => ["starting", "resolving", "running", "capturing"].includes(job.status)).length;
}

function queuedJob(state) {
  return state.jobs.find((job) => job.status === "queued");
}

function schedulePump(delayMs) {
  queueScheduler.schedule(delayMs);
}

async function pauseQueueAfterInternalError(error) {
  const message = `Internal queue error: ${error?.message || String(error)}`;
  await updateState((state) => {
    state.running = false;
    state.paused = true;
    state.stopRequested = false;
    state.pauseReason = message;
  });
}

async function pumpQueue() {
  const state = await readState();
  if (!state.running || state.stopRequested) return;

  const active = activeJobCount(state);
  const next = queuedJob(state);

  if (!next) {
    if (active === 0) {
      const completion = await updateState((draft) => {
        if (!draft.running || draft.stopRequested || draft.paused) return null;
        if (activeJobCount(draft) !== 0 || queuedJob(draft)) return null;
        draft.running = false;
        draft.completedAt = Date.now();
        const workerWindowId = draft.workerWindowId;
        draft.workerWindowId = null;
        return { workerWindowId };
      });
      if (completion.result) {
        if (completion.result.workerWindowId) {
          await safeCloseWindow(completion.result.workerWindowId);
        }
        await playCompletionSound();
      }
    }
    return;
  }

  if (active >= state.settings.concurrency) return;

  const waitUntil = Math.max(state.nextLaunchAllowedAt || 0, next.nextRetryAt || 0);
  const waitMs = Math.max(0, waitUntil - Date.now());
  if (waitMs > 0) {
    schedulePump(waitMs);
    return;
  }

  const claimed = await updateState((draft) => {
    if (!draft.running || draft.stopRequested) return null;
    if (activeJobCount(draft) >= draft.settings.concurrency) return null;
    const job = queuedJob(draft);
    if (!job) return null;
    const eligibleAt = Math.max(draft.nextLaunchAllowedAt || 0, job.nextRetryAt || 0);
    if (eligibleAt > Date.now()) return null;

    job.status = "starting";
    job.startedAt = Date.now();
    job.nextRetryAt = null;
    job.error = null;
    job.rawResponse = null;
    draft.nextLaunchAllowedAt = Date.now() + draft.settings.staggerMs;
    return { job: structuredClone(job), settings: structuredClone(draft.settings) };
  });

  if (!claimed.result) return;
  launchJob(claimed.result.job, claimed.result.settings).catch((error) => {
    finishJob(claimed.result.job.id, "error", null, `Launch failed: ${error.message}`).catch(console.error);
  });

  schedulePump(claimed.result.settings.staggerMs);
}

async function launchJob(job, settings) {
  if (job.leadId) {
    await WorkEmailApi.authenticatedAction("workEmails:beginJob", {
      leadId: job.leadId,
    });
  }
  const workerWindowId = await ensureProcessingWindow();
  const tab = await chrome.tabs.create({
    windowId: workerWindowId,
    url: "about:blank",
    active: false,
  });
  if (!tab.id) throw new Error("Chrome did not return a tab ID.");

  const tabId = tab.id;
  tabToJob.set(tabId, job.id);

  await updateState((state) => {
    const current = state.jobs.find((item) => item.id === job.id);
    if (!current || state.stopRequested) return;
    current.tabId = tabId;
    current.status = "resolving";
  });

  const hardTimeoutId = setTimeout(() => {
    const resolution = resolutionByTab.get(tabId);
    if (!resolution) return;
    const detail = resolution.mustChange
      ? "LinkedIn did not redirect the opaque profile ID to a public profile URL. Make sure you are signed in to LinkedIn in this Chrome profile."
      : "Timed out while loading the LinkedIn profile URL.";
    finishJob(job.id, "timeout", null, detail).catch(console.error);
  }, settings.timeoutMs);

  resolutionByTab.set(tabId, {
    jobId: job.id,
    settings,
    inputUrl: job.linkedinUrl,
    mustChange: requiresRedirectChange(job.linkedinUrl),
    settleTimerId: null,
    hardTimeoutId,
    finalizing: false
  });

  try {
    await chrome.tabs.update(tabId, { url: job.linkedinUrl, active: false });
  } catch (error) {
    clearResolution(tabId);
    throw error;
  }
}

async function ensureProcessingWindow() {
  if (!processingWindowPromise) {
    processingWindowPromise = (async () => {
      const state = await readState();
      if (Number.isInteger(state.workerWindowId)) {
        try {
          await chrome.windows.get(state.workerWindowId);
          return state.workerWindowId;
        } catch {
          // The previous processing window was closed. Create a fresh one.
        }
      }

      const window = await chrome.windows.create({
        url: chrome.runtime.getURL(WORKER_PAGE),
        focused: false,
        type: "normal",
      });
      if (!window.id) throw new Error("Chrome did not return a processing window ID.");
      await updateState((draft) => {
        draft.workerWindowId = window.id;
      });
      return window.id;
    })();
  }

  try {
    return await processingWindowPromise;
  } finally {
    processingWindowPromise = null;
  }
}

function scheduleResolutionCheck(tabId) {
  const resolution = resolutionByTab.get(tabId);
  if (!resolution || resolution.finalizing) return;
  if (resolution.settleTimerId) clearTimeout(resolution.settleTimerId);
  resolution.settleTimerId = setTimeout(() => {
    finalizeLinkedInResolution(tabId).catch((error) => {
      const jobId = tabToJob.get(tabId);
      if (jobId) finishJob(jobId, "error", null, `Could not resolve LinkedIn URL: ${error.message}`).catch(console.error);
    });
  }, RESOLVE_SETTLE_MS);
}

async function finalizeLinkedInResolution(tabId) {
  const resolution = resolutionByTab.get(tabId);
  if (!resolution || resolution.finalizing) return;

  const tab = await chrome.tabs.get(tabId);
  const currentUrl = tab.url || "";
  if (!isLinkedInProfileUrl(currentUrl)) {
    throw new Error(`LinkedIn redirected to a non-profile page: ${currentUrl || "unknown URL"}`);
  }

  const resolvedUrl = normalizeLinkedInUrl(currentUrl);
  const inputUrl = normalizeLinkedInUrl(resolution.inputUrl);

  // Opaque AC... URLs must actually change. A completed page at the original
  // opaque URL may still be waiting for LinkedIn's client-side redirect.
  if (resolution.mustChange && resolvedUrl === inputUrl) return;

  resolution.finalizing = true;
  const { jobId, settings } = resolution;
  clearResolution(tabId);
  await beginMailmeteor(tabId, jobId, resolvedUrl, settings);
}

async function beginMailmeteor(tabId, jobId, resolvedUrl, settings) {
  const toolUrl = `${TOOL_PAGE}?linkedin-url=${encodeURIComponent(resolvedUrl)}`;

  await updateState((state) => {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job || state.stopRequested) return;
    job.resolvedLinkedinUrl = resolvedUrl;
    job.toolUrl = toolUrl;
    job.status = "starting";
  });

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
      maxTotalBufferSize: 5_000_000,
      maxResourceBufferSize: 1_000_000,
      maxPostDataSize: 100_000
    });

    await updateState((state) => {
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job || state.stopRequested) return;
      job.status = "running";
    });

    const timeoutId = setTimeout(() => {
      finishJob(jobId, "timeout", null, "Timed out waiting for the Mailmeteor API response.").catch(console.error);
    }, settings.timeoutMs);
    timeoutByTab.set(tabId, timeoutId);

    await chrome.tabs.update(tabId, { url: toolUrl, active: false });
  } catch (error) {
    throw error;
  }
}

function clearResolution(tabId) {
  const resolution = resolutionByTab.get(tabId);
  if (!resolution) return;
  if (resolution.settleTimerId) clearTimeout(resolution.settleTimerId);
  if (resolution.hardTimeoutId) clearTimeout(resolution.hardTimeoutId);
  resolutionByTab.delete(tabId);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const resolution = resolutionByTab.get(tabId);
  if (!resolution || resolution.finalizing) return;

  const currentUrl = changeInfo.url || tab.url || "";
  if (changeInfo.url && isLinkedInProfileUrl(currentUrl)) {
    // Reset the settle timer whenever LinkedIn changes the profile URL.
    if (resolution.settleTimerId) {
      clearTimeout(resolution.settleTimerId);
      resolution.settleTimerId = null;
    }
    // LinkedIn can replace the URL with the History API after the document is
    // already complete, in which case Chrome may not emit another status event.
    if (tab.status === "complete") scheduleResolutionCheck(tabId);
  }

  if (changeInfo.status === "complete") {
    scheduleResolutionCheck(tabId);
  }
});

function isTargetResponse(urlString) {
  try {
    const url = new URL(urlString);
    return url.hostname === API_HOST && url.pathname === API_PATH;
  } catch {
    return false;
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!tabId || !tabToJob.has(tabId)) return;

  if (method === "Network.requestWillBeSent" && isTargetResponse(params?.request?.url)) {
    let requests = requestsByTab.get(tabId);
    if (!requests) {
      requests = new Map();
      requestsByTab.set(tabId, requests);
    }
    requests.set(params.requestId, {
      method: String(params.request.method || "").toUpperCase(),
      url: params.request.url
    });
    return;
  }

  if (method === "Network.responseReceived" && isTargetResponse(params?.response?.url)) {
    const request = requestsByTab.get(tabId)?.get(params.requestId);
    const requestMethod = request?.method || "";
    const resourceType = String(params.type || "");

    // Ignore the CORS OPTIONS/Preflight response and capture only the real POST.
    if (resourceType === "Preflight" || requestMethod !== "POST") return;

    captureByTab.set(tabId, {
      source: { ...source },
      requestId: params.requestId,
      responseUrl: params.response.url,
      httpStatus: params.response.status
    });

    const jobId = tabToJob.get(tabId);
    updateState((state) => {
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job || !["running", "starting"].includes(job.status)) return;
      job.status = "capturing";
      job.responseUrl = params.response.url;
      job.httpStatus = params.response.status;
    }).catch(console.error);
    return;
  }

  if (method === "Network.loadingFinished") {
    requestsByTab.get(tabId)?.delete(params.requestId);
    const capture = captureByTab.get(tabId);
    if (!capture || capture.requestId !== params.requestId) return;
    captureByTab.delete(tabId);
    captureResponse(tabId, capture).catch((error) => {
      const jobId = tabToJob.get(tabId);
      if (jobId) finishJob(jobId, "error", null, `Could not read API response: ${error.message}`).catch(console.error);
    });
  }

  if (method === "Network.loadingFailed") {
    requestsByTab.get(tabId)?.delete(params.requestId);
    const capture = captureByTab.get(tabId);
    if (!capture || capture.requestId !== params.requestId) return;
    captureByTab.delete(tabId);
    const jobId = tabToJob.get(tabId);
    if (jobId) {
      finishJob(jobId, "error", null, `Mailmeteor API request failed: ${params.errorText || "network error"}`).catch(console.error);
    }
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getResponseBodyWithRetry(source, requestId) {
  const retryDelays = [0, 75, 150, 300, 600];
  let lastError;

  for (const delay of retryDelays) {
    if (delay) await sleep(delay);
    try {
      return await chrome.debugger.sendCommand(source, "Network.getResponseBody", { requestId });
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!message.includes("No resource with given identifier")) throw error;
    }
  }

  throw lastError || new Error("Response body was unavailable.");
}

async function captureResponse(tabId, capture) {
  const response = await getResponseBodyWithRetry(capture.source, capture.requestId);
  const text = decodeResponseBody(response?.body || "", Boolean(response?.base64Encoded));

  const httpFailure = describeHttpFailure(capture.httpStatus);
  if (httpFailure) {
    const jobId = tabToJob.get(tabId);
    if (jobId) {
      await finishJob(
        jobId,
        "error",
        null,
        httpFailure,
        text,
      );
    }
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Response was not valid JSON: ${text.slice(0, 180)}`);
  }

  const jobId = tabToJob.get(tabId);
  if (!jobId) return;

  if (data?.found === true && data?.email) {
    await finishJob(jobId, "found", data, null, text);
  } else if (data?.success === true || data?.found === false) {
    await finishJob(jobId, "not_found", data, null, text);
  } else {
    const message = data?.error?.message || data?.message || data?.error || "The API returned an unsuccessful response.";
    const detail = isRateLimitMessage(message)
      ? `Mailmeteor rate limit detected: ${String(message)}`
      : String(message);
    await finishJob(jobId, "error", data, detail, text);
  }
}

function decodeResponseBody(body, base64Encoded) {
  if (!base64Encoded) return body;
  const binary = atob(body);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function finishJob(jobId, status, result = null, error = null, rawResponse = null) {
  if (finishingJobs.has(jobId)) return;
  finishingJobs.add(jobId);
  try {
    await finalizeJob(jobId, status, result, error, rawResponse);
  } finally {
    finishingJobs.delete(jobId);
  }
}

async function finalizeJob(jobId, status, result = null, error = null, rawResponse = null) {
  const before = await readState();
  const existingJob = before.jobs.find((item) => item.id === jobId);
  if (!existingJob || ["found", "not_found", "error", "timeout", "stopped"].includes(existingJob.status)) {
    return;
  }

  let finalStatus = status;
  let finalError = error;
  let databaseResult = null;
  const httpStatus = Number.isFinite(Number(existingJob.httpStatus))
    ? Number(existingJob.httpStatus)
    : null;
  const rateLimited = ["error", "timeout"].includes(status)
    && isRateLimitFailure(httpStatus, error);
  const failedAfterRateLimitRetry = ["error", "timeout"].includes(status)
    && rateLimitAction(existingJob.rateLimitRetryCount) === "pause";

  if (failedAfterRateLimitRetry) {
    finalError = `${error || "The lookup failed."} The retry after 3 minutes failed. Queue paused.`;
    await haltQueueForRateLimit(finalError);
    await playRateLimitAlert();
  } else if (rateLimited) {
    const retry = await scheduleRateLimitRetry(existingJob, status, error, rawResponse);
    await playRateLimitAlert();
    if (retry) return;
    finalError = `${error || "Mailmeteor rate limit detected (HTTP 429)."} Queue paused.`;
    await haltQueueForRateLimit(finalError);
  } else if (["error", "timeout"].includes(status) && isTransientFailure(httpStatus, error, status)) {
    const retry = await scheduleAutomaticRetry(existingJob, status, error, rawResponse);
    if (retry) return;
  }

  if (["found", "not_found"].includes(status)) {
    try {
      databaseResult = await WorkEmailApi.authenticatedAction("workEmails:saveResult", {
        leadId: existingJob.leadId || null,
        inputLinkedinUrl: existingJob.inputLinkedinUrl || existingJob.linkedinUrl,
        resolvedLinkedinUrl: existingJob.resolvedLinkedinUrl || existingJob.linkedinUrl,
        status,
        email: result?.email || null,
        validation: result?.validation || null,
        httpStatus,
      });
    } catch (databaseError) {
      finalStatus = "error";
      finalError = `Database save failed: ${databaseError.message || String(databaseError)}`;
    }
  }

  if (["error", "timeout"].includes(finalStatus)) {
    try {
      databaseResult = await WorkEmailApi.authenticatedAction("workEmails:recordFailure", {
        leadId: existingJob.leadId || null,
        inputLinkedinUrl: existingJob.inputLinkedinUrl || existingJob.linkedinUrl,
        resolvedLinkedinUrl: existingJob.resolvedLinkedinUrl || null,
        error: finalError || "Work-email extraction failed.",
        httpStatus,
      });
    } catch (databaseError) {
      const detail = databaseError.message || String(databaseError);
      finalError = `${finalError || "Work-email extraction failed."} Database failure recording also failed: ${detail}`;
    }
  }

  const update = await updateState((state) => {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job || ["found", "not_found", "error", "timeout", "stopped"].includes(job.status)) {
      return null;
    }

    job.status = finalStatus;
    job.result = result;
    job.rawResponse = rawResponse;
    job.error = finalError;
    if (databaseResult?.leadId && !job.leadId) job.leadId = databaseResult.leadId;
    job.dbSaveStatus = databaseResult?.saved === true
      ? "saved"
      : databaseResult?.saved === false
        ? "not_matched"
        : finalStatus === "error" || finalStatus === "timeout"
          ? "failed"
          : null;
    job.finishedAt = Date.now();

    if (["error", "timeout"].includes(finalStatus)) {
      state.running = false;
      state.paused = true;
      state.stopRequested = false;
      state.pauseReason = finalError || "The queue paused because this lead failed.";
    }

    const tabId = job.tabId;
    const closeTab = finalStatus === "found" || finalStatus === "not_found" || !state.settings.keepFailedTabs;
    return { tabId, closeTab };
  });

  if (!update.result) return;
  if (["error", "timeout"].includes(finalStatus)) queueScheduler.clear();
  const { tabId, closeTab } = update.result;

  if (tabId != null) {
    clearResolution(tabId);
    const timeoutId = timeoutByTab.get(tabId);
    if (timeoutId) clearTimeout(timeoutId);
    timeoutByTab.delete(tabId);
    captureByTab.delete(tabId);
    requestsByTab.delete(tabId);
    tabToJob.delete(tabId);
    await safeDetach(tabId);
    if (closeTab) await safeCloseTab(tabId);
  }

  const latest = await readState();
  if (latest.running && !latest.stopRequested && !latest.paused) {
    schedulePump(0);
  } else if (!latest.paused && activeJobCount(latest) === 0) {
    await updateState((state) => {
      state.running = false;
    });
  }
}

async function haltQueueForRateLimit(message) {
  queueScheduler.clear();
  await chrome.alarms.clear(RATE_LIMIT_RETRY_ALARM);
  await updateState((state) => {
    state.running = false;
    state.paused = true;
    state.stopRequested = false;
    state.pauseReason = message;
  });
}

async function scheduleRateLimitRetry(existingJob, status, error, rawResponse) {
  const update = await updateState((state) => {
    const job = state.jobs.find((item) => item.id === existingJob.id);
    if (!job || !state.running || state.paused || state.stopRequested) return null;
    if (!["starting", "resolving", "running", "capturing"].includes(job.status)) return null;
    if (rateLimitAction(job.rateLimitRetryCount) !== "retry") return null;

    const retryAt = Date.now() + RATE_LIMIT_RETRY_DELAY_MS;
    const detail = error || (status === "timeout"
      ? "The lookup timed out after a Mailmeteor rate limit."
      : "Mailmeteor rate limit detected (HTTP 429).");
    const tabId = job.tabId;

    job.status = "queued";
    job.tabId = null;
    job.startedAt = null;
    job.finishedAt = null;
    job.responseUrl = null;
    job.httpStatus = null;
    job.result = null;
    job.rawResponse = rawResponse;
    job.rateLimitRetryCount = 1;
    job.nextRetryAt = retryAt;
    job.lastRetryError = detail;
    job.error = `${detail} Retrying this same lead once in exactly 3 minutes.`;
    job.dbSaveStatus = null;
    state.nextLaunchAllowedAt = Math.max(state.nextLaunchAllowedAt || 0, retryAt);
    return { tabId, delayMs: RATE_LIMIT_RETRY_DELAY_MS, retryAt };
  });

  if (!update.result) return false;
  queueScheduler.clear();
  const { tabId, delayMs, retryAt } = update.result;
  if (tabId != null) {
    clearResolution(tabId);
    const timeoutId = timeoutByTab.get(tabId);
    if (timeoutId) clearTimeout(timeoutId);
    timeoutByTab.delete(tabId);
    captureByTab.delete(tabId);
    requestsByTab.delete(tabId);
    tabToJob.delete(tabId);
    await safeDetach(tabId);
    await safeCloseTab(tabId);
  }
  await chrome.alarms.create(RATE_LIMIT_RETRY_ALARM, { when: retryAt });
  schedulePump(delayMs);
  return true;
}

async function scheduleAutomaticRetry(existingJob, status, error, rawResponse) {
  const update = await updateState((state) => {
    const job = state.jobs.find((item) => item.id === existingJob.id);
    if (!job || !state.running || state.paused || state.stopRequested) return null;
    if (!["starting", "resolving", "running", "capturing"].includes(job.status)) return null;

    const retryNumber = Number(job.retryCount || 0) + 1;
    if (retryNumber > state.settings.maxRetries) return null;
    const delayMs = retryDelayMs(retryNumber);
    const retryAt = Date.now() + delayMs;
    const detail = error || (status === "timeout" ? "The lookup timed out." : "The lookup failed temporarily.");
    const tabId = job.tabId;

    job.status = "queued";
    job.tabId = null;
    job.startedAt = null;
    job.finishedAt = null;
    job.responseUrl = null;
    job.httpStatus = null;
    job.result = null;
    job.rawResponse = rawResponse;
    job.retryCount = retryNumber;
    job.nextRetryAt = retryAt;
    job.lastRetryError = detail;
    job.error = `${detail} Automatic retry ${retryNumber}/${state.settings.maxRetries} starts in ${Math.round(delayMs / 1000)} seconds.`;
    job.dbSaveStatus = null;
    state.nextLaunchAllowedAt = Math.max(state.nextLaunchAllowedAt || 0, retryAt);
    return { tabId, delayMs };
  });

  if (!update.result) return false;
  queueScheduler.clear();
  const { tabId, delayMs } = update.result;
  if (tabId != null) {
    clearResolution(tabId);
    const timeoutId = timeoutByTab.get(tabId);
    if (timeoutId) clearTimeout(timeoutId);
    timeoutByTab.delete(tabId);
    captureByTab.delete(tabId);
    requestsByTab.delete(tabId);
    tabToJob.delete(tabId);
    await safeDetach(tabId);
    await safeCloseTab(tabId);
  }
  schedulePump(delayMs);
  return true;
}

async function stopRun() {
  queueScheduler.clear();

  const update = await updateState((state) => {
    state.stopRequested = true;
    state.running = false;
    state.paused = true;
    state.pauseReason = "Stopped by user. Resume starts again at the first unfinished lead.";
    const active = [];
    for (const job of state.jobs) {
      if (job.status === "queued") {
        job.status = "stopped";
        job.error = "Stopped before launch.";
        job.finishedAt = Date.now();
      } else if (["starting", "resolving", "running", "capturing"].includes(job.status)) {
        job.status = "stopped";
        job.error = "Stopped by user.";
        job.finishedAt = Date.now();
        if (job.tabId != null) active.push(job.tabId);
      }
    }
    const workerWindowId = state.workerWindowId;
    state.workerWindowId = null;
    return { active, workerWindowId };
  });

  for (const tabId of update.result?.active || []) {
    clearResolution(tabId);
    const timeoutId = timeoutByTab.get(tabId);
    if (timeoutId) clearTimeout(timeoutId);
    timeoutByTab.delete(tabId);
    captureByTab.delete(tabId);
    requestsByTab.delete(tabId);
    tabToJob.delete(tabId);
    await safeDetach(tabId);
    await safeCloseTab(tabId);
  }
  await chrome.alarms.clear(RATE_LIMIT_RETRY_ALARM);
  if (update.result?.workerWindowId) {
    await safeCloseWindow(update.result.workerWindowId);
  }
}

async function clearRun() {
  const state = await readState();
  if (state.running) throw new Error("Stop the current queue before clearing it.");
  await chrome.alarms.clear(RATE_LIMIT_RETRY_ALARM);
  if (state.workerWindowId) await safeCloseWindow(state.workerWindowId);
  await writeState(emptyState());
}

async function retryFailed() {
  await requireDatabaseAuth();
  await chrome.alarms.clear(RATE_LIMIT_RETRY_ALARM);
  const update = await updateState((state) => {
    if (state.running) throw new Error("The queue is already running.");
    let accepted = 0;
    for (const job of state.jobs) {
      if (!["queued", "error", "timeout", "stopped"].includes(job.status)) continue;
      job.status = "queued";
      job.tabId = null;
      job.startedAt = null;
      job.finishedAt = null;
      job.responseUrl = null;
      job.httpStatus = null;
      job.result = null;
      job.rawResponse = null;
      job.error = null;
      job.retryCount = 0;
      job.rateLimitRetryCount = 0;
      job.nextRetryAt = null;
      job.lastRetryError = null;
      job.dbSaveStatus = null;
      accepted += 1;
    }
    if (!accepted) throw new Error("There are no unfinished rows to resume.");
    state.running = true;
    state.paused = false;
    state.pauseReason = null;
    state.stopRequested = false;
    state.nextLaunchAllowedAt = 0;
    state.completedAt = null;
    return accepted;
  });
  schedulePump(0);
  return { accepted: update.result };
}

async function requireDatabaseAuth() {
  const auth = await WorkEmailApi.getAuth();
  if (!auth?.token || !auth.refreshToken) {
    throw new Error("Sign in as the administrator before starting or resuming a queue.");
  }
}

async function safeDetach(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Already detached or the tab was never attached.
  }
}

async function safeCloseTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Tab may already be closed.
  }
}

async function safeCloseWindow(windowId) {
  try {
    await chrome.windows.remove(windowId);
  } catch {
    // The processing window may already be closed.
  }
}

async function playCompletionSound() {
  await playSound("playCompletionSound", "completion sound");
}

async function playRateLimitAlert() {
  await playSound("playRateLimitAlert", "rate-limit alert");
}

async function playSound(type, label) {
  try {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({ target: "offscreen", type });
  } catch (error) {
    console.warn(`Could not play the ${label}`, error);
  }
}

async function ensureOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_PAGE);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl],
  });
  if (contexts.length) return;

  if (!offscreenDocumentPromise) {
    offscreenDocumentPromise = chrome.offscreen.createDocument({
        url: OFFSCREEN_PAGE,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play completion and rate-limit alerts for the work-email queue.",
    });
  }

  try {
    await offscreenDocumentPromise;
  } finally {
    offscreenDocumentPromise = null;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const jobId = tabToJob.get(tabId);
  if (!jobId) return;
  tabToJob.delete(tabId);
  clearResolution(tabId);
  captureByTab.delete(tabId);
  requestsByTab.delete(tabId);
  const timeoutId = timeoutByTab.get(tabId);
  if (timeoutId) clearTimeout(timeoutId);
  timeoutByTab.delete(tabId);
  finishJob(jobId, "error", null, "The processing tab was closed before a result was captured.").catch(console.error);
});

chrome.windows.onRemoved.addListener((windowId) => {
  readState()
    .then((state) => {
      if (state.workerWindowId !== windowId) return;
      return updateState((draft) => {
        if (draft.workerWindowId === windowId) draft.workerWindowId = null;
      });
    })
    .catch(console.error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RATE_LIMIT_RETRY_ALARM) schedulePump(0);
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (!tabId) return;
  const jobId = tabToJob.get(tabId);
  if (!jobId) return;
  tabToJob.delete(tabId);
  clearResolution(tabId);
  captureByTab.delete(tabId);
  requestsByTab.delete(tabId);
  const timeoutId = timeoutByTab.get(tabId);
  if (timeoutId) clearTimeout(timeoutId);
  timeoutByTab.delete(tabId);
  finishJob(jobId, "error", null, `Debugger detached (${reason}). Keep DevTools closed on processing tabs.`).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target === "offscreen") return false;
  (async () => {
    switch (message?.type) {
      case "getState":
        return { ok: true, state: await readState() };
      case "start":
        return { ok: true, ...(await startRun(message.urls, message.settings)) };
      case "startDatabase":
        return {
          ok: true,
          ...(await startDatabaseRun(message.limit, message.settings)),
        };
      case "stop":
        await stopRun();
        return { ok: true };
      case "clear":
        await clearRun();
        return { ok: true };
      case "retryFailed":
        return { ok: true, ...(await retryFailed()) };
      default:
        throw new Error("Unknown command.");
    }
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const state = await readState();
  await writeState(state);
});

async function recoverInterruptedRun() {
  const update = await updateState((state) => {
    if (!state.running) return { shouldPump: false };
    const active = state.jobs.filter((job) =>
      ["starting", "resolving", "running", "capturing"].includes(job.status),
    );
    if (!active.length) return { shouldPump: state.jobs.some((job) => job.status === "queued") };

    const interrupted = active[0];
    interrupted.status = "error";
    interrupted.error = "The extension restarted while this lead was running. Resume to retry this same lead.";
    interrupted.finishedAt = Date.now();
    interrupted.tabId = null;
    for (const job of active.slice(1)) {
      job.status = "queued";
      job.tabId = null;
      job.startedAt = null;
    }
    state.running = false;
    state.paused = true;
    state.pauseReason = interrupted.error;
    state.stopRequested = false;
    return { shouldPump: false };
  });
  if (update.result?.shouldPump) schedulePump(0);
}

recoverInterruptedRun().catch((error) => {
  console.error("Could not recover the saved queue safely", error);
});
