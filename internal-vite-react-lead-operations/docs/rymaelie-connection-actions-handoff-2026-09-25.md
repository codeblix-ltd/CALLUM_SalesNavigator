# Rymaelie: profiles checked, no requests sent — verification handoff

**Date:** 25 September 2026 (Dubai time)

**Report:** `k574hbmm65kynzcjdevav6h0ns8f3yct`

**Reported symptom:** "Ran automation yesterday and today. Only runs leads checked in for hours but no requests sent."

**Status:** Contained in part, **not verified resolved for Rymaelie**. Do not close the report or tell the scout that sending works until an actual run confirms it.

## What the evidence establishes

- The report was submitted from extension v0.10.42. The two attached images did not show the profile's top action buttons clearly enough to establish what LinkedIn offered in Rymaelie's own session. One shows the report form; the other shows the automation waiting for profile actions on Karen Er. The report's captured run step also refers to a LinkedIn refresh while checking Cheah Siew Yen.
- Read-only production activity inspection for 24–25 September in the scout's Manila timezone found **421 profile visits, zero recorded connection requests**: 168 visits on the 24th and 253 on the 25th. Of 412 failures in that period, 399 carried the exact message: `The connection state could not be confirmed. Nothing was sent for this lead.` These are historical counts, not a post-fix success measurement; a reviewer should rerun the query if current counts matter.
- The old workflow handled that error as an ordinary failed lead, then claimed the next lead. It had a circuit breaker for unreadable pages, but not for repeated connection-state failures. This explains how the run could keep increasing "leads checked" for hours with no request. It does **not** by itself prove why Rymaelie's LinkedIn session did not show a usable connection action.
- In the Codex-controlled Chrome browser, a **different logged-in LinkedIn account** showed a Connect invitation link on the affected [Karen Er profile](https://www.linkedin.com/in/karen-er-3121782/). Its live page used a degree badge like `<p>· 3rd</p>` and an overflow SVG with `id="overflow-web-ios-small"`. The extension's previous parser did not fully cover these patterns. The page inspection found a real compatibility defect, but a Connect button in another account is not evidence that Rymaelie's account had one. No invitation was sent in this inspection.

## Changes made

1. Commit [`ff8c0d8`](https://github.com/codeblix-ltd/CALLUM_SalesNavigator/commit/ff8c0d8) changes `chrome-extension/content.js` to recognize the observed relationship badge and overflow icon, and to scope connection-state inspection to the profile intro section. It adds coarse failure diagnostics (whether the main element, target heading, invitation link, More/Pending action, and visible actions exist, plus UI language). It does not store profile text in this diagnostic event.
2. The same commit changes `chrome-extension/background.js` to preserve a `CONNECTION_STATE_UNCONFIRMED` error code and stop a run after two consecutive affected profiles, rather than consume a third. It records the diagnostic event through the authenticated `scouts:recordConnectionInspectionFailure` action in `convex/scouts.ts` and bumps the extension manifest to **v0.10.45**.
3. Commit [`5b9e436`](https://github.com/codeblix-ltd/CALLUM_SalesNavigator/commit/5b9e436) adds a server-side guard for older extension versions. Before an automatic next-lead claim, if the last three terminal outcomes in the previous 15 minutes are all failures with that exact connection-state message, the claim stops with an explanatory error. This is containment after three such failures, **not** a fix that makes a connection request succeed. A manual specific-lead claim is not covered by this guard.
4. Both commits were pushed to `main`. The backend changes were applied to the extension's configured Convex deployment, `hearty-mallard-696`, using `pnpm exec convex dev --once`; the CLI reported success on 25 September at approximately 11:02 and 11:26 Dubai time. The configured URL is in `chrome-extension/config.js`. Do not use this deployment statement as proof of a successful post-change scout run. A generic `convex deploy` command targets a different default deployment in this workspace.
5. A local `Callum-Scout-0.10.45.zip` was built and its manifest/source entries checked against the working tree (SHA-256: `7DA06160A92FB60E9E26B50678B7EB944ED99EC6DB714F59CE52EF085283DE28`). This ZIP is an **untracked local artifact, not part of GitHub**. v0.10.45 has **not** been submitted to or approved by the Chrome Web Store; the developer console required Google account verification and no configured Web Store OAuth credentials were available. Thus scouts still on older store versions do not have the extension-side parser, circuit breaker, or new diagnostics. Only the backend guard applies to them now.
6. A plain-language reply was posted to Rymaelie's ticket asking them to stop the run, open an affected profile in the same Chrome profile, and attach a screenshot showing its top buttons and any LinkedIn notice. The ticket was deliberately left open. No claim of a completed fix was sent to the scout.

## Reproduction and tests — exact scope

| Check | Result | What it proves / does not prove |
| --- | --- | --- |
| Historical production events | Repeated failures and zero recorded requests, as above | Confirms the symptom; does not reveal the exact UI in Rymaelie's browser. |
| `scripts/test-linkedin-navigation.mjs` red/green VM harness | The new three-lead connection-state case failed against the old logic, then passed after the change; it now stops after two claims | Reproduces and fixes **queue exhaustion under a simulated connection-state error**, not a live LinkedIn invitation. |
| `scripts/test-scout-complaints.mjs` DOM fixtures | Passes for `· 3rd`, `· 1st`, nested affiliation controls before Pending, and sanitized diagnostics | Tests the parser against representative markup; does not run the full extension in Rymaelie's account. |
| `scripts/test-extension.mjs` focused assertion | Passes for the observed overflow SVG shape, including a non-English More label | Tests that selector; does not prove every LinkedIn layout. |
| `scripts/test-scout-recovery.mjs`, `scripts/test-profile-link-review.mjs`, `scripts/test-manual-rejection.mjs` | Passed during implementation | Focused regression coverage, not proof of a live request. |
| `pnpm exec tsc -b --pretty false`, targeted `pnpm exec oxlint`, `git diff --check` | Passed during implementation | Type/lint/patch checks only. |
| Backend guard query | Read-only replay against historical outcomes indicated that Rymaelie would be blocked, while selected comparison scouts would not; the SQL syntax also succeeded against Cockroach | Does not prove the newly deployed guard was exercised by a fresh Rymaelie run. |
| Actual extension sending a request in Rymaelie's Chrome session | **Not done** | No end-to-end proof of the reported issue being resolved. |

Two focused test commands were also rerun on 25 September after the handoff discussion: `node scripts/test-scout-complaints.mjs` and `node scripts/test-linkedin-navigation.mjs` passed. The implementation tests use VM stubs/fixtures; they are not a substitute for an authenticated browser run.

## What was not done, and why

- **No exact account-level root cause was proven.** We could not inspect Rymaelie's logged-in LinkedIn page or account notices. Their screenshot did not expose the top action controls. A LinkedIn account limitation, an in-session page state, a language/layout variation, and a parser miss have not been conclusively separated for that account.
- **No real end-to-end invitation was sent or confirmed with v0.10.45.** We did not have Rymaelie's authenticated session or an authorized designated test recipient. Sending a real invitation from the operator's unrelated account would not validate Rymaelie's environment and would alter live LinkedIn state.
- **The extension update is not live.** Google account verification blocked Web Store submission. The local ZIP was not published or distributed to scouts. No assumption should be made that users already have v0.10.45.
- **No post-deployment scout success was observed.** The backend guard can prevent further lead consumption; it cannot make LinkedIn expose Connect or prove a request was sent. The report remains open.
- **No claim that all similar scout complaints are fixed.** This handoff concerns the specific recurring connection-state failure and the identified parser/control defects.

## Independent verification requested

1. Recheck the report and current activity for `rymaelie`; record the exact timestamp, installed extension version, lead, error event, and any new `connection_inspection_failed` event. That diagnostic event is available only after v0.10.45 reaches the scout.
2. With Rymaelie's cooperation, inspect one affected profile **in their Chrome profile**, including the top action buttons and any LinkedIn warning, checkpoint, or invitation-limit notice. Do not infer their state from another account.
3. Test v0.10.45 in an authorized Chrome profile against a designated consenting test recipient. Observe the extension from lead claim through action detection; if sending is authorized, verify LinkedIn shows Pending and the backend records exactly one request. Also test the no-Connect path: after two consecutive failures it should pause without claiming a third lead.
4. Independently exercise the backend guard on an old version or a controlled test operator: three exact failures inside 15 minutes should block the next automatic claim without changing existing lead outcomes. Check that a successful/other outcome resets the sequence as intended.
5. Submit v0.10.45 to the Chrome Web Store after developer-account verification; wait for approval, then verify the published version before asking Rymaelie to retry. Keep the ticket open until their own run sends a request or the precise account-side blocker is identified.

For Chrome's supported extension debugging approach, see [Debug extensions](https://developer.chrome.com/docs/extensions/get-started/tutorial/debug) and [End-to-end extension testing](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing). Chrome Web Store [updates require an uploaded package and review](https://developer.chrome.com/docs/webstore/update).
