# Scout report review — 15 September 2026

Reviewed all six production reports and all seven attached images. All reports
identify version 0.10.35. The Store, not the legacy self-hosted channel, is used.

| Report | Evidence and finding | Change / remaining verification |
| --- | --- | --- |
| Joan: cancelled | Screenshot says service not ready, not a user cancellation; seven requests already counted. Report context and screenshot disagree about current state. | Bounded AI wait, clearer transient service message and resumable pause in 0.10.36. Underlying historical server fault is not established. |
| Vinod: stopped after 15 requests | Screenshot shows Chieh Wang as 3rd degree but automation says connected. Code scanned broad ancestor text for `1st`/`Connected`, including other people and biography text. | Restrict evidence to target profile action container and degree badge; regression test covers false positive. Live scout confirmation needed. |
| Vinod: no comments | Both images show reposts; one is French. Current rules exclude reposts, non-English, undated and older-than-92-day posts, inspecting only three cards. Production AI jobs have note/language slots but no comment slot for Vinod. | Preserve policy. Persist every engagement skip as `post_engagement_skipped`, separately from failures. Need an eligible original English post to verify any additional discovery/posting problem. |
| Jacoba: not ready | Screenshot is a failed service step after 3/20 requests. Generic client message hides gateway/network/setup distinctions. Other scouts' retained failed jobs show gateway errors around the same period; this does not identify Jacoba's exact historical server error. | Clear service messages and bounded waiting. Keep investigating rather than claiming outage resolved. |
| Jacoba: slow | Repeated 90-second profile waits, 30-second activity waits, language filtering, and a long-duration AI polling path. Screenshot ETA is an estimate, not a countdown or quota. | Stop holding the client at an AI step after two minutes; preserve job for reuse and pause. Do not remove language, identity or daily-limit checks. Other profile loading failures remain to be confirmed on her device. |
| Apple: stuck | Screenshot shows service failure after 16/18 requests; report used Edge. Later activity includes successful comments but does not invalidate the failure. | Same bounded wait / service recovery changes. Root historical gateway exception unavailable. |

## Release and conversations

Version 0.10.36 adds My reports, report statuses and scout replies. Admin replies
are separate from private notes. Owner and active-role checks protect reports and
images; response DTOs omit internal notes. Replies are idempotent, length/rate
limited and capped per report. A scout reply reopens a resolved report.
No production report should be marked resolved merely because a ZIP is built.
Staff replies must describe the relevant cause without infrastructure details and
state that extension changes require the Store update and scout verification.

## Verification

Targeted tests cover connection false positives, bounded client waiting without
duplicate submission, report ownership, private-note exclusion, idempotent replies,
resolved-report reopening, support/capture regressions and existing AI job tests.
Native LinkedIn posting on affected scouts' devices is not simulated proof of a fix.
