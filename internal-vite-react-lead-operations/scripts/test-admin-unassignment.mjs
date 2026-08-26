import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [eligibilitySource, backendSource, analyticsSource, appSource] = await Promise.all([
  readFile(new URL("../convex/lib/leadUnassignment.ts", import.meta.url), "utf8"),
  readFile(new URL("../convex/adminScouts.ts", import.meta.url), "utf8"),
  readFile(new URL("../convex/adminAnalytics.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
]);

for (const requiredGuard of [
  "original_email",
  "work_email",
  "email_collected_at",
  "viewed_at",
  "engaged_at",
  "connection_requested_at",
  "accepted_at",
  "qualification_status",
  "lead_note",
  "lead_assignment_events",
  "lead_post_activities",
  "lead_followup_tasks",
  "scout_escalations",
  "crm_delivery_outbox",
  "veblenMatchExistsSql",
]) {
  assert.match(eligibilitySource, new RegExp(requiredGuard), `Missing unassignment guard: ${requiredGuard}`);
}

assert.match(backendSource, /requireAdmin/);
assert.match(backendSource, /DELETE FROM lead_assignments/);
assert.match(backendSource, /leadCanReturnToPoolSql/);
assert.match(backendSource, /'admin_unassigned'/);
assert.match(backendSource, /destination: "unassigned_pool"/);
assert.match(backendSource, /export const bulkUnassignLeads/);
assert.match(backendSource, /protectedCount/);
assert.match(analyticsSource, /canUnassign: v\.boolean\(\)/);
assert.match(analyticsSource, /unassignBlockedReason/);
assert.match(appSource, /Return this lead to the pool\?/);
assert.match(appSource, /Only untouched leads can move/);
assert.match(appSource, /This does not delete the lead or its niche data\./);
assert.match(appSource, /api\.adminScouts\.unassignLead/);
assert.match(appSource, /api\.adminScouts\.bulkUnassignLeads/);
assert.match(appSource, /Return untouched leads/);

console.log("Admin lead unassignment guard test passed.");
