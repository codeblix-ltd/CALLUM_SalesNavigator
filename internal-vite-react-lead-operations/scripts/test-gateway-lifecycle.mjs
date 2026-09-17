import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import os from "node:os";
import { CodexAppServer, GatewayError } from "../gateway/app-server-client.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

function fixture(options = {}) {
  const calls = [];
  const children = [];
  let sequence = 0;
  const controller = { turnDelay: 0, holdInitialize: null, failTurnStart: false, malformed: false, failRelease: false, ignoreTurns: false };
  const app = new CodexAppServer({
    codexHome: os.tmpdir(), safeWorkspace: os.tmpdir(), model: "test-model",
    onAuthChanged: async () => {},
    ...options,
    spawnProcess: (executable, args, spawnOptions) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.killed = false;
      child.args = args;
      child.spawnOptions = spawnOptions;
      children.push(child);
      const reply = (message) => {
        if (!child.killed) child.stdout.write(`${JSON.stringify(message)}\n`);
      };
      child.stdin = new Writable({ write(chunk, _encoding, callback) {
        const request = JSON.parse(String(chunk));
        calls.push({ ...request, child: children.length });
        callback();
        void (async () => {
          if (request.id === undefined) return;
          let result = {};
          if (request.method === "initialize" && controller.holdInitialize) await controller.holdInitialize.promise;
          if (request.method === "account/read") result = { account: { type: "chatgpt" } };
          if (request.method === "thread/start") result = { thread: { id: `thread-${++sequence}` } };
          if (request.method === "turn/start") {
            if (controller.failTurnStart) return reply({ id: request.id, error: { message: "turn start failed" } });
            const turnId = `turn-${sequence}`;
            reply({ id: request.id, result: { turn: { id: turnId } } });
            if (controller.ignoreTurns) return;
            if (controller.turnDelay) await delay(controller.turnDelay);
            let output = "Hi Sam, thanks for connecting. Your work in energy is interesting. What are you focusing on next?";
            if (request.params.outputSchema?.properties.draft) output = JSON.stringify({ draft: "A clear ownership process makes the next step easier for everyone.", languageStatus: "english" });
            if (request.params.outputSchema?.properties.items) output = '{"items":[]}';
            if (request.params.outputSchema?.properties.matches) output = '{"matches":[]}';
            if (request.params.outputSchema?.properties.results) output = '{"results":[{"id":"sample","status":"non_english","languageCode":"fr","confidence":0.99}]}';
            if (controller.malformed) output = "{";
            return reply({ method: "turn/completed", params: { turn: { id: turnId, status: "completed", items: [{ type: "agentMessage", text: output }] } } });
          }
          if (request.method === "thread/unsubscribe" && controller.failRelease) return reply({ id: request.id, error: { message: "unsubscribe failed" } });
          reply({ id: request.id, result });
        })();
      } });
      child.kill = () => {
        queueMicrotask(() => {
          if (child.killed) return;
          child.killed = true;
          child.stdin.end();
          child.stdout.end();
          child.stderr.end();
          child.emit("exit", 0, "SIGTERM");
        });
        return true;
      };
      return child;
    },
  });
  return { app, calls, children, controller };
}

// Exercise real generation methods, not just a synthetic cleanup helper.
{
  const f = fixture();
  await f.app.start();
  assert(f.children[0].args.includes("features.apps=false"));
  assert(f.children[0].args.includes("features.plugins=false"));
  assert.equal(f.children[0].spawnOptions.env.OPENAI_API_KEY, undefined);
  await f.app.createDraft({ requestId: "comment", scoutId: "test", postText: "post" });
  await f.app.createLanguageCheck({ requestId: "language", scoutId: "test", context: "profile", samples: [{ id: "sample", text: "Expertise professionnelle accompagnement entrepreneurial croissance durable" }] });
  await f.app.createFirstDmDraft({ requestId: "dm", scoutId: "test", profile: { firstName: "Sam" } });
  await f.app.createFlippaDraft({ requestId: "flippa", listingId: "listing", title: "Title", description: "Description", previousComments: [] });
  await f.app.createCommunityMatches({ requestId: "community", days: 30, includeSameBoard: false, reports: [], actions: [] });
  await f.app.runAccountingTurn("extract", { properties: { items: {} } });
  assert.equal(f.calls.filter((c) => c.method === "thread/start").length, 6);
  assert.equal(f.calls.filter((c) => c.method === "thread/unsubscribe").length, 6);
  for (const c of f.calls.filter((c) => c.method === "thread/start")) {
    assert.equal(c.params.ephemeral, true);
    assert.equal(c.params.sandbox, "read-only");
    assert.equal(c.params.approvalPolicy, "never");
    assert.equal(c.params.model, "test-model");
  }
  f.controller.failTurnStart = true;
  await assert.rejects(f.app.createDraft({ requestId: "start-failure", scoutId: "test", postText: "post" }), /turn start failed/);
  f.controller.failTurnStart = false;
  f.controller.malformed = true;
  await assert.rejects(f.app.createDraft({ requestId: "parse-failure", scoutId: "test", postText: "post" }), SyntaxError);
  f.controller.malformed = false;
  f.controller.failRelease = true;
  assert((await f.app.createDraft({ requestId: "release-failure", scoutId: "test", postText: "post" })).draft);
  assert.equal(f.app.threadReleaseFailures, 1, "cleanup errors must not discard a successful result");
  assert.equal(f.calls.filter((c) => c.method === "thread/unsubscribe").length, 9);
  assert.equal(f.app.activeThreadCount, 0);
  await f.app.close();
}

// A waiting request times out and is removed, without consuming a slot later.
{
  const hold = deferred();
  const f = fixture({ onAuthChanged: () => hold.promise });
  await f.app.start();
  assert((await f.app.enqueueDraft({ requestId: "slow-backup", scoutId: "test", postText: "post" })).draft);
  hold.resolve();
  await f.app.authBackupPromise;
  f.app.lastAuthBackupAt = 0;
  f.app.onAuthChanged = async () => { throw new Error("test backup unavailable"); };
  const originalError = console.error;
  const warnings = [];
  try {
    console.error = (message) => warnings.push(String(message));
    assert((await f.app.enqueueDraft({ requestId: "failed-backup", scoutId: "test", postText: "post" })).draft);
    await delay(0);
  } finally { console.error = originalError; }
  assert(warnings.some((message) => message.includes("Auth backup failed")));
  await f.app.close();
}

// A start timeout may leave an unknown thread, so drain/recycle without claiming release.
{
  const f = fixture();
  await f.app.start();
  const request = f.app.request.bind(f.app);
  let startError = "thread start failed";
  f.app.request = async (method, ...args) => {
    if (method === "thread/start") throw new Error(startError);
    return request(method, ...args);
  };
  await assert.rejects(f.app.createDraft({ requestId: "failed-start", scoutId: "test", postText: "post" }), /thread start failed/);
  assert.equal(f.app.sessionsSinceRecycle, 1, "failed start attempts count toward lifecycle limits");
  startError = "Codex request thread/start timed out.";
  await assert.rejects(f.app.enqueueDraft({ requestId: "orphan-start", scoutId: "test", postText: "post" }), /thread\/start timed out/);
  if (f.app.recyclePromise) await f.app.recyclePromise;
  assert.equal(f.app.recycleCount, 1);
  assert.equal(f.children.length, 2);
  assert.equal(f.calls.filter((c) => c.method === "thread/unsubscribe").length, 0, "an unknown thread cannot be reported as released");
  await f.app.close();
}

// A waiting request times out and is removed, without consuming a slot later.
{
  const f = fixture({ maxScoutConcurrency: 1, slotWaitTimeoutMs: 20 });
  const first = deferred();
  const active = f.app.enqueueRequest("linkedin:active", () => first.promise);
  let invoked = false;
  await assert.rejects(f.app.enqueueRequest("linkedin:queued", async () => { invoked = true; }), (e) => e instanceof GatewayError && e.statusCode === 503);
  assert.equal(invoked, false);
  assert.equal(f.app.scoutWaiters.length, 0);
  assert.equal(f.app.scoutActive, 1);
  first.resolve("done");
  await active;
  assert.equal(f.app.scoutActive, 0);
  assert.equal(f.app.queuedDrafts, 0);
  assert.equal(f.app.scoutCompleted, 1);
  assert.equal(f.app.scoutFailed, 1);
  assert.equal(f.app.lastScoutErrorCode, 503);
  assert(f.app.lastScoutSuccessAt && f.app.lastScoutErrorAt);
  await f.app.close();
}

// Queue and generation share one deadline; cleanup still runs after it expires.
{
  const f = fixture({ maxScoutConcurrency: 1, scoutBudgetMs: 80, slotWaitTimeoutMs: 100 });
  await f.app.start();
  const hold = deferred();
  const occupying = f.app.enqueueRequest("occupying", () => hold.promise);
  f.controller.ignoreTurns = true;
  const start = Date.now();
  const queued = f.app.enqueueDraft({ requestId: "deadline", scoutId: "test", postText: "post" });
  const rejected = assert.rejects(queued, /Timed out|too long/);
  await delay(30);
  hold.resolve();
  await occupying;
  await rejected;
  assert(Date.now() - start < 140, "the queue must not grant a fresh generation budget");
  assert(f.calls.some((c) => c.method === "turn/interrupt"));
  assert(f.calls.some((c) => c.method === "thread/unsubscribe"));
  assert.equal(f.app.activeThreadCount, 0);
  assert.equal(f.app.queuedDrafts, 0);
  assert.equal(f.app.scoutActive, 0);
  await f.app.close();
}

// Backend reservation deadlines may shorten, but never extend, the scout budget.
{
  const f = fixture({ scoutBudgetMs: 80 });
  await f.app.start();
  const before = f.calls.length;
  await assert.rejects(f.app.enqueueDraft({ requestId: "expired-reservation", scoutId: "test", postText: "post", deadlineAt: Date.now() - 1 }), (e) => e.statusCode === 504);
  await assert.rejects(f.app.enqueueLanguageCheck({ requestId: "expired-language", scoutId: "test", context: "profile", samples: [], deadlineAt: Date.now() - 1 }), (e) => e.statusCode === 504);
  assert.equal(f.calls.length, before, "expired reservations must not start generation or account work");
  assert.equal(f.app.queuedDrafts, 0);
  assert.equal(f.app.scoutActive, 0);
  assert(await f.app.enqueueRequest("linkedin:future-budget", async () => f.app.timeoutWithinBudget(150_000), Date.now() + 600_000) <= 80);
  f.controller.ignoreTurns = true;
  const startedAt = Date.now();
  await assert.rejects(f.app.enqueueDraft({ requestId: "short-reservation", scoutId: "test", postText: "post", deadlineAt: Date.now() + 20 }), /Timed out|too long/);
  assert(Date.now() - startedAt < 70);
  await f.app.close();
}

// Cleanup shares one deadline, even after the generation budget is exhausted.
{
  const f = fixture();
  const realNow = Date.now;
  let now = realNow();
  let releaseTimeout;
  f.app.waitForTurn = async () => { throw new Error("Timed out while waiting for the Codex draft."); };
  f.app.request = async (method, _params, timeoutMs) => {
    if (method === "thread/start") return { thread: { id: "cleanup-budget" } };
    if (method === "turn/interrupt") now += 4_000;
    if (method === "thread/unsubscribe") releaseTimeout = timeoutMs;
    return {};
  };
  try {
    Date.now = () => now;
    await assert.rejects(f.app.withEphemeralThread("test", (threadId) => f.app.waitForTurnAndInterrupt(threadId, "turn")), /Timed out/);
    assert.equal(releaseTimeout, 1_000, "interrupt and unsubscribe share a five-second cleanup allowance");
    assert.equal(f.app.threadCleanupDeadlines.size, 0);
  } finally { Date.now = realNow; }
  await f.app.close();
}

// Accounting has its own slots and is not subject to the short scout budget.
{
  const f = fixture({ scoutBudgetMs: 10 });
  await f.app.start();
  f.controller.turnDelay = 30;
  await f.app.enqueueAccountingRequest("accounting", () => f.app.runAccountingTurn("extract", { properties: { items: {} } }));
  assert.equal(f.app.accountingActive, 0);
  assert.equal(f.app.scoutFailed, 0);
  assert.equal(await f.app.enqueueRequest("flippa:legacy-budget", async () => {
    await delay(20);
    return f.app.timeoutWithinBudget(150_000);
  }), 150_000, "other consumers retain their own generation timeout");
  await f.app.close();
}

// Recycle at the real 64-thread threshold, never while accounting is active.
{
  const f = fixture();
  const stopped = [];
  f.app.on("stopped", (e) => stopped.push(e));
  await f.app.start();
  const accountingHold = deferred();
  const accounting = f.app.enqueueAccountingRequest("accounting-hold", () => accountingHold.promise);
  for (let i = 0; i < 64; i += 1) {
    await f.app.enqueueDraft({ requestId: `recycle-${i}`, scoutId: "test", postText: "post" });
  }
  assert.equal(f.app.sessionsSinceRecycle, 64);
  assert.equal(f.children.length, 1, "do not interrupt another consumer's work");
  await assert.rejects(f.app.enqueueDraft({ requestId: "over-limit", scoutId: "test", postText: "post" }), (e) => e.statusCode === 503);
  assert.equal(f.app.queuedDrafts, 1, "new admissions are bounded while existing work drains");
  await assert.rejects(f.app.enqueueAccountingRequest("over-limit-accounting", async () => {}), (e) => e.statusCode === 503);
  f.app.loginAttempts.set("stale", { state: "pending", startedAt: Date.now() - 11 * 60_000 });
  f.controller.holdInitialize = deferred();
  accountingHold.resolve();
  await accounting;
  assert(f.app.recyclePromise);
  const before = f.calls.filter((c) => c.method === "thread/start").length;
  const arriving = f.app.enqueueDraft({ requestId: "during-recycle", scoutId: "test", postText: "post" });
  await delay(5);
  assert.equal(f.calls.filter((c) => c.method === "thread/start").length, before, "new work waits for the replacement child to initialize");
  f.controller.holdInitialize.resolve();
  await arriving;
  assert.equal(f.children.length, 2);
  assert.equal(f.app.recycleCount, 1);
  assert.equal(f.app.sessionsSinceRecycle, 1);
  assert.equal(f.app.activeThreadCount, 0);
  assert.equal(stopped.length, 0, "an intentional recycle must not trigger gateway shutdown");
  await f.app.close();
  assert.equal(stopped.length, 0, "intentional shutdown must not report a crash");
}

console.log("Gateway lifecycle tests passed: cleanup, bounded queue and total budget, isolated accounting, and safe 64-session recycling.");
