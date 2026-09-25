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
assert.equal(detect({ degree: "· 3rd" }), "not_connected", "LinkedIn's paragraph badge with a bullet must be recognized");
assert.equal(detect({ degree: "· 1st" }), "connected", "a live-style first-degree paragraph must not be misread as unknown");
assert.equal(detect({ degree: "2nd", label: "Connected" }), "not_connected");
assert.equal(detect({ degree: "1st" }), "connected");
assert.equal(detect({ degree: "", unrelated: "Connected with teams since 1st January" }), "unavailable", "biography text is not connection evidence");
assert.equal(detect({ label: "Pending" }), "pending");
assert.equal(detect({ target: "Someone else" }), "unavailable", "require the intended profile heading");
const affiliationAction = { getAttribute: () => "GIC", textContent: "GIC", closest: () => null };
const pendingAction = { getAttribute: () => "Pending", textContent: "Pending", closest: () => null };
const nestedScope = { querySelectorAll: selector => selector.includes("span") ? [] : [affiliationAction] };
const introSection = { querySelectorAll: selector => selector.includes("span") ? [{ textContent: "· 2nd" }] : [affiliationAction, pendingAction] };
const nestedHeading = { textContent: "Karen Er", parentElement: nestedScope, closest: () => introSection };
const nestedMain = { querySelectorAll: () => [nestedHeading], contains: () => true };
nestedScope.parentElement = introSection;
introSection.parentElement = nestedMain;
const nestedEnv = { document: { querySelector: () => nestedMain }, isElementVisible: () => true, personNamesMatch: (a, b) => a === b };
vm.runInNewContext(fn, nestedEnv);
assert.equal(nestedEnv.findVisibleConnectionState("Karen Er"), "pending", "affiliation controls before the action row must not hide Pending");

const diagnosticsSource = source.slice(
  source.indexOf("function connectionActionDiagnostics"),
  source.indexOf("async function runConnectionNoteProfileExtraction"),
);
const profileHeading = { textContent: "Karen Er", closest: () => diagnosticMain };
const connectLink = { textContent: "Connect", getAttribute: name => name === "aria-label" ? "Invite Karen Er to connect" : name === "href" ? "/preload/custom-invite/?vanityName=karen-er-3121782" : null, closest: () => null };
const moreButton = { textContent: "", getAttribute: name => name === "aria-label" ? "More" : null, closest: () => null };
const diagnosticMain = { querySelectorAll: selector => selector.includes("h1") ? [profileHeading] : [connectLink, moreButton] };
const diagnosticEnv = { document: { querySelector: () => diagnosticMain, documentElement: { lang: "en" } }, isElementVisible: () => true, personNamesMatch: (a, b) => a === b };
vm.runInNewContext(diagnosticsSource, diagnosticEnv);
const actionSnapshot = diagnosticEnv.connectionActionDiagnostics("Karen Er");
assert.equal(actionSnapshot.targetHeadingVisible, true);
assert.equal(actionSnapshot.invitationLinkPresent, true);
assert.equal(actionSnapshot.moreActionPresent, true);
assert.equal(actionSnapshot.uiLanguage, "en");
assert.equal(actionSnapshot.visibleActionCount, 2);
diagnosticEnv.document.querySelector = () => null;
const missingActions = diagnosticEnv.connectionActionDiagnostics("Karen Er");
assert.equal(missingActions.mainPresent, false);
assert.equal(missingActions.visibleActionCount, 0);

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
