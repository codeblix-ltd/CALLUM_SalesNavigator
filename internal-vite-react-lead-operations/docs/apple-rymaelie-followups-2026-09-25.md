# Apple and Rymaelie production follow-ups, 25 September 2026

This is an evidence record, not a claim that either scout's run is fixed. All timestamps below are UTC.

## Apple

- Apple replied to the older report `k57936m600ge911qd4qxqm1gc98egs7e` at 11:32:40. The reply says restarting/stopping still does not allow lead connections to proceed. There was **no new screenshot or fresh extension context** in the reply. The report's v0.10.36 writing-service context belongs to the original 16 September report and must not be treated as Apple's current version or cause.
- Read-only Cockroach activity for 25 September through approximately 12:23 shows 18 profile visits, 2 recorded connection requests (10:52 and 11:14), and 13 failures with the exact message “The connection state could not be confirmed. Nothing was sent for this lead.” Two other failures said the protected automation tab could not be marked. Thus “nothing works” would be inaccurate, but the new complaint is supported by repeated current failures.
- The last three connection-state failures were at 11:59:09, 12:01:13, and 12:02:53. The existing 15-minute backend circuit breaker should stop the **next** automatic claim after those three. We have not observed that next claim, so we cannot assert that the guard tripped in Apple's session.
- No `connection_inspection_failed` diagnostic event appeared in the fresh Apple/Rymaelie event read. That is consistent with an older Scout build, but not proof of either scout's currently installed version because diagnostic delivery itself might fail.
- This is not enough to prove a LinkedIn account problem, a single bad lead, the old writing-service fault, or current extension version. The ticket should remain open. A fresh report reply with the current overlay screenshot and version would distinguish the current stage; do not advise endless Resume attempts.

## Rymaelie

- Rymaelie replied to `k574hbmm65kynzcjdevav6h0ns8f3yct` at 11:23:31, saying LinkedIn showed no notice, and attached a new screenshot. It shows the Surendra Singh LinkedIn profile with **Pending** already visible and Scout still showing “Checking whether you are already connected.” This establishes one already-pending invitation, not a newly sent one.
- Read-only Cockroach activity shows Surendra's profile visit/language check at 11:13:35; that assignment remained `viewed`, with no `connection_requested` event. Across the preceding two days the account had 484 visits and 472 failures but zero recorded connection requests. The historical issue remains real; the exact on-page cause on the hundreds of other profiles is not proven by the one screenshot.
- The original report shows v0.10.42. The follow-up screenshot does not independently prove a newer extension version. v0.10.46 was loaded and lifecycle-tested only in a separate, unauthenticated Chrome DevTools MCP test browser, not in Rymaelie's session. Do not tell Rymaelie to retry on the assumption that she has the fix.

## Follow-up status

The dedicated extension MCP is configured and its four lifecycle tools were verified against v0.10.46, but no authenticated end-to-end LinkedIn request was sent. Neither scout report was closed or answered with a fix claim. To validate the connection-action repair, inspect one fresh affected profile in the scout's own account or a controlled authenticated test account, capture the extension's actual version and sanitized diagnostics, and compare the page action state with the corresponding backend event. An invitation test still requires a designated consenting recipient.
