import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

assert.equal(manifest.version, "0.3.0");
assert.equal(
  manifest.host_permissions.some((permission) =>
    permission.includes("linkedin.com"),
  ),
  false,
  "Simulator must not gain LinkedIn host permissions.",
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

console.log(
  "Extension simulator passed: 3 fixture posts reacted/commented, invitation accepted, email extracted, and four database transitions emitted.",
);
