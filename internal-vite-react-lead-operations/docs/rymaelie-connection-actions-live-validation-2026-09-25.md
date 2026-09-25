# Rymaelie live validation

**Status: NOT LIVE VALIDATED.** This is a progress record, not a release approval or a claim that Rymaelie's requests now send.

## Original symptom

Report `k574hbmm65kynzcjdevav6h0ns8f3yct`: profiles were checked for hours without a recorded connection request. The historical evidence and its limitations are in [the handoff](rymaelie-connection-actions-handoff-2026-09-25.md).

## Relevant commits reviewed

- `ff8c0d8`: expanded profile-action parsing, two-failure extension circuit breaker, coarse diagnostics, v0.10.45 manifest.
- `5b9e436`: backend guard after three matching connection-state failures in 15 minutes on old extension versions.
- `c4ee050`: prior verification handoff explicitly says no end-to-end run had been completed.

The code fixes are not being treated as proof that the original account-side failure is resolved.

## Environment

- Windows, attached Chrome integration. Its browser inventory identified the profile generically as the owner's existing Chrome profile; LinkedIn's visible sidebar identified the logged-in account as Antish Choolun. This is **not Rymaelie's Chrome/LinkedIn session**.
- A real LinkedIn tab at `https://www.linkedin.com/in/karen-er-3121782/` was opened in that attached Chrome profile on 25 September 2026, approximately 14:20 Dubai time.
- The Callum Scout content-script overlay was visible and said Ready, proving some Callum Scout build was injected. Its **extension ID, installed version, source directory, and match to the repository build remain unverified**.
- The browser-control layer denied `chrome://extensions` with an explicit security-policy prohibition on alternate routes to the same outcome. No filesystem, process, CDP, or alternate-UI workaround was attempted after that denial.
- The owner subsequently said they loaded the unpacked v0.10.46 directory in the attached Chrome profile. A normal LinkedIn reload still showed a single Callum Scout Ready overlay. This is user attestation plus injection evidence, **not an independent check of the installed build/version**; the blocked browser-management route was not retried.
- Source base SHA: `c4ee0502803c30fe1f73a989de89edef04082faa` plus currently uncommitted v0.10.46 changes. Extension configuration points to `hearty-mallard-696`; no post-change Rymaelie run has been observed there.
- Local `Callum-Scout-0.10.46.zip` contains 24 runtime files. Every ZIP entry matched its source file by SHA-256 after the final quota-recovery change; archive SHA-256: `477F6EDDF9D8E9C7943D69729A6DD53F120FC20E1B1153887A066014829570EE`. The owner says they loaded its unpacked directory in the attached profile, but that running build is not independently verified. The ZIP has **not** been submitted to the Chrome Web Store.
- A subsequent file-by-file SHA-256 comparison found all 24 files in `Callum-Scout-0.10.46-unpacked` identical to the corresponding current source files. This proves the prepared folder, not which folder Chrome is executing.

## Reproduction

- Historical production events reproduce the repeated connection-state failure and lead consumption. Existing VM tests reproduce that queue behavior under injected failures.
- A new read-only production query at 10:40 UTC on 25 September found no Rymaelie assignment events after 05:05:10 UTC, and zero `connection_inspection_failed` diagnostic events in total. Thus there is still no fresh run from a diagnostic-capable client to analyze; the historical account-level cause remains unknown.
- On the live Karen Er page in the attached **different** account, LinkedIn visibly showed a direct `Invite Karen Er to connect` link and a More button. The More menu contained profile actions but no second Connect entry. No invitation dialog was submitted and no connection request was sent.
- After the owner's load confirmation, the same page was reloaded and the More menu checked again. The direct `Invite Karen Er to connect` link and single Scout Ready overlay remained visible. This is a read-only page smoke check, not an automated request or proof of active build identity.
- This live page establishes available Connect for the attached account only. It neither reproduces Rymaelie's exact failure nor proves the changed extension classifies this page correctly at runtime.

## Confirmed root cause

**Not established for Rymaelie's account.** The old queue's failure to stop after repeated `CONNECTION_STATE_UNCONFIRMED` errors is confirmed as a harmful control-flow defect. The live page also exposes markup covered by the earlier parser change. Neither observation establishes why Rymaelie's own browser could not confirm Connect.

## Code changes

No new Rymaelie-specific selector change was made in this continuation. The uncommitted v0.10.46 work addresses John's separate comment-storage path; it includes the earlier v0.10.45 Rymaelie changes in the package but does not constitute live verification of them.

## Automated regression tests

| Command | Result | Scope |
| --- | --- | --- |
| `node scripts/test-scout-complaints.mjs` | Pass | Relationship badge, Pending, diagnostic fixtures. |
| `node scripts/test-linkedin-navigation.mjs` | Pass | Simulated two-failure pause, no third claim, navigation safety. |
| `node scripts/test-extension.mjs` | Pass | Extension static/VM checks against current manifest. |
| `node scripts/test-scout-recovery.mjs` | Pass | Comment receipt recovery and new shared-storage test (John path). |
| `node scripts/test-profile-link-review.mjs` | Pass after updating its fixture for the existing backend guard | Queue-selection regressions. |
| `node scripts/test-manual-rejection.mjs` | Pass | Manual rejection invariants. |
| `node --check chrome-extension/content.js` and `node --check chrome-extension/background.js` | Pass | JavaScript syntax. |
| `pnpm exec tsc -b --pretty false`, targeted `pnpm exec oxlint`, `git diff --check` | Pass | Types, lint, whitespace. |

These are supplementary checks, not live acceptance.

## Live post-fix validation

**Not performed.** The owner reports loading the v0.10.46 unpacked directory, but its active version/source could not be established through the permitted browser interface. There was no authorized consenting test recipient configured in the repository, ignored local config, or environment-variable names, and none was provided with the load confirmation. No live run was started; no Pending/Sent state or matching backend `connection_requested` event was produced.

## Negative-path validation

The two-failure extension pause and older-version three-failure backend guard are covered by simulated/read-only checks in the handoff. Neither was exercised in a controlled real browser run here. No production leads were deliberately consumed to test the negative path.

## Browser/extension runtime verification

The attached Chrome integration worked and reached authenticated LinkedIn; the visible account was Antish Choolun. The Callum Scout overlay was present. Browser security denied direct access to `chrome://extensions` and expressly forbade an alternate route to that same outcome, leaving extension ID/version/source unverified. No CDP workaround was used. The source tree and ZIP hash therefore must not be mistaken for the running build.

The owner later requested native Computer Use for that same `chrome://extensions` installation/verification action. A native Computer Use tool is available, but the prior browser-security denial explicitly forbids using an alternate surface to achieve the rejected action. We did not use native UI automation to circumvent it. The owner's statement that the unpacked build was loaded remains unverified independently.

The configured Jev bridge reported provider `openrouter`, model `~typesafe/jev-latest`. One bounded decision/action opened only the profile's More menu (`step_limit`, one decision, one executed action, approximately 7.7 seconds). Codex independently inspected a fresh accessibility tree: More was expanded, the direct Connect link remained visible, and no invitation was sent. Jev made no acceptance decision and received no credentials, cookies, or private messages.

## 25 September production follow-up and extension-tool check

- Rymaelie replied at 11:23:31 UTC that LinkedIn showed no notice and attached a new screenshot. The image shows a real LinkedIn profile for Surendra Singh with **Pending** visible in the top actions. The Scout overlay was at “Checking whether you are already connected,” with the More menu open. This proves an invitation was already pending on that one profile, not that Scout sent a new invitation or that all other profiles have the same state.
- Read-only production events show Surendra was visited/language-checked at 11:13:35 UTC and remained `viewed`; no `connection_requested` event was recorded for Rymaelie. The latest event seen in the 25 September read was that language check. The screenshot does not include a trustworthy capture timestamp, so it does not prove the overlay remained at that exact step for ten minutes.
- The original v0.10.42 report and fresh screenshot are from Rymaelie's browser. Neither confirms that v0.10.45/.46 is installed there. The earlier 400-plus connection-state failures therefore remain an open incident, not a verified fix.
- A dedicated `chrome-devtools-callum` MCP server was added to the local Codex config with `--categoryExtensions`, a separate Callum test Chrome profile, and this repository as filesystem root. The already-installed global package is `chrome-devtools-mcp` v1.10.1; no package installation was needed. `codex mcp list` shows the new server enabled.
- A one-shot stdio MCP check found all four official extension tools: `list_extensions`, `install_extension`, `reload_extension`, and `trigger_extension_action`. It installed the unpacked v0.10.46 folder in its dedicated test browser, returned extension ID `ffdainbndamagcfohjnmjeanmhgeplme`, listed “Callum Scout v0.10.46 Enabled,” reloaded it, and triggered its action successfully. The test client then closed that browser, so this is **not** proof of a persistent installed build or an authenticated LinkedIn run. It also does not identify the build in the owner's attached Chrome or Rymaelie's browser.
- The pre-existing `chrome-devtools-extension` tool is aimed at an unrelated Gild Chrome profile; its `list_extensions` call returned “browser is already running” for that profile. We did not stop or reuse that browser. The new dedicated server will expose its tools to Codex after MCP configuration reload; the current task used a direct, supported MCP stdio client to verify them now.
- No invitation was submitted. The required consenting recipient, Pending/Sent transition caused by this build, and exactly-one backend request are still absent. Final live acceptance remains **not passed**.

## Remaining uncertainty

- Rymaelie's new screenshot confirms Pending on Surendra Singh and no visible LinkedIn notice in that capture, but the action state across the hundreds of other affected profiles and extension-local diagnostics remain unavailable from the attached Antish session.
- The actual installed Callum Scout version/source remains unverified independently, despite the owner's report that v0.10.46 was loaded.
- No consenting test recipient was configured; an irreversible live invitation cannot be authorized by choosing an arbitrary production lead.
- The owner declined to name a consenting recipient and asked the agent to choose one. The goal's explicit test-safety constraint rules out treating a random LinkedIn member or production lead as consent, so no invitation was sent.
- The backend guard was not observed in a fresh Rymaelie run after deployment.

## Final conclusion

**Live acceptance has not passed.** A valid completion claim requires the real updated extension running in an authorized Chrome profile, a designated consenting test recipient, LinkedIn visibly reaching Pending/Sent exactly once, and the corresponding backend state showing exactly one request. Until then the Rymaelie ticket must remain open.
