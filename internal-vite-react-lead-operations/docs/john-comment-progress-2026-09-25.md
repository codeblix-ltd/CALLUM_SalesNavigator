# John Kerzee: comment progress save failure

**Report:** `k57daar9yctp7hr6w6t28ecm7s8f2keq`

**Status:** Investigated and a real related code defect fixed locally; John's exact storage failure and post-fix run are **not verified**.

## Observed production evidence

- Report context: extension v0.10.39, Chrome 154 on Windows, Asia/Manila. Report occurred about 09:26 UTC on 25 September 2026. The screenshot shows the automation paused on Thomas Arenz, zero leads completed, and the full error: `Comment progress could not be saved. Nothing else will be posted. Please ask your manager for help.`
- Read-only Cockroach inspection found 12 `profile_visited` and 10 `language_checked` events across two leads between 09:23 and 09:51 UTC. Thomas Arenz was revisited repeatedly. The operator had zero `lead_post_activities`, and the two viewed assignments had no `last_error`. No public comment or connection request is evidenced by these backend records.
- A fresh read-only query at 10:40 UTC found eight profile visits after the report was received, the latest at 10:15:30 UTC, but no `comment_receipt_storage_failed` diagnostic event. That event requires the unreleased client and cannot retrospectively reveal the underlying error from v0.10.39.
- The screenshot's error text comes from `saveCommentReceipts` in `chrome-extension/content.js`, not the writing service. v0.10.39's archived source had the same broad `catch` as current source: it replaced every storage/API failure with one generic message. Consequently the report cannot distinguish Chrome quota, extension context invalidation, a full receipt set, or another local write problem.

## Confirmed related code defect and reproduction

The 100-receipt cap counted **all** Callum Scout receipts in one Chrome profile, but the cleanup candidate filter admitted only completed/synced receipts owned by the **current** scout. A new scout with no saved comments could therefore be blocked by 100 fully synced receipts left by a previous login. This is a deterministic extension defect, **not proven to be John's actual local-storage state**.

`scripts/test-scout-recovery.mjs` now seeds 100 complete/synced receipts for a previous login, then asks the current scout to save a fresh receipt. The test failed on the old code with John's exact generic error. It passes after the cleanup filter safely includes complete/synced receipts from any prior login. Tests continue to protect uncertain or unsynced receipts from deletion.

## Local changes, not yet released

- `chrome-extension/content.js`: safely frees fully synced old-login receipts when the extension-wide cap is reached. If Chrome rejects a write for quota below that cap, it makes one bounded retry after removing at most 20 completed, synced receipts. Both paths preserve unfinished or uncertain receipts. A remaining storage failure carries a sanitized stage (`read`, `prune`, or `write`), reason (`receipt_limit`, `quota`, `extension_reloaded`, or `unknown`), and receipt count while keeping the scout-facing message plain.
- `chrome-extension/background.js` and `convex/scouts.ts`: convey that classification to a scout-owned `comment_receipt_storage_failed` event without storing profile text, comments, raw exception messages, or browser secrets.
- Manifest and relevant tests now target local v0.10.46. The 24-file ZIP is byte-checked against source and untracked. The owner says they loaded the unpacked directory in the attached Chrome profile, but the browser interface cannot independently verify its identity; it is **not submitted or published**. `pnpm exec convex dev --once` reported the new backend action ready on the configured `hearty-mallard-696` deployment at 14:27 Dubai time. John was on v0.10.39 according to his report, so the new extension-side behavior cannot yet help his reported installed copy.
- `scripts/test-profile-link-review.mjs` was adjusted to respond to the existing recent-failure guard query; this repairs a test fixture that had fallen behind the already deployed backend code, not a new production behavior.

## Verification and gaps

The new cross-login regression failed before the fix and passed afterward. A second red/green test showed that a quota failure below the count cap could also pause the run; it now recovers by removing only synced history, preserving an uncertain receipt. `node scripts/test-scout-recovery.mjs` also verifies an unrecoverable quota failure stops before posting and that the sanitized classification reaches the content-script response. All six focused scripts, JavaScript syntax checks, TypeScript check, targeted lint, and `git diff --check` passed after the quota-retry change.

We have **not** read John's Chrome extension storage, captured his underlying Chrome API error, run v0.10.46 on his machine, or observed a post-fix request/comment. Do not claim his exact issue is fixed or close his report. The next real report from an updated client should include the new reason/stage event; if it remains `unknown`, inspect the authorized local browser context before changing behavior again. Do not advise repeated Resume clicks as a cure.

An accurate progress reply was sent in John's support conversation at 14:30 Dubai time. It states that one cause was corrected, the exact cause on his computer is unconfirmed, and the update has not been released. The report remains Open with an internal investigation note.

## Later review on 25 September

An independent review found that a storage error during the confirmed-to-synced
write lost its diagnostic code in a generic wrapper. Version 0.10.47 preserves
the sanitized classification there. A focused regression confirms that the
durable receipt remains `confirmed` and no public comment is posted again.
The v0.10.47 ZIP was byte-checked against source and is still unpublished.
This strengthens future diagnosis; it does not establish John's specific cause
or verify his installed browser.
