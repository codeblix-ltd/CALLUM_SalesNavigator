import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../convex/scouts.ts", import.meta.url), "utf8");
const start = source.indexOf("export const rejectFailedLead = action(");
const end = source.indexOf("export const getScoutOperations = action(");
assert(start > 0 && end > start, "manual rejection handlers must be present");
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(initialStatus, { reserved = null, operator = "jenny" } = {}) {
  const assignment = operator === "jenny"
    ? { status: initialStatus, reserved_on: reserved, qualification_note: "Good fit", qualification_status: "qualified" }
    : null;
  const pendingTasks = [{ status: "pending" }, { status: "pending" }];
  const sql = [];
  const events = [];
  const database = {
    connect: async () => ({
      async query(statement, args = []) {
        sql.push(statement);
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(statement)) return { rows: [] };
        if (statement.includes("SELECT status, connection_request_reserved_on")) {
          assert.equal(args[1], "jenny", "the assignment lookup must use the authenticated operator");
          return { rows: assignment ? [{ ...assignment }] : [] };
        }
        if (statement.includes("UPDATE lead_assignments")) {
          assert(assignment);
          assert.equal(args[1], "jenny");
          assert.match(statement, /SET status = 'skipped'/);
          assert.doesNotMatch(statement, /qualification_status\s*=/, "a dead profile is not necessarily a poor-fit lead");
          assignment.status = "skipped";
          assignment.qualification_note = args[2];
          return { rows: [] };
        }
        if (statement.includes("UPDATE lead_followup_tasks")) {
          assert.equal(args[1], "jenny");
          for (const task of pendingTasks) task.status = "cancelled";
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${statement}`);
      },
      release() {},
    }),
  };
  const values = { string: () => ({}), literal: () => ({}), optional: () => ({}), union: () => ({}), null: () => ({}) };
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports, v: values, action: definition => definition,
    internal: { scoutIdentity: { requireScout: "identity" } },
    getPool: () => database, insertEvent: async (_client, leadId, operatorId, kind, details) => events.push({ leadId, operatorId, kind, details }),
  };
  vm.runInNewContext(compiled, sandbox);
  const ctx = { runQuery: async () => ({ operatorId: "jenny" }) };
  return {
    reject: (args) => module.exports.rejectLead.handler(ctx, args),
    rejectFailed: (args) => module.exports.rejectFailedLead.handler(ctx, args),
    assignment, pendingTasks, events, sql,
  };
}

const accepted = fixture("accepted");
await accepted.reject({ leadId: "daniel-id", reason: "profile_unavailable", note: "Page does not exist" });
assert.equal(accepted.assignment.status, "skipped");
assert.equal(accepted.assignment.qualification_status, "qualified", "historical fit assessment stays intact");
assert.match(accepted.assignment.qualification_note, /^Rejected by scout: Profile does not open/);
assert(accepted.pendingTasks.every(task => task.status === "cancelled"), "pending follow-ups must be cancelled");
assert.equal(accepted.events[0].kind, "lead_rejected");
assert.equal(accepted.events[0].details.previousStatus, "accepted");
assert.equal(accepted.events[0].details.reason, "profile_unavailable");
assert.equal(accepted.sql.at(-1), "COMMIT");

const failed = fixture("failed");
await failed.rejectFailed({ leadId: "failed-id" });
assert.equal(failed.assignment.status, "skipped", "older extension clients retain their rejection action");
assert.equal(failed.events[0].details.previousStatus, "failed");

for (const bad of [fixture("skipped"), fixture("withdrawn"), fixture("accepted", { reserved: "2026-09-24" }), fixture("accepted", { operator: "someone-else" })]) {
  await assert.rejects(bad.reject({ leadId: "lead-id", reason: "wrong_profile", note: "" }));
  assert.equal(bad.events.length, 0, "an ineligible or unowned lead cannot be rejected");
  assert.equal(bad.pendingTasks[0].status, "pending", "a rejected transaction must not cancel tasks");
  assert.equal(bad.sql.at(-1), "ROLLBACK");
}
await assert.rejects(fixture("accepted").reject({ leadId: "lead-id", reason: "other", note: "" }), /Add a short reason/);
assert.match(source, /stage === "rejected"[\s\S]{0,140}a\.status = 'skipped'/);
assert.match(source, /AND a\.status IN \('accepted', 'email_collected'\)[\s\S]{0,80}AND a\.accepted_at/, "rejected accepted leads cannot regain follow-ups");
assert.match(source, /AND t\.status = 'pending'\s+AND a\.status IN \('accepted', 'email_collected'\)/, "rejected leads cannot show pending follow-ups");
assert.match(source, /AND a\.status = 'accepted'\s+AND coalesce\(l\.original_email_status/, "rejected leads must stay out of accepted-contact checks");
assert.match(source, /stage === "needs_attention"[\s\S]{0,330}AND NOT \(a\.status = 'skipped' AND coalesce\(a\.qualification_note, ''\) LIKE 'Rejected by scout%'/, "rejected leads should not keep appearing under Needs attention");

const followupStart = source.indexOf("async function ensureAcceptedFollowupTasks(");
const followupEnd = source.indexOf("function firstNameFrom(", followupStart);
assert(followupStart > 0 && followupEnd > followupStart);
const followupCode = ts.transpileModule(source.slice(followupStart, followupEnd), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
async function synthesizedFollowups(status) {
  const steps = [];
  const client = {
    async query(statement) {
      if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") {
        steps.push(statement);
        return { rows: [] };
      }
      assert.match(statement, /SELECT status FROM lead_assignments[\s\S]*FOR UPDATE/);
      steps.push("locked assignment");
      return { rows: [{ status }] };
    },
    release() { steps.push("released"); },
  };
  const sandbox = {
    getPool: () => ({ query: async () => ({ rows: [{ lead_id: "lead-id", first_name: "Daniel" }] }), connect: async () => client }),
    createFollowupTasks: async () => { steps.push("created tasks"); },
    nullableString: value => value,
  };
  vm.runInNewContext(`${followupCode}\nthis.checkFollowups = ensureAcceptedFollowupTasks;`, sandbox);
  await sandbox.checkFollowups("jenny");
  return steps;
}
assert.deepEqual(await synthesizedFollowups("accepted"), ["BEGIN", "locked assignment", "created tasks", "COMMIT", "released"]);
assert.deepEqual(await synthesizedFollowups("skipped"), ["BEGIN", "locked assignment", "COMMIT", "released"], "a rejected assignment cannot regain pending follow-ups");
console.log("Manual rejection checks passed: accepted/failed leads, ownership, reservation guard, permanent queue exit, follow-up cancellation, and audit trail.");
