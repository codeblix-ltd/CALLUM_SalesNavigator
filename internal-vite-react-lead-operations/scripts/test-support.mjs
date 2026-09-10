import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute real backend handlers with explicit auth/storage/database doubles.
function backend(file) {
  const module = { exports: {} };
  const validator = new Proxy(() => ({}), { get: () => validator });
  const refs = new Proxy({}, { get: (_, group) => new Proxy({}, { get: (_, name) => `${String(group)}:${String(name)}` }) });
  const server = new Proxy({}, { get: () => definition => definition });
  const require = id => id === "convex/values" ? { v: validator } : id === "./_generated/server" ? server : id === "./_generated/api" ? { internal: refs } : id === "@convex-dev/auth/server" ? { getAuthUserId: async ctx => ctx.userId } : {};
  const source = ts.transpileModule(readFileSync(new URL(`../convex/${file}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require, Buffer, Blob, Uint8Array, Date });
  return module.exports;
}
const action = backend("bugReportActions").submit.handler;
const routes = backend("bugReports");
const valid = { clientId: "d7b8097f-43b9-47d8-9873-5d22beab45aa", description: "Profile remains stuck", occurredAt: Date.now(), context: { version: "0.10.31", browser: "Chrome", timezone: "Asia/Dubai", pageUrl: "https://www.linkedin.com/in/test", runStatus: "paused", runStep: "Checking connection", lead: "Test" }, screenshots: [Buffer.from([255,216,255,224,1]).toString("base64")] };
let stores = 0, deletes = 0, saves = 0;
const ctx = {
  runQuery: async ref => ref === "scoutIdentity:requireScout" ? { userId: "scout", username: "Test scout", operatorId: "test" } : null,
  runMutation: async (_, args) => { saves++; assert.equal(args.reporterId, "scout"); assert.equal(args.status, "open"); return { id: "report", inserted: true }; },
  storage: { store: async () => { stores++; return "image"; }, delete: async () => { deletes++; } },
};
assert.equal(await action(ctx, valid), "report");
assert.equal(stores, 1); assert.equal(saves, 1); assert.equal(deletes, 0);
await assert.rejects(action({ ...ctx, runQuery: async () => { throw new Error("Sign in is required."); } }, valid), /Sign in/);
for (const invalid of [{ description: "" }, { screenshots: Array(4).fill(valid.screenshots[0]) }, { screenshots: ["PHNjcmlwdD4="] }, { screenshots: ["a".repeat(1400001)] }, { occurredAt: Date.now() + 3600000 }, { context: { ...valid.context, browser: "x".repeat(1001) } }]) await assert.rejects(action(ctx, { ...valid, ...invalid }));
const priorStores = stores;
assert.equal(await action({ ...ctx, runQuery: async ref => ref === "scoutIdentity:requireScout" ? { userId: "scout" } : "existing" }, valid), "existing");
assert.equal(stores, priorStores, "network retries must not upload again once saved");
await action({ ...ctx, runMutation: async () => ({ id: "existing", inserted: false }) }, valid);
assert.equal(deletes, 1, "concurrent duplicate upload is cleaned up");
await assert.rejects(action({ ...ctx, runMutation: async () => { throw new Error("quota"); } }, valid), /quota/);
assert.equal(deletes, 2, "failed save cleans up uploaded images");
for (const route of ["list", "images", "update"]) {
  for (const user of [null, { active: true, role: "scout" }, { active: false, role: "admin" }]) {
    await assert.rejects(routes[route].handler({ userId: user ? "user" : null, db: { get: async () => user } }, { id: "report" }), /Administrator/);
  }
}

// Run the actual extension page script with DOM/browser doubles, including
// capture cancellation and cleanup. These do not replace a real Chrome picker test.
const elements = new Map();
const element = () => ({ value: "", hidden: false, disabled: false, textContent: "", files: [], append() {}, replaceChildren() {}, querySelectorAll() { return []; } });
const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
let stopped = 0, mode = "cancel", posted;
const chrome = { runtime: { getManifest: () => ({ version: "0.10.31" }) }, tabs: { get: async () => ({ url: "https://www.linkedin.com/in/test?secret=excluded#hash" }) }, storage: { local: { get: async () => ({ autoLeadRunState: { status: "paused", message: "Checking connection", currentLead: { fullName: "Test lead" }, secret: "DO NOT INCLUDE" } }) } } };
const doc = { getElementById: get, addEventListener() {}, createElement: tag => tag === "video" ? { play: async () => {}, requestVideoFrameCallback: callback => callback(), videoWidth: 0, videoHeight: 0 } : element() };
const sandbox = { document: doc, window: { addEventListener() {} }, chrome, navigator: { userAgent: "Chrome", mediaDevices: { getDisplayMedia: async () => { if (mode === "cancel") throw Object.assign(new Error("cancelled"), { name: "NotAllowedError" }); return { getTracks: () => [{ stop: () => { stopped++; } }] }; } } }, ScoutApi: { getAuth: async () => ({ token: "secret" }), authenticatedAction: async (_, args) => { posted = args; return "report"; } }, crypto: { randomUUID: () => valid.clientId }, location: { search: "?tab=4" }, URLSearchParams, URL, Date, Intl, setTimeout: callback => { if (mode === "timeout") callback(); }, clearTimeout() {}, console };
vm.runInNewContext(readFileSync(new URL("../chrome-extension/report.js", import.meta.url), "utf8"), sandbox);
await new Promise(resolve => setImmediate(resolve));
assert.match(get("context").textContent, /Test lead/);
assert.doesNotMatch(get("context").textContent, /secret|DO NOT INCLUDE|#hash/);
await get("capture").onclick(); assert.match(get("status").textContent, /cancelled/); assert.equal(get("capture").disabled, false);
mode = "badframe"; await get("capture").onclick(); assert.equal(stopped, 1); assert.match(get("status").textContent, /not ready/);
get("description").value = "Test report";
await get("report-form").onsubmit({ preventDefault() {} });
assert.equal(posted.description, "Test report"); assert.equal(posted.context.version, "0.10.31"); assert.equal(get("report-form").hidden, true);
assert.match(get("status").textContent, /Report received/);
console.log("Support tests passed: authenticated submission, validation, idempotency, cleanup, admin authorization, context privacy, capture cancellation, frame failure, and send confirmation.");
