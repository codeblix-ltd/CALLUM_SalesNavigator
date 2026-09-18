# Apple: LinkedIn page failure, 18 September 2026

Report `k57c6xyvd749wvv36bmqc8bndd8emtat`, received 13:41:01 UTC
(17:41 Dubai); Apple used 0.10.37 in Edge 153. The report captured Benedict Koh.

## Confirmed evidence

- The screenshot is Edge's `ERR_CONNECTION_CLOSED` page for LinkedIn. It is
  not a Scout password error or AI-writing error. Its underlying network/server
  cause cannot be determined remotely from this image.
- Production records show 26 profile-open failures on 26 leads between
  13:00:50 and 13:44:23 UTC. Other imported links successfully resolved in the
  same period, so opaque links cannot all be classified as invalid.
- In the built-in browser, Benedict's exact imported URL rendered his correct
  profile but kept the opaque URL in the address bar. Name, Analyst role,
  Optimas Capital Limited and Singapore matched the assigned record.
- That profile's own Contact info link and named Invite link both supplied
  `benedict-koh-43a08439a`. Directly opening this readable URL again showed the
  same profile. No invitation, message, like or comment was sent.
- The extension required opaque URLs to redirect. A fully rendered profile
  retaining its imported URL therefore still timed out. Separately, page
  readiness trusted the browser's completed state without a content heartbeat,
  allowing an error document to be mistaken for a loaded profile.

## Immediate scoped production correction

Only Apple's assignment `0a3c3a4a-7ab3-40ff-90c2-b77e8348cdf2` was changed:
`resolved_linkedin_url` from null to
`https://www.linkedin.com/in/benedict-koh-43a08439a`.
The change was guarded by its known prior value, exact lead name and imported
URL, then read back. An audit event `profile_link_corrected` records the report,
old value and verification basis. Assignment status, historical error, public
actions, quotas and all other leads were left unchanged.

This correction is available to Apple's installed extension when that lead is
retried. It does not repair Edge networking or all other failed links.

## Extension 0.10.39

- Require a content-script response from the actual current/pending URL;
  browser `complete` alone is insufficient.
- Bound heartbeat waits and pause an unreadable page without marking the lead
  failed or progressing through further leads.
- Propagate that pause through daily maintenance, contact checks, profile
  language and personal-note checks, recent-post navigation and the main run,
  preserving the current lead for Resume.
- Resolve unchanged opaque URLs only from the displayed matching profile's
  own Contact info link. Reject mismatched names, off-site/opaque candidates,
  ambiguous links, other heading sections and sidebar/dialog content.
- Navigate to the verified link and require a fresh exact-URL response. Do not
  retry any public action automatically or loosen invitation identity checks.
- No additional browser permissions. Preserve the separate 0.10.38 support
  changes; do not overwrite earlier release ZIPs.

## Verification and limits

`scripts/test-linkedin-navigation.mjs` covers error documents, no receiver,
stalled heartbeat, delayed loading, stale/pending document responses, login and
checkpoint interruptions, safe URL resolution, identity boundaries, and the
actual daily-run catch keeping the lead resumable without failed-status writes.
It also exercises the actual outer note catch and run finalizer, asserting a
paused state with the current lead retained. The resolver's own-card scope was
also checked against Benedict's live DOM.

Passed on the final patch: `pnpm run extension:test`, `pnpm run stability:test`,
`pnpm run support:test`, JavaScript syntax checks and `git diff --check`.
An independent read-only review found no remaining actionable blockers.
The verification skill prompted the review and the regression tests for the
otherwise swallowed language/note/navigation interruptions.

The release ZIP contains 24 runtime files, each hash-checked against source.
Archive SHA-256: `9D9D7B7CC4418D6B4096C255F0EE89B07BBE4F57A5C7DAF72ED4D314B6312E80`.

Apple received a support-thread reply, read back to confirm one saved message.
It explains the browser failure and corrected link, asks her to stop the run
and open the verified profile normally before using **Retry this lead** once,
and requests a follow-up if the browser error persists. It explicitly says
0.10.39 is not installed yet. Report status read back as **Investigating**.

The fix does not claim to restore Apple's browser connection remotely.
End-to-end acceptance on her Edge session and distribution of 0.10.39 through
the Chrome Web Store remain outstanding. Keep the support report Investigating.
