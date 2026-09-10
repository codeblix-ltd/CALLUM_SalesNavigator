import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let now = 12 * 60 * 60 * 1000;
class TestDate extends Date { static now() { return now; } }
const internal = new Proxy({}, { get: (_, module) => new Proxy({}, { get: (_, name) => `${module}:${name}` }) });
const loaded = new Map();
function loadTs(relative) {
  const filename = path.resolve(root, relative);
  if (loaded.has(filename)) return loaded.get(filename);
  const module = { exports: {} };
  const localRequire = name => {
    if (name.endsWith("_generated/server")) return { internalMutation: x => x, internalQuery: x => x, query: x => x, action: x => x, internalAction: x => x };
    if (name.endsWith("_generated/api")) return { internal };
    if (name === "@convex-dev/auth/server") return { getAuthUserId: async ctx => ctx.userId };
    if (name.startsWith(".")) return loadTs(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)));
    return require(name);
  };
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
  vm.runInNewContext(output, { exports: module.exports, module, require: localRequire, Error, Date: TestDate, process: { env: {} }, crypto: globalThis.crypto, TextEncoder, AbortController, setTimeout, clearTimeout, fetch }, { filename });
  loaded.set(filename, module.exports);
  return module.exports;
}
const jobs = loadTs("convex/scoutAiJobs.ts");
const rows = new Map();
const scheduled = [];
const ctx = {
  userId: "scout-1",
  db: {
    get: async id => id.startsWith("scout-") ? { _id: id, role: "scout", active: true, operatorId: id } : rows.get(id),
    query: () => ({ withIndex: (_name, fn) => {
      let owner;
      fn({ eq: (_key, value) => { owner = value; } });
      return { take: async size => [...rows.values()].filter(row => row.userId === owner).slice(0, size) };
    } }),
    insert: async (_table, fields) => { const id = `job-${rows.size + 1}`; rows.set(id, { ...fields, _id: id }); return id; },
    patch: async (id, fields) => { Object.assign(rows.get(id), fields); },
  },
  scheduler: { runAfter: async (...args) => { scheduled.push(args); } },
};
const input = { userId: "scout-1", operatorId: "scout-1", kind: "comment", fingerprint: "same-post", generation: "first", request: '{"postText":"example"}' };
const first = await jobs.reserve.handler(ctx, input);
const duplicate = await jobs.reserve.handler(ctx, { ...input, generation: "retry" });
assert.deepEqual(duplicate, first);
assert.equal(scheduled.length, 1, "duplicate requests must not schedule another worker");
await assert.rejects(jobs.reserve.handler(ctx, { ...input, fingerprint: "different", kind: "note" }), /already running/);
await assert.rejects(jobs.get.handler({ ...ctx, userId: "scout-2" }, first), /not available/);
await jobs.finish.handler(ctx, { ...first, result: '{"draft":"cached"}' });
assert.equal(rows.get(first.jobId).request, undefined, "discard profile/post input after completion");
const cached = await jobs.reserve.handler(ctx, { ...input, generation: "cached-retry" });
assert.deepEqual(cached, first);
assert.equal(scheduled.length, 1);
now += 3_600_001;
const replacement = await jobs.reserve.handler(ctx, { ...input, fingerprint: "next-post", generation: "second" });
assert.equal(replacement.jobId, first.jobId, "reuse bounded storage slot");
await jobs.finish.handler(ctx, { ...first, result: '"stale"' });
assert.equal(rows.get(first.jobId).status, "pending", "old workers cannot overwrite newer generations");
now += 651_000;
assert((await jobs.get.handler(ctx, replacement)).expiresAt < now, "clients receive an absolute deadline even when query results are cached");
const third = await jobs.reserve.handler(ctx, { ...input, fingerprint: "third-post", generation: "third" });
await jobs.finish.handler(ctx, { ...third, error: "gateway unavailable" });
await jobs.reserve.handler(ctx, { ...input, fingerprint: "third-post", generation: "rapid-retry" });
assert.equal(scheduled.length, 3, "failed jobs have a retry cooldown");
rows.get(first.jobId).starts = 120;
now += 31_000;
await assert.rejects(jobs.reserve.handler(ctx, { ...input, fingerprint: "fourth-post" }), /hourly limit/);
rows.get(first.jobId).starts = 0;
for (const kind of ["note", "language"]) {
  const receipt = await jobs.reserve.handler(ctx, { ...input, kind, generation: kind });
  await jobs.finish.handler(ctx, { ...receipt, result: "{}" });
}
assert.equal(rows.size, 3, "maximum three reusable slots per scout");

const calls = [];
let polls = 0;
const clientContext = {
  LEADS_EXTENSION_CONFIG: { CONVEX_URL: "https://example.convex.cloud" },
  chrome: { storage: { local: { get: async () => ({ callumScoutAuth: { username: "scout", token: "token", refreshToken: "refresh" } }) } } },
  AbortController,
  setTimeout: (callback, ms) => { if (ms < 45_000) queueMicrotask(callback); return 0; },
  clearTimeout() {},
  fetch: async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, ...body });
    await Promise.resolve();
    let value;
    if (body.path === "scoutAi:draftComment") value = { jobId: "job-1", generation: "first" };
    else if (body.path === "scoutAiJobs:get") value = ++polls === 1 ? { status: "pending" } : { status: "complete", result: '{"draft":"Ready"}' };
    else value = { counts: { fresh: 5 } };
    return { ok: true, status: 200, json: async () => ({ status: "success", value }) };
  },
};
vm.runInNewContext(fs.readFileSync(path.join(root, "chrome-extension/convex-client.js"), "utf8"), clientContext);
const api = clientContext.ScoutApi;
const results = await Promise.all([api.authenticatedAction("scouts:draftComment", { postText: "same post" }), api.authenticatedAction("scouts:draftComment", { postText: "same post" })]);
assert.equal(results[0].draft, "Ready");
assert.equal(results[1].draft, "Ready");
assert.equal(calls.filter(call => call.path === "scoutAi:draftComment").length, 1);
assert(calls.filter(call => call.path === "scoutAiJobs:get").every(call => call.url.endsWith("/api/query")), "polls must use cheap queries, not actions");
await Promise.all([api.authenticatedAction("scouts:getDashboard"), api.authenticatedAction("scouts:getDashboard")]);
assert.equal(calls.filter(call => call.path === "scouts:getDashboard").length, 1, "coalesce simultaneous dashboard reads");
await api.authenticatedAction("scouts:getDashboard");
assert.equal(calls.filter(call => call.path === "scouts:getDashboard").length, 2, "do not return stale counts after an earlier read completes");

// Exercise the real worker orchestration without contacting AI or altering live leads.
const ai = loadTs("convex/scoutAi.ts");
const gateway = loadTs("convex/lib/codexGateway.ts");
let networkCalls = 0;
gateway.requestCodexGateway = async () => { networkCalls += 1; return { draft: "A useful comment", languageStatus: "english", threadId: "thread", model: "test" }; };
const finished = [];
const workerCtx = {
  runQuery: async () => ({ userId: "scout-1", operatorId: "scout-1", kind: "comment", request: '{"postText":"A post with enough meaningful context"}' }),
  runAction: async () => { throw new Error("Comment drafting must not open a SQL action"); },
  runMutation: async (_ref, args) => { finished.push(args); },
};
await ai.run.handler(workerCtx, first);
assert.equal(networkCalls, 1);
assert.equal(JSON.parse(finished[0].result).draft, "A useful comment");
gateway.requestCodexGateway = async () => { throw new Error("gateway unavailable"); };
await ai.run.handler(workerCtx, first);
assert.match(finished[1].error, /gateway unavailable/);
console.log("Compute usage checks passed: deduplication, cache, per-scout concurrency/quota, expiry, stale workers, ownership, bounded storage, query polling, dashboard coalescing, worker success/failure.");
