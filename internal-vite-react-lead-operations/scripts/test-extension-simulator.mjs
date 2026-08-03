import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  assertSafeSimulatorLocation,
  createLeadFixture,
  runLeadSimulation,
  scaledSimulationDelay,
} from "../chrome-extension/mock-linkedin/simulator-engine.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const extensionRoot = path.join(projectRoot, "chrome-extension");
const manifest = JSON.parse(
  await readFile(path.join(extensionRoot, "manifest.json"), "utf8"),
);

assert.equal(manifest.version, "0.4.0");
assert.deepEqual(
  manifest.content_scripts[0].matches,
  ["https://*.linkedin.com/*"],
  "Real automation must run on LinkedIn without an invalid chrome-extension match pattern.",
);
assert.doesNotThrow(() =>
  assertSafeSimulatorLocation({
    protocol: "chrome-extension:",
    pathname: "/mock-linkedin/simulator.html",
  }),
);
assert.throws(() =>
  assertSafeSimulatorLocation({
    protocol: "https:",
    pathname: "/in/sample/",
  }),
);

const lead = {
  id: "lead-123",
  fullName: "Taylor Example",
  currentTitle: "Founder",
  companyName: "Fixture Labs",
};
const fixture = createLeadFixture(lead, 3);
assert.equal(fixture.posts.length, 3);
assert.equal(fixture.email, "taylor.example@simulated.example");
assert.ok(fixture.posts.every((post) => post.text.length >= 30));
assert.equal(scaledSimulationDelay(0), 180);
assert.equal(scaledSimulationDelay(10_000), 1_500);

const transitions = [];
const draftedPosts = [];
const viewEvents = [];
const result = await runLeadSimulation({
  lead,
  settings: {
    postEngagements: 3,
    engagementIntervalMinutes: 60,
    connectionDelayMinutes: 1_440,
    includeNote: true,
  },
  sleep: async () => {},
  api: {
    async draftComment(postText) {
      draftedPosts.push(postText);
      return { draft: `Thoughtful fixture response ${draftedPosts.length}.` };
    },
    async transition(status, details = {}) {
      transitions.push({ status, details });
    },
  },
  view: {
    async visitProfile(value) {
      viewEvents.push(["visit", value.id]);
    },
    async focusPost(post) {
      viewEvents.push(["read", post.id]);
    },
    async reactToPost(post) {
      viewEvents.push(["react", post.id]);
    },
    async commentOnPost(post, draft) {
      viewEvents.push(["comment", post.id, draft]);
    },
    async recordStatus(status) {
      viewEvents.push(["status", status]);
    },
    async sendInvitation(note) {
      viewEvents.push(["invite", note]);
    },
    async acceptInvitation() {
      viewEvents.push(["accept"]);
    },
    async openContactInfo() {
      viewEvents.push(["contact"]);
    },
    async readContactEmail() {
      viewEvents.push(["extract-email"]);
      return fixture.email;
    },
  },
});

assert.equal(draftedPosts.length, 3);
assert.deepEqual(
  transitions.map((item) => item.status),
  ["engaged", "connection_requested", "accepted", "email_collected"],
);
assert.equal(transitions[0].details.postCount, 3);
assert.ok(transitions[1].details.note?.includes("Taylor"));
assert.equal(transitions.at(-1).details.email, fixture.email);
assert.equal(viewEvents.filter(([event]) => event === "react").length, 3);
assert.equal(viewEvents.filter(([event]) => event === "comment").length, 3);
assert.equal(result.postsEngaged, 3);
assert.equal(result.email, fixture.email);
assert.ok(result.invitationNote?.includes("Taylor"));

const simulatorSource = await readFile(
  path.join(extensionRoot, "mock-linkedin", "simulator.js"),
  "utf8",
);
const simulationBackendSource = await readFile(
  path.join(projectRoot, "convex", "simulations.ts"),
  "utf8",
);
assert.equal(
  /scouts:(?:claimNextLead|updateLeadStatus|reportError)/.test(simulatorSource),
  false,
  "Simulator must not mutate the production lead-assignment workflow.",
);
assert.equal(
  /(?:UPDATE|DELETE\s+FROM)\s+lead_assignments/i.test(
    simulationBackendSource,
  ),
  false,
  "Simulation backend must treat production assignments as read-only.",
);
assert.match(simulationBackendSource, /lead_simulation_runs/);
assert.match(simulationBackendSource, /lead_simulation_events/);
assert.equal(
  /https?:\/\/[^\s"']*linkedin\.com/i.test(simulatorSource),
  false,
  "Simulator source must not contain a real LinkedIn URL.",
);

const contentSource = await readFile(
  path.join(extensionRoot, "content.js"),
  "utf8",
);
const backgroundSource = await readFile(
  path.join(extensionRoot, "background.js"),
  "utf8",
);
const popupSource = await readFile(
  path.join(extensionRoot, "popup.html"),
  "utf8",
);
const scoutsSource = await readFile(
  path.join(projectRoot, "convex", "scouts.ts"),
  "utf8",
);
const databaseSchemaSource = await readFile(
  path.join(projectRoot, "database", "schema.sql"),
  "utf8",
);
for (const selectorContract of [
  "data-view-name='feed-full-update'",
  "aria-label^='React'",
  "data-test-ql-editor-contenteditable='true'",
  "comments-comment-box__submit-button--cr",
  "button[aria-label='More']",
  "/preload/custom-invite/",
  "button[aria-label='Send without a note']",
]) {
  assert.ok(
    contentSource.includes(selectorContract),
    `LinkedIn automation is missing the doc.md selector contract: ${selectorContract}`,
  );
}
assert.match(
  contentSource,
  /findPostElements\(\{[\s\S]*?timeoutMs: 30_000,[\s\S]*?minimumCount: maxPosts,/,
);
assert.match(contentSource, /showWorkflowError/);
assert.match(contentSource, /findActiveInvitationDialog/);
assert.match(contentSource, /getLinkedInModalRoots/);
assert.match(contentSource, /connectOptionMatchesTarget/);
assert.match(contentSource, /getInvitationRecipient/);
assert.match(contentSource, /Request cancelled before sending/);
assert.match(contentSource, /toolbarReferencesCurrentProfile/);
assert.equal(
  contentSource.includes(
    'document.querySelectorAll("a[href*=\'/preload/custom-invite/\']")',
  ),
  false,
  "Connect lookup must never scan the entire page where recommendation cards can appear first.",
);
assert.match(contentSource, /data-testid='interop-shadowdom'/);
assert.match(contentSource, /host\.shadowRoot/);
assert.match(
  contentSource,
  /div\[data-test-modal\]\[role='dialog'\]/,
);
assert.match(backgroundSource, /type: "SHOW_AUTOMATION_ERROR"/);
assert.match(backgroundSource, /automationOptions\.postEngagements > 0/);
assert.match(backgroundSource, /type: "SHOW_AUTOMATION_STATUS"/);
assert.match(backgroundSource, /waitForResolvedLinkedInProfileUrl/);
assert.match(backgroundSource, /expectedProfileName: lead\.fullName/);
assert.match(backgroundSource, /expectedProfileUrl: profileUrl/);
assert.ok(
  backgroundSource.indexOf("url: requestedProfileUrl") <
    backgroundSource.indexOf("url: recentActivityUrl"),
  "The imported profile URL must load and resolve before opening recent activity.",
);
assert.match(backgroundSource, /status: "engaged",\s+email: null,/);
assert.match(
  backgroundSource,
  /status: "connection_requested",\s+email: null,/,
);
assert.match(
  popupSource,
  /id="post-engagements" type="number" min="0" max="10"/,
);
assert.match(
  scoutsSource,
  /postEngagements: clampInteger\(args\.postEngagements, 0, 10\)/,
);
assert.match(
  databaseSchemaSource,
  /CHECK \(post_engagements BETWEEN 0 AND 10\)/,
);

const listenerStub = () => ({ addListener() {}, removeListener() {} });
const backgroundContext = {
  URL,
  clearTimeout,
  console,
  importScripts() {},
  setTimeout,
  chrome: {
    action: {},
    alarms: { create() {}, onAlarm: listenerStub() },
    runtime: {
      onInstalled: listenerStub(),
      onMessage: listenerStub(),
      onStartup: listenerStub(),
    },
    tabs: { onUpdated: listenerStub() },
  },
};
vm.runInNewContext(backgroundSource, backgroundContext);
assert.equal(backgroundContext.clampInteger(0, 0, 10), 0);
assert.equal(
  backgroundContext.normalizeLinkedInProfileUrl(
    "https://linkedin.com/in/taylor-example/recent-activity/all/?x=1",
  ),
  "https://www.linkedin.com/in/taylor-example",
);
assert.throws(
  () => backgroundContext.normalizeLinkedInProfileUrl("https://example.com/in/test"),
  /LinkedIn profile URL/,
);
assert.equal(
  backgroundContext.isOpaqueLinkedInProfileSlug(
    "ACwAAAAA_40BB4SgUAstyDVvhPe-b63ueqoSlZ0",
  ),
  true,
);
assert.equal(
  backgroundContext.isOpaqueLinkedInProfileSlug("mark-butler-3b691849"),
  false,
);
let redirectPolls = 0;
backgroundContext.chrome.tabs.get = async () => ({
  url:
    redirectPolls++ < 2
      ? "https://www.linkedin.com/in/ACwAAAAA_40BB4SgUAstyDVvhPe-b63ueqoSlZ0"
      : "https://www.linkedin.com/in/mark-butler-3b691849/",
});
assert.equal(
  await backgroundContext.waitForResolvedLinkedInProfileUrl(
    123,
    "https://www.linkedin.com/in/ACwAAAAA_40BB4SgUAstyDVvhPe-b63ueqoSlZ0",
    5_000,
  ),
  "https://www.linkedin.com/in/mark-butler-3b691849",
);

console.log(
  "Extension checks passed: simulator transitions, manifest matches, doc.md selectors, and LinkedIn profile URL normalization are valid.",
);
