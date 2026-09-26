# Rymaelie follow-up: Bob Jordan invitation gate (26 September 2026)

## What was verified

- Report `k574hbmm65kynzcjdevav6h0ns8f3yct` contains Rymaelie's 25 September reply that a profile still showed Connect after the run. Her new screenshots show Bob Jordan with Connect before and after, not Pending. They do not capture the brief red error.
- At 22:09 UTC, production recorded Bob's profile visited, language checked, post engagement skipped, then `failed`: “We couldn’t check that the request is for Bob Jordan. Nothing was sent.” There is no `connection_requested` event for Bob in that run.
- In an authenticated **different** LinkedIn account, opening the Connect dialog on `https://www.linkedin.com/in/bob-jordan-25352b18/` reproduced LinkedIn's gate: “To verify this member knows you, please enter their email to connect.” The send action was disabled without an email. No email was entered and no invitation was sent. This verifies the account-side gate in that account, not that Rymaelie's account displays the identical dialog.
- Bob's exact Rymaelie assignment (`52ce8c04-2569-424c-b6a2-a2a30755d7ca`) was still `failed` with the generic error. After checking its ID, scout, status, URL, and existing error, that one row was changed to the new email-required review error. The deployed queue predicate now holds it from automatic retry. No other assignment was changed.

## Broader seven-day audit (queried 26 September, 08:23 UTC)

- 30 scouts had 451 recipient-verification failures like Bob's. **26 of those 30** recorded at least one connection request after their own *latest* such failure. Four had no later recorded request: Rymaelie, Shayne, Jimmalyn, and Apple. This is recovery evidence for the 26, not proof that every failed lead was fixed; absence of later events does not prove the other four stayed blocked continuously.
- 18 scouts had 1,449 connection-state failures. The highest counts were Rymaelie 724, Jimmalyn 399, and Apple 159. These errors are not all known to be email gates; Bob is the only profile whose email gate was directly observed in this investigation.
- Before Rymaelie's next claim at 22:11:52 UTC, the three recent terminal outcomes were a state failure, Bob's recipient-verification failure, and another state failure. The previous server guard counted only three identical state failures, so it did not stop this mixed failure streak. The new guard counts all three safely uncompleted connection actions, preventing more leads being consumed in that pattern.
- Maryam had no bug reports in the live bug-report table at review. Her event history had 16 recorded requests on 24 September, 20 on 23 September, 12 on 22 September, 16 on 21 September, and 20 on 18 September, with a few isolated failures. She had none of the two exact error classes above in the seven-day audit. That does **not** establish that she had no complaints through other channels or that her workflow was flawless. There were no recorded events for her on 25 or 26 September at the time of review.

## Fix and verification

- v0.10.48 detects LinkedIn's explicit email-required invitation dialog **before** checking the invite recipient, dismisses it, and records a truthful “no request sent; manual review” outcome. The backend excludes that exact outcome from automatic retries. It does not guess an email, bypass LinkedIn, or mark the lead rejected.
- The backend also stops new automatic claims after three recent uncompleted connection actions even when recipient-verification and connection-state failures are mixed. Deployed once to configured `hearty-mallard-696` (Convex reported “functions ready”). The code was tested against the exact observed modal text, simulated queue/guard paths, and a live read-only Cockroach predicate. The old Bob assignment was held through one conditional database update.
- Passing checks: `node scripts/test-email-required-invitation.mjs`, `node scripts/test-scout-complaints.mjs`, `node scripts/test-linkedin-navigation.mjs`, `node scripts/test-profile-link-review.mjs`, `node scripts/test-profile-link-review.mjs --live`, `node scripts/test-extension.mjs`, `node --check` for content/background, `pnpm exec tsc -b --pretty false`, targeted `pnpm exec oxlint`, `git diff --check`.
- `Callum-Scout-0.10.48.zip` contains 24 extension runtime files, each SHA-256-matched to its source; archive SHA-256 `F66F3C5E8FC0F80E65A4315D91B30C65704AB182AA05F49BBD8C572CEB9EA257`.

## Release and remaining limits

The backend guard is deployed, but v0.10.48 has **not** been submitted or published in the Chrome Web Store, and Rymaelie's installed version is unverified. No fresh Rymaelie run after the fix has been observed, so her broader connection-state problem is **not** declared resolved. No consenting test recipient was available for an irreversible live invitation; therefore no end-to-end request/Pending/backend-one-request validation has passed. Keep the report Investigating until her next diagnostic run and the store update are verified.
