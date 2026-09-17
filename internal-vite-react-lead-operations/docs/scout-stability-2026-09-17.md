# Scout stability incident — 17 September 2026

## Evidence

Reviewed 13 new production reports and all 10 attached images. Reports use both
0.10.35 and 0.10.36. These are genuine failures, not disproved by later successes.

| Scout / report | Finding |
| --- | --- |
| Micol, Sep 17 | Screenshot: zero progress, generic service failure. Retained language job failed at 02:23:37 UTC, matching a gateway `account/read` timeout. |
| Risheil, Sep 17 | Writing-service pause. Comment job failed at 02:10:54 UTC, matching a gateway `account/read` timeout; later retries also failed. |
| Vinod, Sep 16 | Screenshot stalls after profile text extraction, waiting for language classification. Retained language job failed. |
| Yetunde, Sep 16 | Comment job failed. Activity records at 18:11 UTC show writing-service failure; this is not merely a repost-policy exclusion. |
| Apple, Sep 16 | Repeated writing-service errors, including a long sequence from 14:04–14:47 UTC; comment and note jobs failed. |
| Erica, Sep 16 | Screenshot explicitly shows writing-service pause; retained language job failed. |
| Jen, Sep 16 | Report context says generic service failure. Later jobs succeeded; original individual error was overwritten, so exact cause cannot be reconstructed. |
| Risheil, Sep 16 | Screenshot waiting on personal note for Hessa Alassaf. |
| Yetunde, Sep 15 | Context says automation tab closed while pausing. No image; do not infer that closure caused the original 10-minute stall. |
| Jacoba, Sep 15 | Generic service failure after 10 requests / 29 checked. Original individual gateway trace no longer retained. |
| Risheil, Sep 15 | Screenshot waiting on personal note for Gerardo Concilio. |
| Romart, Sep 15, later report | Generic service failure after 13 requests / 18 checked. |
| Romart, Sep 15, earlier report | One comment succeeded; the next writing step failed. Requires partial-progress recovery, not restarting all comments. |

Gateway source hashes matched repository HEAD before editing. Codex CLI is
0.153.4. The single gateway Codex child had ~5.9 million KiB RSS (container
~5.5 GiB), repeated unnecessary Apps MCP transport failures and account/draft
timeouts. A real short draft before changes succeeded only after 81.2 seconds.

## Changes

- Disable unused Apps/plugin integration in the gateway worker, keep auth,
  model, read-only sandbox, and shared consumer behavior.
- Unsubscribe temporary sessions after success and failure; periodically
  recycle the idle worker after 64 session attempts. Stop admitting fresh work
  while draining instead of allowing sessions to grow indefinitely.
- Scout gateway execution has an aggregate 85-second budget and bounded queue;
  pass the reservation deadline through all layers. Backend reservation 110s,
  gateway HTTP cap 95s, browser poll cap 120s.
- Resume waits for an earlier AI stage to settle; never treat its result as
  another stage's answer. Keep one active job per scout.
- Service failures during notes/comments are not silently converted into
  skipped comments or a negative language decision.
- Persist a per-scout, per-lead submission intent before clicking Comment.
  Save confirmed submissions without posting again; continue remaining
  comments after a partial success. Never auto-repeat an uncertain submission.
- Preserve identity checks, language/repost/date policy, daily limits and
  authentication boundaries. No automatic LinkedIn actions were performed
  during support testing.
- Correlatable server errors and protected operational diagnostics. Preserve
  the existing shared `/v1/status` contract.

## Verification boundaries

Targeted tests execute worker lifecycle, 64-session recycling, saturated queue,
total deadlines, earlier-stage resume, auth isolation, save-after-public-post
failure, partial comments, and uncertain-submit behavior. Actual scout-browser
acceptance is still required. Never mark a report resolved merely because code
or an extension ZIP was shipped.

The main service repair is server-side and benefits existing versions. Local
comment checkpoints and improved resume handling require Store version 0.10.37.

## Deployment and measured results

- Live Convex backend pushed successfully on 17 September 2026.
- Gateway deployed in place with its existing login/data volume preserved.
  Only the gateway container was replaced, after its queue drained.
- New gateway image: `503bfc69b7559322b0af495e5de2c4dd92623fd72bfbc7bc2c1fda905b5407f5`.
  Previous image retained locally for rollback; canonical Compose build sources
  also updated and verified against tested local SHA-256 hashes.
- Eight live synthetic generation checks passed: three writing requests, one AI
  French-language classification, and four concurrent writing requests. No
  public LinkedIn comment or connection request was sent by these tests.
- Sequential writing took 6.844s, 4.508s and 5.100s; language check took 4.621s.
  Four concurrent drafts took 5.817s, 6.060s, 5.958s and 4.640s.
- Repeating the same request returned the same cached draft in 1.239s without
  another generation. Final diagnostics: zero queued/active requests, zero
  active session subscriptions, zero cleanup failures and eight successes.
- Container memory after these checks was approximately 101 MiB, versus
  approximately 5.5 GiB before repair. This is a short before/after sample, not
  proof of long-term stability. The 64-session recycle boundary was exercised
  in isolated regression tests, not a 64-generation production stress test.
- Regression groups passed: AI resume/watchdog, per-scout receipt isolation,
  safe comment recovery, gateway lifecycle, backend jobs/usage, extension,
  earlier scout complaints, support replies, screenshots and update notices.
  TypeScript checks also passed. No unrelated full local frontend rebuild was
  needed; deployment CI performs the final app build on main.

Individual nontechnical reply text is recorded in
`scout-support-replies-2026-09-17.json`. Reports stay Investigating pending scout
confirmation. Extension 0.10.37 must still be published through the Chrome Web
Store; no self-hosted update feed is used or advertised.

All 13 replies and Investigating statuses were written and read back from the
live admin API. No newer reports were present at that read-back. The admin
gateway-status action also returned connected with zero queued requests.

Chrome Web Store archive: `Callum-Scout-0.10.37.zip`, 24 runtime files at the ZIP
root, each verified byte-for-byte against tested source. SHA-256:
`d57c712669e11608a19c03413f2004783749b5ae4d07ae4f21db20394d4ce500`.
No Store publishing connector or credentials were found in the project's
configured environment, so the ZIP is prepared for the owner's normal Store
submission process, not represented as an already distributed release.

## Acceptance gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Review each supplied report and attachment | Pass | 13 report records, 10 images, findings above |
| Worker cleanup, bounded waits and account isolation | Pass | `pnpm run stability:test`, TypeScript check |
| Existing extension, support, capture and update behavior | Pass | `pnpm run extension:test`, `pnpm run support:test` |
| Production service repair | Pass | Matching deployed hashes, eight real generation checks, admin status |
| Individual staff communication | Pass | All 13 replies and statuses read back from production |
| Store-ready extension artifact | Pass | ZIP manifest 0.10.37, file hashes and runtime-only packaging |
| Store rollout and affected scout end-to-end acceptance | Pending | Owner Store submission and scout confirmation still required |

Official lifecycle reference: https://developers.openai.com/codex/app-server
Configuration reference: https://developers.openai.com/codex/config-reference
