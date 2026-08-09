const STORAGE_KEY = "queueState";
const TOOL_PAGE = "https://mailmeteor.com/tools/linkedin-email-finder";
const API_HOST = "tools.mailmeteor.com";
const API_PATH = "/api/email-finder/linkedin";
const RESOLVE_SETTLE_MS = 2200;

const DEFAULT_SETTINGS = Object.freeze({
  concurrency: 5,
  staggerMs: 1800,
  timeoutMs: 60000,
  keepFailedTabs: true
});

const tabToJob = new Map();
const captureByTab = new Map();
const requestsByTab = new Map();
const timeoutByTab = new Map();
const resolutionByTab = new Map();
let schedulerTimer = null;
let stateLock = Promise.resolve();

function emptyState() {
  return {
    version: 2,
    runId: null,
    running: false,
    stopRequested: false,
    createdAt: null,
    updatedAt: Date.now(),
    nextLaunchAllowedAt: 0,
    settings: { ...DEFAULT_SETTINGS },
    jobs: []
  };
}

async function readState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || emptyState();
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
  const concurrency = Math.min(5, Math.max(1, Number(input.concurrency) || DEFAULT_SETTINGS.concurrency));
  const staggerMs = Math.min(10000, Math.max(500, Number(input.staggerMs) || DEFAULT_SETTINGS.staggerMs));
  const timeoutMs = Math.min(180000, Math.max(20000, Number(input.timeoutMs) || DEFAULT_SETTINGS.timeoutMs));
  return {
    concurrency,
    staggerMs,
    timeoutMs,
    keepFailedTabs: input.keepFailedTabs !== false
  };
}

function makeJob(linkedinUrl, index) {
  return {
    id: `${Date.now()}-${index}-${crypto.randomUUID()}`,
    index,
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
    error: null
  };
}

async function startRun(rawUrls, rawSettings) {
  const seen = new Set();
  const invalid = [];
  const urls = [];

  for (const raw of rawUrls || []) {
    const value = String(raw || "").trim();
    if (!value) continue;
    if (!isLinkedInProfileUrl(value)) {
      invalid.push(value);
      continue;
    }
    const normalized = normalizeLinkedInUrl(value);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }

  if (!urls.length) {
    throw new Error("Add at least one valid LinkedIn profile URL (linkedin.com/in/...).");
  }

  const current = await readState();
  if (current.running) {
    throw new Error("A queue is already running. Stop it before starting another.");
  }

  const settings = validateSettings(rawSettings);
  const state = {
    version: 2,
    runId: crypto.randomUUID(),
    running: true,
    stopRequested: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nextLaunchAllowedAt: 0,
    settings,
    jobs: urls.map(makeJob)
  };
  await writeState(state);
  schedulePump(0);
  return { accepted: urls.length, invalid };
}

function activeJobCount(state) {
  return state.jobs.filter((job) => ["starting", "resolving", "running", "capturing"].includes(job.status)).length;
}

function queuedJob(state) {
  return state.jobs.find((job) => job.status === "queued");
}

function schedulePump(delayMs) {
  if (schedulerTimer) clearTimeout(schedulerTimer);
  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;
    pumpQueue().catch((error) => console.error("Queue scheduler failed", error));
  }, Math.max(0, delayMs));
}

async function pumpQueue() {
  const state = await readState();
  if (!state.running || state.stopRequested) return;

  const active = activeJobCount(state);
  const next = queuedJob(state);

  if (!next) {
    if (active === 0) {
      await updateState((draft) => {
        draft.running = false;
      });
    }
    return;
  }

  if (active >= state.settings.concurrency) return;

  const waitMs = Math.max(0, (state.nextLaunchAllowedAt || 0) - Date.now());
  if (waitMs > 0) {
    schedulePump(waitMs);
    return;
  }

  const claimed = await updateState((draft) => {
    if (!draft.running || draft.stopRequested) return null;
    if (activeJobCount(draft) >= draft.settings.concurrency) return null;
    const job = queuedJob(draft);
    if (!job) return null;

    job.status = "starting";
    job.startedAt = Date.now();
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
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
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
    await finishJob(jobId, "error", data, String(message), text);
  }
}

function decodeResponseBody(body, base64Encoded) {
  if (!base64Encoded) return body;
  const binary = atob(body);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function finishJob(jobId, status, result = null, error = null, rawResponse = null) {
  const update = await updateState((state) => {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job || ["found", "not_found", "error", "timeout", "stopped"].includes(job.status)) {
      return null;
    }

    job.status = status;
    job.result = result;
    job.rawResponse = rawResponse;
    job.error = error;
    job.finishedAt = Date.now();

    const tabId = job.tabId;
    const closeTab = status === "found" || status === "not_found" || !state.settings.keepFailedTabs;
    return { tabId, closeTab };
  });

  if (!update.result) return;
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
  if (latest.running && !latest.stopRequested) {
    schedulePump(0);
  } else if (activeJobCount(latest) === 0) {
    await updateState((state) => {
      state.running = false;
    });
  }
}

async function stopRun() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }

  const update = await updateState((state) => {
    state.stopRequested = true;
    state.running = false;
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
    return active;
  });

  for (const tabId of update.result || []) {
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
}

async function clearRun() {
  const state = await readState();
  if (state.running) throw new Error("Stop the current queue before clearing it.");
  await writeState(emptyState());
}

async function retryFailed() {
  const current = await readState();
  if (current.running) throw new Error("Stop the current queue before retrying.");

  const urls = current.jobs
    .filter((job) => ["not_found", "error", "timeout", "stopped"].includes(job.status))
    .map((job) => job.inputLinkedinUrl || job.linkedinUrl);

  if (!urls.length) throw new Error("There are no failed or unfinished rows to retry.");
  return startRun(urls, current.settings);
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
  (async () => {
    switch (message?.type) {
      case "getState":
        return { ok: true, state: await readState() };
      case "start":
        return { ok: true, ...(await startRun(message.urls, message.settings)) };
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
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) await writeState(emptyState());
});
