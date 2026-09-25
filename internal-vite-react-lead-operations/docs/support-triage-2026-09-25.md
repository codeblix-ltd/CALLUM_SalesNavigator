# Callum support inbox triage, 25 September 2026

The live Convex `bugReports` table contained 32 reports at review: 14 active and
18 resolved. Every active report already had a support response except the new
Apple and Rymaelie follow-ups. Those two replies were posted through the
authenticated admin API, read back, and left Investigating with updated private
notes. The email notification is a pointer to the private report; its original
v0.10.36 context is not evidence of Apple's currently installed version.

## New follow-ups

| Report | Current evidence | Action and remaining gate |
| --- | --- | --- |
| Apple `k57936m600ge911qd4qxqm1gc98egs7e` | On 25 Sep, two requests were recorded at 10:52 and 11:14 UTC, followed by repeated failures to confirm connection state across different profiles; the last three were 11:59, 12:01 and 12:02 UTC. The new reply has no screenshot or current version. | Asked Apple to stop repeat automatic runs, send the installed Callum version and top actions on one affected profile in the same Edge account. Do not claim the old writing-service repair covers this failure. The backend three-failure guard's next claim has not been observed in this session. |
| Rymaelie `k574hbmm65kynzcjdevav6h0ns8f3yct` | Her new image shows Pending on Surendra Singh and no LinkedIn notice. That assignment remains viewed, with no recorded new request. The wider run had hundreds of connection-state failures. | Told her not to duplicate Surendra's invitation and to stop the automatic run. Requested installed version and one affected profile that actually shows Connect, with its top actions. The screenshot does not prove the parser fails on Surendra or identify why other profiles failed. |

Neither lead was rejected. Pending is not a bad lead; failures across many
profiles are an account/action-inspection symptom, not proof that each person is
unusable. The older specific Daniel, Manoj and Ameera assignments remain held
for review under their existing documented rules. No unsupported profile link
was guessed, and no public LinkedIn action was sent by support.

## Other active reports

John already received a same-day response and remains Open; the exact local
storage failure in his v0.10.39 installation is unknown. Jenny, Gilbert, Kyle,
Ila, Jen, Erin, Jacoba, Yetunde, Joan, Vinod and Apple's separate page-loading
report already have individual replies and investigation notes. Read-only
activity shows later requests for several of these scouts, but it does not
establish that each original pause is gone or that a newer extension reached
their browser. Jacoba still had page and message-channel failures on 25 Sep.
There was no new scout message on those 11 reports needing a duplicate reply.

## Verified correction and delivery

The local comment-receipt correction originally prepared as v0.10.46 was
reviewed again. Independent review found a real gap: the confirmed-to-synced
wrapper dropped the storage failure classification, so sanitized diagnostics
would not reach support after a public comment. v0.10.47 preserves that
classification and has a focused regression proving the durable receipt stays
confirmed and no second public comment is made. The earlier cross-login
receipt-cap and byte-quota regressions still pass. The backend telemetry action
is present on `hearty-mallard-696`.

Focused recovery, extension, navigation, complaint and profile-link checks,
TypeScript, targeted lint, JavaScript syntax, and `git diff --check` passed.
`Callum-Scout-0.10.47.zip` contains 24 runtime files at the ZIP root, each
verified byte-for-byte against tested source. Archive SHA-256:
`790B807B24AF9E405B3B67398EBD94A53F670EFF5E9C37350C7AF93C30868F04`.

The ZIP is a prepared local package, not a published Chrome Web Store update.
The prior Google developer-account verification blocker and absence of Store
OAuth credentials still prevent confirmed publication. No scout has reported
running v0.10.47, and neither Apple nor Rymaelie has completed an affected
account run with a confirmed Pending/Sent transition and matching backend
event. Keep their reports Investigating; do not label the connection issue
fixed on the strength of tests or a package alone.
