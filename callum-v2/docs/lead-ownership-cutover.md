# V1/V2 lead ownership and cutover

## Current boundary

V1 stores one `public.lead_assignments` row per lead UUID and its admin/import paths can create assignments while V2 is running. V2 reads `public.leads` and `public.lead_niches` but writes run state only in `callum_v2`. A V2 run or action intent does **not** reserve a lead against V1. The 1k/10k shadow workloads may therefore include V1-assigned leads; shadow has no irreversible LinkedIn action.

For the single-recipient `live_canary` path, V2 now requires an enabled installation owned by the selected operator and reads `public.lead_assignments` at run creation and immediately before authorizing Connect, comment, or withdrawal. It rejects a lead with any V1 assignment, regardless of assignment status or operator. These checks issue `SELECT` only. A rejected run returns `V1_LEAD_ASSIGNED`; an action authorization returns `ACTION_NOT_AUTHORIZED` before the extension can click. The latter check also covers a V1 assignment added after V2 run creation. No V1 code, data, or deployment is changed by these checks.

The checks are a fail-closed overlap filter, **not shared ownership**. V1 may assign an unassigned lead after V2's final read. V2 must remain limited to an expressly consenting, controlled QA recipient until V1 and V2 participate in a common claim protocol or the QA recipient is formally excluded from V1's selection and imports. The QA recipient must also satisfy the separate exact-profile and browser identity checks.

## Cutover requirement

Before expanding live V2 beyond the controlled QA recipient, choose and implement one coordinated ownership mechanism, with both V1 and V2 writers participating:

1. Add a durable lead claim keyed by canonical lead UUID, with a unique owner, lease/expiry policy, and explicit terminal/release states. Treat profile URL alone as insufficient identity. Define how existing `public.lead_assignments` are represented before issuing new V2 claims.
2. Make every V1 assignment path (admin assignment, imports, upload, scripts) and every V2 live selection path acquire or respect that claim in the same transaction as its assignment decision. Existing V1 assignments take precedence. Preserve V1's current behavior until this coordinated change has its own compatibility review and rollout approval.
3. Recheck ownership at action authorization. On lost ownership, stop the action, keep any uncertain prior click in observation-only reconciliation, and produce an auditable conflict event. Never transfer an unresolved action intent to another operator.
4. Backfill and reconcile existing assignments, compare counts and duplicate profile identities, then run a dry-run overlap report before enabling new cohorts. Use a canary cohort, monitor conflicts and V1 assignment throughput, and keep a global V2 action kill switch ready.
5. Roll back by disabling V2 live action authorization first, letting uncertain commands reconcile read-only, and retaining claims/audit history. Do not delete V1 assignments or switch the production extension during rollback.

The current V2 branch does not implement this shared protocol because the Goal freezes V1. It is a separate production cutover prerequisite, not a claimed V2 test pass.

## Verification

Implementation commits: `57179fa` (V1 assignment overlap) and `2c8de40` (installation binding). Run `V2_TEST_DB=1 node --env-file=<local server env> --test tests/lead-ownership.integration.test.mjs` from `callum-v2`. The test reads a real V1-assigned lead, verifies that the public `createRun` path rejects it, rejects a missing or cross-operator installation, then constructs V2-only rows to model a V1 assignment appearing after run creation and verifies action authorization rejects it without an authorization event. It also checks an unassigned lead can enter a one-lead QA run when available. It performs no public DML. On 2026-09-25 this Cockroach test passed with no skips. Eight affected action/recovery Cockroach integrations then passed sequentially. The read-only post-test count was 63,135 V1 assignments, and dev config remained version 27. Local `pnpm test` also passed 38 tests with its DB-gated cases skipped before the configured Cockroach run; `pnpm build` and `pnpm verify:v1` passed. These results do not prove the remaining V1/V2 assignment race is closed.
