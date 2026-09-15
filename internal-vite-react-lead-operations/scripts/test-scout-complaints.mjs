import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../chrome-extension/content.js", import.meta.url), "utf8");
const fn = source.slice(source.indexOf("function findVisibleConnectionState"), source.indexOf("function getCurrentProfileName"));
function detect({ degree = "3rd", label = "Message", unrelated = "1st Connected", target = "Chieh Wang" } = {}) {
  const action = { getAttribute: () => label, textContent: label, closest: () => null };
  const badge = { textContent: degree };
  const scope = { innerText: `${target} ${degree} ${unrelated}`, querySelectorAll: selector => selector.includes("span") ? [badge] : [action] };
  const heading = { textContent: target, parentElement: scope };
  const main = { querySelectorAll: selector => selector.includes("h1") ? [heading] : [action] }; scope.parentElement = main;
  const sandbox = { document: { querySelector: () => main }, isElementVisible: () => true, personNamesMatch: (a, b) => a === b };
  vm.runInNewContext(fn, sandbox);
  return sandbox.findVisibleConnectionState("Chieh Wang");
}
assert.equal(detect(), "not_connected", "3rd degree must not inherit a recommendation's 1st-degree status");
assert.equal(detect({ degree: "2nd", label: "Connected" }), "not_connected");
assert.equal(detect({ degree: "1st" }), "connected");
assert.equal(detect({ degree: "", unrelated: "Connected with teams since 1st January" }), "unavailable", "biography text is not connection evidence");
assert.equal(detect({ label: "Pending" }), "pending");
assert.equal(detect({ target: "Someone else" }), "unavailable", "require the intended profile heading");

const client = readFileSync(new URL("../chrome-extension/convex-client.js", import.meta.url), "utf8");
let now = 0, submissions = 0;
class Clock extends Date { static now() { return now; } }
const sandbox = { Date: Clock, AbortController, chrome: { storage: { local: { get: async () => ({ callumScoutAuth: { username: "scout", token: "test", refreshToken: "test" } }) } } },
  LEADS_EXTENSION_CONFIG: { CONVEX_URL: "https://example.convex.cloud" },
  setTimeout: (cb, ms) => { if (ms < 45000) { now += ms; queueMicrotask(cb); } return 1; }, clearTimeout() {},
  fetch: async (_url, opts) => { const { path } = JSON.parse(opts.body); const isStart = path === "scoutAi:draftComment"; if (isStart) submissions++; return { ok: true, status: 200, json: async () => ({ status: "success", value: isStart ? { jobId: "job", generation: "one" } : { status: "pending", expiresAt: 650000 } }) }; },
};
vm.runInNewContext(client, sandbox);
await assert.rejects(sandbox.ScoutApi.authenticatedAction("scouts:draftComment", { postText: "test" }), /writing service.*Resume/);
assert(now >= 120000 && now < 131000, "pause the browser wait after two minutes instead of eleven");
assert.equal(submissions, 1, "polling does not start duplicate work");
console.log("Scout complaint checks passed: profile relationship isolation, 3rd/2nd/1st degree, pending, unknown identity, bounded AI wait and no duplicate submission.");
