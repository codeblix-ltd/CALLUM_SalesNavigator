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
for (const route of ["list", "update"]) {
  for (const user of [null, { active: true, role: "scout" }, { active: false, role: "admin" }]) {
    await assert.rejects(routes[route].handler({ userId: user ? "user" : null, db: { get: async () => user } }, { id: "report" }), /Administrator/);
  }
}

// Run the actual extension page script with DOM/browser doubles, including
const thread = { _id: "report", reporterId: "owner", status: "resolved", messages: [], adminNote: "PRIVATE", screenshots: ["image"] };
const threadCtx = user => ({ userId: user?._id ?? null, db: { get: async id => id === "report" ? thread : user, patch: async (_id, fields) => Object.assign(thread, fields), query: () => ({ withIndex: (_name, fn) => { fn({ eq: (_field, id) => { assert.equal(id, "owner"); } }); return { order: () => ({ paginate: async () => ({ page: [thread], isDone: true, continueCursor: "" }) }) }; } }) }, storage: { getUrl: async () => "https://private.example/image" } });
const owner = { _id: "owner", role: "scout", active: true };
const supportUser = { _id: "support", role: "admin", active: true };
const replyInput = { id: "report", clientId: "f4bc7002-fb3e-422a-925f-1f110fdc499b", text: "It still happens." };
for (const user of [null, { _id: "other", role: "scout", active: true }, { ...owner, active: false }]) {
  await assert.rejects(routes.reply.handler(threadCtx(user), replyInput), /Sign in|not available/);
  await assert.rejects(routes.images.handler(threadCtx(user), { id: "report" }), /Sign in|not available/);
}
await routes.reply.handler(threadCtx(owner), replyInput);
assert.equal(thread.status, "open", "scout follow-up reopens resolved report");
assert.equal(thread.messages[0].author, "scout");
await routes.reply.handler(threadCtx(owner), replyInput);
assert.equal(thread.messages.length, 1, "retry does not duplicate a message");
await routes.reply.handler(threadCtx(supportUser), { ...replyInput, text: "Please try after updating." });
assert.equal(thread.messages[1].author, "support", "author comes from authenticated role");
assert.equal((await routes.images.handler(threadCtx(owner), { id: "report" })).length, 1);
const visible = await routes.mine.handler(threadCtx(owner), { paginationOpts: { numItems: 10, cursor: null } });
assert.equal(visible.page[0].adminNote, undefined, "internal notes must never reach scouts");
assert.equal(visible.page[0].reporterId, undefined);
assert.equal(visible.page[0].messages.length, 2);
await assert.rejects(routes.reply.handler(threadCtx(owner), { ...replyInput, text: " " }), /Write a reply/);
console.log("Support conversation checks passed: ownership, private notes, replies, idempotency and reopening.");

// Run the actual extension page script with DOM/browser doubles, including
// capture cancellation and cleanup. These do not replace a real Chrome picker test.
const elements = new Map();
const element = () => ({ value: "", hidden: false, disabled: false, textContent: "", files: [], append() {}, replaceChildren() {}, querySelectorAll() { return []; } });
const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
let stopped = 0, mode = "cancel", posted, releaseCapture;
const chrome = { runtime: { getManifest: () => ({ version: "0.10.31" }) }, tabs: { get: async () => ({ url: "https://www.linkedin.com/in/test?secret=excluded#hash" }) }, storage: { local: { get: async () => ({ autoLeadRunState: { status: "paused", message: "Checking connection", currentLead: { fullName: "Test lead" }, secret: "DO NOT INCLUDE" } }) } } };
const doc = { getElementById: get, addEventListener() {}, createElement: tag => tag === "video" ? { play: async () => {}, requestVideoFrameCallback: callback => callback(), videoWidth: mode === "success" ? 100 : 0, videoHeight: mode === "success" ? 100 : 0 } : tag === "canvas" ? { getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => `data:image/jpeg;base64,${valid.screenshots[0]}` } : element() };
const sandbox = { document: doc, window: { addEventListener() {} }, chrome, navigator: { userAgent: "Chrome", mediaDevices: { getDisplayMedia: async () => { if (mode === "cancel") throw Object.assign(new Error("cancelled"), { name: "NotAllowedError" }); return { getTracks: () => [{ stop: () => { stopped++; } }] }; } } }, ScoutApi: { getAuth: async () => ({ token: "secret" }), authenticatedAction: async (_, args) => { posted = args; return "report"; } }, crypto: { randomUUID: () => valid.clientId }, location: { search: "?tab=4" }, URLSearchParams, URL, Date, Intl, setTimeout: callback => { if (mode === "timeout") callback(); }, clearTimeout() {}, console };
const focusCalls = [];
chrome.tabs.getCurrent = async () => ({ id: 42, windowId: 7 });
chrome.tabs.update = async (id, options) => {
  assert.equal(stopped, 2, "sharing must stop before moving focus");
  assert.match(get("status").textContent, /Screenshot captured/, "preview must be ready before moving focus");
  focusCalls.push(["tab", id, options.active]);
};
chrome.windows = { update: async (id, options) => { focusCalls.push(["window", id, options.focused]); } };
const testTrack = { readyState: "live", stop: () => { stopped++; } };
const testStream = { getTracks: () => [testTrack], getVideoTracks: () => [testTrack] };
sandbox.ImageCapture = class { async grabFrame() { return { width: mode === "success" ? 100 : 0, height: mode === "success" ? 100 : 0, close() {} }; } };
sandbox.navigator.mediaDevices.getDisplayMedia = async () => {
  if (mode === "cancel") throw Object.assign(new Error("cancelled"), { name: "NotAllowedError" });
  return testStream;
};
vm.runInNewContext(readFileSync(new URL("../chrome-extension/report.js", import.meta.url), "utf8"), sandbox);
await new Promise(resolve => setImmediate(resolve));
assert.match(get("context").textContent, /Test lead/);
assert.doesNotMatch(get("context").textContent, /secret|DO NOT INCLUDE|#hash/);
await get("capture").onclick(); assert.match(get("status").textContent, /cancelled/); assert.equal(get("capture").disabled, false);
mode = "badframe"; await get("capture").onclick(); assert.equal(stopped, 1); assert.match(get("status").textContent, /not ready/);
assert.equal(focusCalls.length, 0, "cancelled or failed capture must not steal focus");
mode = "success";
const captureStream = testStream;
sandbox.navigator.mediaDevices.getDisplayMedia = () => new Promise(resolve => { releaseCapture = () => resolve(captureStream); });
const pendingCapture = get("capture").onclick();
assert.equal(get("send").disabled, true, "Send must be locked while capture is active");
await get("report-form").onsubmit({ preventDefault() {} }); assert.equal(posted, undefined);
releaseCapture(); await pendingCapture;
assert.equal(stopped, 2); assert.equal(get("send").disabled, false);
assert.match(get("status").textContent, /Screenshot captured/);
assert.deepEqual(focusCalls, [["tab", 42, true], ["window", 7, true]], "return to the report tab and its window, not the captured LinkedIn tab");
chrome.tabs.update = async () => { throw new Error("Tab closed"); };
await sandbox.returnToReportTab();
assert.match(get("status").textContent, /Screenshot captured/, "focus failure must preserve captured image and success status");
get("description").value = "Test report";
await get("report-form").onsubmit({ preventDefault() {} });
assert.equal(posted.description, "Test report"); assert.equal(posted.context.version, "0.10.31"); assert.equal(get("report-form").hidden, true);
assert.equal(posted.screenshots.length, 1, "finished capture must be attached to submission");
assert.match(get("status").textContent, /Report received/);
console.log("Support tests passed: authenticated submission, validation, idempotency, cleanup, admin authorization, context privacy, capture cancellation, frame failure, and send confirmation.");
