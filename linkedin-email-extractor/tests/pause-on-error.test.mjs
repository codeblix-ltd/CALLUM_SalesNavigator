import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import {
  describeHttpFailure,
  isLinkedInUrlError,
  isRateLimitFailure,
  isRateLimitMessage,
  isTransientFailure,
  rateLimitAction,
  RATE_LIMIT_RETRY_DELAY_MS,
  retryDelayMs,
  shouldPauseQueueOnError,
} from "../queue-policy.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

test("LinkedIn URL errors are detected and do not pause the queue", () => {
  const urlError = "Could not resolve LinkedIn URL: LinkedIn redirected to a non-profile page: https://www.linkedin.com/in/";
  assert.equal(isLinkedInUrlError(urlError), true);
  assert.equal(isLinkedInUrlError("LinkedIn redirected to a non-profile page: https://www.linkedin.com/feed/"), true);
  assert.equal(isLinkedInUrlError("Invalid LinkedIn URL"), true);
  assert.equal(isLinkedInUrlError("Synthetic tab launch failure"), false);
  assert.equal(isLinkedInUrlError("Mailmeteor API request failed"), false);

  assert.equal(shouldPauseQueueOnError("error", urlError), false);
  assert.equal(shouldPauseQueueOnError("error", "Synthetic tab launch failure"), true);
  assert.equal(shouldPauseQueueOnError("found", null), false);
});

test("temporary failures are classified for bounded retries", () => {
  assert.match(describeHttpFailure(429), /rate limit/i);
  assert.match(describeHttpFailure(503), /HTTP 503/);
  assert.equal(describeHttpFailure(200), null);
  assert.equal(isRateLimitMessage("Too many requests; try again later"), true);
  assert.equal(isRateLimitFailure(429, ""), true);
  assert.equal(isRateLimitFailure(200, "Mailmeteor rate limit detected"), true);
  assert.equal(isTransientFailure(429, "", "error"), true);
  assert.equal(isTransientFailure(503, "", "error"), true);
  assert.equal(isTransientFailure(null, "Timed out waiting for Mailmeteor", "timeout"), true);
  assert.equal(isTransientFailure(400, "Bad request", "error"), false);
  assert.deepEqual([1, 2, 3].map(retryDelayMs), [15_000, 30_000, 60_000]);
});

test("HTTP 429 waits exactly three minutes once, then pauses", () => {
  assert.equal(RATE_LIMIT_RETRY_DELAY_MS, 180_000);
  assert.equal(rateLimitAction(0), "retry");
  assert.equal(rateLimitAction(1), "pause");
  assert.equal(rateLimitAction(2), "pause");
});

test("a job error pauses before the next lead is launched", async () => {
  const stored = {
    mailmeteorAdminAuth: {
      token: "test-token",
      refreshToken: "test-refresh-token",
      username: "admin",
    },
  };
  const messageListeners = [];
  let tabCreateCount = 0;
  let processingWindowOptions = null;
  let processingTabOptions = null;

  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") return { [key]: stored[key] };
          return { ...stored };
        },
        async set(values) {
          Object.assign(stored, structuredClone(values));
        },
        async remove(key) {
          delete stored[key];
        },
      },
    },
    alarms: {
      onAlarm: { addListener() {} },
      async create() {},
      async clear() { return true; },
    },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onMessage: { addListener(listener) { messageListeners.push(listener); } },
      onInstalled: { addListener() {} },
    },
    tabs: {
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
      async create(options) {
        tabCreateCount += 1;
        processingTabOptions = options;
        throw new Error("Synthetic tab launch failure");
      },
      async update() {},
      async remove() {},
      async get() { return null; },
    },
    windows: {
      onRemoved: { addListener() {} },
      async get() { throw new Error("Window not found"); },
      async create(options) {
        processingWindowOptions = options;
        return { id: 77 };
      },
      async remove() {},
    },
    debugger: {
      onEvent: { addListener() {} },
      onDetach: { addListener() {} },
      async attach() {},
      async detach() {},
      async sendCommand() {},
    },
  };

  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.path, "workEmails:recordFailure");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          status: "success",
          value: { saved: false, leadId: null },
        };
      },
    };
  };

  await import(`../background.js?pause-test=${Date.now()}`);
  assert.equal(messageListeners.length, 1);
  const response = await sendMessage(messageListeners[0], {
    type: "start",
    urls: [
      "https://www.linkedin.com/in/first-lead/",
      "https://www.linkedin.com/in/second-lead/",
    ],
    settings: { concurrency: 4, staggerMs: 500, timeoutMs: 20_000, keepFailedTabs: false },
  });
  assert.equal(response.ok, true);
  assert.equal(response.accepted, 2);

  await waitFor(() => stored.queueState?.paused === true);
  assert.equal(tabCreateCount, 1);
  assert.deepEqual(processingWindowOptions, {
    url: "chrome-extension://test/worker.html",
    focused: false,
    type: "normal",
  });
  assert.equal(processingTabOptions.windowId, 77);
  assert.equal(processingTabOptions.active, false);
  assert.equal(stored.queueState.running, false);
  assert.match(stored.queueState.pauseReason, /Synthetic tab launch failure/);
  assert.equal(stored.queueState.jobs[0].status, "error");
  assert.equal(stored.queueState.jobs[1].status, "queued");
});

test("a LinkedIn URL resolution error skips the lead and continues queue execution", async () => {
  const stored = {
    mailmeteorAdminAuth: {
      token: "test-token",
      refreshToken: "test-refresh-token",
      username: "admin",
    },
  };
  const messageListeners = [];
  const tabUpdateListeners = [];
  let tabIdCounter = 100;
  const createdTabs = [];

  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") return { [key]: stored[key] };
          return { ...stored };
        },
        async set(values) {
          Object.assign(stored, structuredClone(values));
        },
        async remove(key) {
          delete stored[key];
        },
      },
    },
    alarms: {
      onAlarm: { addListener() {} },
      async create() {},
      async clear() { return true; },
    },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onMessage: { addListener(listener) { messageListeners.push(listener); } },
      onInstalled: { addListener() {} },
    },
    tabs: {
      onUpdated: { addListener(listener) { tabUpdateListeners.push(listener); } },
      onRemoved: { addListener() {} },
      async create(options) {
        const tabId = ++tabIdCounter;
        const tab = { id: tabId, url: options.url || "about:blank", status: "complete" };
        createdTabs.push(tab);
        return tab;
      },
      async update(tabId, updateProps) {
        const tab = createdTabs.find((t) => t.id === tabId);
        if (tab) Object.assign(tab, updateProps);
        return tab;
      },
      async remove() {},
      async get(tabId) {
        const tab = createdTabs.find((t) => t.id === tabId);
        // For the first lead, simulate redirecting to the generic /in/ non-profile URL
        if (tabId === 101) {
          return { id: tabId, url: "https://www.linkedin.com/in/", status: "complete" };
        }
        return tab || { id: tabId, url: "about:blank", status: "complete" };
      },
    },
    windows: {
      onRemoved: { addListener() {} },
      async get() { throw new Error("Window not found"); },
      async create() { return { id: 88 }; },
      async remove() {},
    },
    debugger: {
      onEvent: { addListener() {} },
      onDetach: { addListener() {} },
      async attach() {},
      async detach() {},
      async sendCommand() {},
    },
  };

  globalThis.fetch = async (_url, request) => {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          status: "success",
          value: { saved: false, leadId: null },
        };
      },
    };
  };

  await import(`../background.js?skip-test=${Date.now()}`);
  const startListener = messageListeners[messageListeners.length - 1];
  const response = await sendMessage(startListener, {
    type: "start",
    urls: [
      "https://www.linkedin.com/in/bad-lead/",
      "https://www.linkedin.com/in/good-lead/",
    ],
    settings: { concurrency: 1, staggerMs: 50, timeoutMs: 5_000, keepFailedTabs: false },
  });
  assert.equal(response.ok, true);

  // Wait for tab 101 to be created and resolution tracking to begin
  await waitFor(() => createdTabs.some((t) => t.id === 101));

  // Trigger tab status update for the first lead
  for (const listener of tabUpdateListeners) {
    listener(101, { status: "complete", url: "https://www.linkedin.com/in/" }, { id: 101, status: "complete", url: "https://www.linkedin.com/in/" });
  }

  // Wait for the first job to fail with the URL error, but queue must NOT pause and must proceed to lead 2
  await waitFor(() => stored.queueState?.jobs?.[0]?.status === "error");
  assert.match(stored.queueState.jobs[0].error, /LinkedIn redirected to a non-profile page/);
  assert.equal(stored.queueState.paused, false);

  // Wait for the second job to be launched (tab 102 created)
  await waitFor(() => createdTabs.length >= 2);
  assert.equal(createdTabs.some((t) => t.id === 102), true);

  await sendMessage(startListener, { type: "stop" });
});


function sendMessage(listener, message) {
  return new Promise((resolve) => {
    const keepChannelOpen = listener(message, {}, resolve);
    assert.equal(keepChannelOpen, true);
  });
}

async function waitFor(predicate) {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the queue state.");
}
