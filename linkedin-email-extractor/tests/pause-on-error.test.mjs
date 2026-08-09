import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import {
  describeHttpFailure,
  isRateLimitMessage,
  isTransientFailure,
  retryDelayMs,
} from "../queue-policy.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

test("temporary failures are classified for bounded retries", () => {
  assert.match(describeHttpFailure(429), /rate limit/i);
  assert.match(describeHttpFailure(503), /HTTP 503/);
  assert.equal(describeHttpFailure(200), null);
  assert.equal(isRateLimitMessage("Too many requests; try again later"), true);
  assert.equal(isTransientFailure(429, "", "error"), true);
  assert.equal(isTransientFailure(503, "", "error"), true);
  assert.equal(isTransientFailure(null, "Timed out waiting for Mailmeteor", "timeout"), true);
  assert.equal(isTransientFailure(400, "Bad request", "error"), false);
  assert.deepEqual([1, 2, 3].map(retryDelayMs), [15_000, 30_000, 60_000]);
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
    runtime: {
      onMessage: { addListener(listener) { messageListeners.push(listener); } },
      onInstalled: { addListener() {} },
    },
    tabs: {
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
      async create() {
        tabCreateCount += 1;
        throw new Error("Synthetic tab launch failure");
      },
      async update() {},
      async remove() {},
      async get() { return null; },
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
  assert.equal(stored.queueState.running, false);
  assert.match(stored.queueState.pauseReason, /Synthetic tab launch failure/);
  assert.equal(stored.queueState.jobs[0].status, "error");
  assert.equal(stored.queueState.jobs[1].status, "queued");
});

function sendMessage(listener, message) {
  return new Promise((resolve) => {
    const keepChannelOpen = listener(message, {}, resolve);
    assert.equal(keepChannelOpen, true);
  });
}

async function waitFor(predicate) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the queue state.");
}
