# Scout backlog closeout and shared pause correction — 21 September 2026

## Outcome

Reviewed all 24 reports: 22 Investigating, 2 previously resolved test reports.
Closed 16 scoped historical incidents/examples after individual evidence review.
Six active cases remain. All 22 replies/statuses were written through the admin
API and read back; final counts at 07:23:02 UTC: **18 resolved, 6 investigating**.
No reports or history were deleted. A scout reply reopens a resolved ticket.

Closures mean the documented earlier service recovered, a specific old check
was repaired, or supplied examples were explained. They do not mean every scout
workflow or later incident is fixed. No scout recovery confirmation was invented.

## Closed reports

| Scout | Report IDs | Scope and evidence |
| --- | --- | --- |
| Micol | `k577a3kmma41mqqbpsv0pfh89x8ek449` | Matched language-job/gateway timeout repaired; Sep21: 14 engagements, 20 requests. |
| Risheil | `k571m5q1th9c6ys4q61qz3wdsx8ejqw3`, `k57a1h754qtadzftr6x7yxtdwx8efgqc`, `k572649vhskm1dm2aej1sb2gv58efrhv` | Earlier writing/note stalls recovered; completed retained note/comment jobs; Sep18: 10 engagements, 20 requests. No claim Hessa/Gerardo individually retried. |
| Vinod | `k577be5376wzfee79b4wcfc0bh8egjms` | Language service recovered; Sep18: 21 language checks, 20 requests. Recipient issue separate. |
| Yetunde | `k579b47xxkjvwc28e614mppjps8egstp` | Earlier comment-service failure recovered; Sep18: 7 engagements, 20 requests. |
| Apple | `k57936m600ge911qd4qxqm1gc98egs7e`, `k57efkw6hpn803aj7053nrr5j58ecs7r` | Earlier service incidents recovered; inspected Sep18–21 window: 27 engagements, 47 requests. New navigation failures remain active. |
| Erica | `k57aa0kf8xqa1j33aavf4vpygh8egzt6` | Writing-service pause recovered; Sep18–20: 41 engagements, 60 requests. |
| Jen | `k57480vzsrpbmhnwh1mjca1j2d8eg7vz` | Earlier service-dependent flow recovered; completed retained writing jobs, successful language checks, Sep21: 20 requests. Original exception unavailable; latest access warning remains separate. |
| Romart | `k579537tsw6280j81e3qn1v9cn8efr0d`, `k57f47hyb4e1mqd764zja0h1rh8eeysa` | Historical service interruption recovered; Sep18: 9 engagements, 20 requests. Original interrupted-lead replay not observed. |
| Jacoba | `k577j5z4x4r614m1p54fjrggdx8efw8q`, `k57b8e744ygjz3nak8ww1gv3xx8edh4f` | Historical service interruptions recovered; Sep18: 9 engagements, 20 requests. Later broad slowdown remains active, including transient busy/page errors. |
| Vinod | `k576b8x2bse4xhgg364tqygh958echkn` | False-connected check corrected in .36; installed .36 evidenced by later report and subsequent 20 requests. Not proof original affected person retried. |
| Vinod | `k578zrrptbsnxtgbpetzsn917s8ecnb0` | Supplied screenshots are excluded repost/non-English examples. Closed as explained behavior, not a claim commenting is repaired. Eligible failing example can reopen this report. |

The deployed shared-service repair is documented in `scout-stability-2026-09-17.md`.
Fresh gateway check today returned that release, no queued/active requests or
cleanup failures, and a real diagnostic English draft in **4.612 seconds**.
No public LinkedIn action was taken. Diagnostics also retained 7 service failures
alongside 4,652 completed requests: this is not evidence of zero future outages.
Retained job expiry fields were not interpreted as completion timestamps.

## Active cases and closure gates

Owner for each: **Callum support**. The same next steps are saved in each private
admin note and explained in a nontechnical staff reply.

| Scout / report | Next action | Closure gate |
| --- | --- | --- |
| Jen `k576s8bhgnzvm30pvwpfc36c7n8ev66y` | Distribute reviewed .40 correction; inspect actual access-page evidence if warning returns. | Confirm corrected installed version and supported run without false warning, or establish actual access prompt. Her historical trigger remains unproved. |
| Apple `k57c6xyvd749wvv36bmqc8bndd8emtat` | Capture current failing URL and compare same-browser normal tab. | Affected page/run proceeds. Eleven unreadable-page pauses through Sep21 06:15 UTC prevent a blanket closure. |
| Vinod `k577knx5mszjq4x3wtyt7zmve98ekv21` | Obtain affected unsent invitation dialog; fix recipient extraction without weakening identity guard. | Correct recipient confirmed on affected layout, no duplicate/wrong-person request. |
| Joan `k57e0v41vb05jc7savnmd0rx0n8eecsj` | Obtain installed version and post-repair run result. | Verified recovery or reproducible remaining failure. No post-repair flow in current evidence. |
| Yetunde `k5790978jznp29xv8zbveqaf4d8ee8rf` | Confirm whether original long stall recurs; capture page/time if it does. | Recovered affected workflow or reproduced/repaired stall. Closed-tab snapshot does not explain original delay. |
| Jacoba `k57evc20j0ra19dsg418yc3mgs8edx1v` | Diagnose shared page-read/closed-channel delays using exact affected page. | Measured representative run without repeated stalls; 20 requests over two hours is not sufficient. |

## Shared correction, extension 0.10.40

- Classify access prompts by actual LinkedIn path, not the word `login` in
  profile slugs, query strings or fragments.
- Ignore stale sign-in heartbeat responses and re-read the current tab after
  waiting, including opaque-profile resolution. Never navigate away from a real
  authwall/checkpoint using an old response.
- Retain access/service pause kind, original page/expected URL, stage and time
  before tab cleanup. Include these in new reports even if the failed tab closed.
- Strip credentials, query parameters and fragments; restrict new diagnostic
  URLs to HTTPS LinkedIn, client-side and backend-side.
- Optional backend fields preserve older reports/clients. Starting/resuming a
  run clears old pause data. Existing genuine login/security pauses remain.
- Report page directs repeat issues to existing conversations; replies reopen
  resolved reports. Different issues can still be reported separately.

## Verification and delivery boundaries

Passed: extension, navigation/false-positive races, support/report privacy,
capture, update notices, AI resume, receipt recovery, worker lifecycle, usage
tests; TypeScript; syntax checks. Independent read-only review approved the
scoped correction after identifying an additional resolver race that was fixed
and tested. The audit/verification skills directed the independent closure
review, regression tests, evidence boundaries and post-action read-back.

Convex push succeeded against the configured live deployment
`hearty-mallard-696`. A live unauthorized request with the new optional fields
passed argument validation and was blocked at authentication before writes or
notifications. Backend handler sanitization was tested locally with test doubles.

The .40 browser correction still requires Chrome Web Store submission/approval
and distribution. No installation, approval date, Jen-specific cure, or universal
all-clear is claimed. Do not close the six active cases merely because a ZIP exists.

Store archive: `Callum-Scout-0.10.40.zip`, 24 runtime files, each checked against
source. SHA-256: `8CDF07135673C1F9F11837DABD7E7D8C6128F2CCBB37FF3AFB1A66C65701F63F`.
