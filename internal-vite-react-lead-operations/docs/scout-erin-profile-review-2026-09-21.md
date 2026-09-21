# Erin: repeated unverified-profile pause, 21 September 2026

Report `k572486kxryqf3ye5ckek9vt7x8evmna`, extension 0.10.39, Chrome 153.

## Evidence and cause

- Screenshot and report identify Manoj Paliwal. Eleven identical errors occurred
  from 12:26:03 to 13:13:59 UTC. Assignment remained `viewed`; no engagement or
  connection was recorded for that lead.
- The opaque imported URL had no stored readable replacement. The resolver
  refused to proceed without a verified link. `reportError` preserved the lead
  as `viewed`, and Resume reselected it: retrying could not change the input.
- Support's browser reached a blank `/in/` page from both the original link and
  a matching indexed public profile. This does not establish what LinkedIn
  displayed in Erin's session, or whether the member deleted the account. No
  guessed replacement link was saved. No laptop/account-switch/AI-outage claim.

## Backend containment, no extension update

`profileLinkNeedsReviewSql` recognizes only the exact old-client error and a
still-opaque effective URL. Automatic Resume, normal Start and Retry failed
exclude those leads. They remain assigned with their status, error, activity
receipts and counters intact, visible under Needs attention rather than
Automation ready. Manual selection explains the review requirement. An
otherwise exhausted queue reports the review requirement, not false completion.

A verified readable replacement makes the lead eligible again. Unattempted
opaque URLs and unrelated sign-in, checkpoint, network or writing-service errors
are not held by this rule. A new unresolved profile can still pause once; this
change prevents its endless automatic reselection, not every navigation failure.

## Verification

| Gate | Evidence | Result |
| --- | --- | --- |
| Actual claim handler paths | `scripts/test-profile-link-review.mjs`: VM doubles for resume, start, failed retry, explicit selection, exhausted/empty queues, exclusions, repaired URL, unrelated errors | Pass |
| Actual Cockroach predicate | Same script `--live`, nine read-only SQL cases including nulls and URL overrides | Pass |
| Existing stability regressions | `pnpm run stability:test` | Pass |
| Backend typecheck | `pnpm exec tsc --ignoreConfig --noEmit --skipLibCheck --moduleResolution bundler --module esnext --target es2023 --allowSyntheticDefaultImports convex/scouts.ts` | Pass |
| Deployment | `pnpm exec convex dev --once`, live app deployment `hearty-mallard-696`, ready 13:37 UTC | Pass |
| Deployed read-only action | `scouts:getLeadProgress` with authorized deployment-admin diagnostic identity: Manoj present in Needs attention, absent in Automation ready | Pass |
| Erin's live queue | Read-only before/after selection: old logic picks Manoj; new logic selects another eligible assignment | Pass |
| Independent review | No blockers; review requested and verified Needs attention/ready consistency | Pass |
| Erin's resumed browser workflow | No public action executed on her behalf; awaiting her retry | Not yet verified |
| Manoj's usable profile | No current verified replacement | Unresolved |

Reply directs Erin to Stop completely, then Start a normal run without selecting
Manoj. It explains the applied change and retained lead, says no reinstall is
needed, and asks her to reply within this ticket if the run stops. Keep the
report under investigation with these two explicit remaining gates; do not
describe containment as full profile recovery.
