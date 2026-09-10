# Bug reporting — extension 0.10.31

## Version visibility and live update notice — 0.10.34

The popup displays the installed version in a badge, including before sign-in.
Chrome's native update event stores the available version; the popup now updates
the notice immediately when that storage changes. Equal, older and invalid values
are hidden, and a stale initial read cannot overwrite a fresh update event.
The notice asks scouts to finish their work before restarting Chrome. There is no
forced reload or repeated polling. Chrome controls update discovery; a package
awaiting Store review will not trigger the notice.

Production distribution is the Chrome Web Store listing with ID
`oknfiljbgnjflmbkddeojnbmngkafffc`. The self-hosted files below describe a legacy
channel that the user confirms their scouts do not use. Submit the latest ZIP to
the existing Store listing; a GitHub push is not a Store publication.

Verification: `node scripts/test-extension-updates.mjs` checks installed versions,
stored/live notices, version comparisons, storage failures and read/event races.

## Return to report after capture — 0.10.33

After capturing and stopping screen sharing, the extension activates the report
tab and focuses its Chrome window so the scout can immediately review the image
and add a comment. Cancelled/failed captures do not move focus. A denied focus
request never loses the screenshot. Covered by `pnpm support:test` (correct tab
and window, capture-before-focus ordering, cancellation, and focus failure).

## Capture timeout hotfix — 0.10.32

The initial capture used a detached video and awaited `play()` followed by a compositor frame callback. The report page may be backgrounded when the picker focuses the selected tab, leaving that callback pending even though sharing has started. Capture now prefers `ImageCapture.grabFrame()` directly from the selected display track. The fallback reads decoded frame data without awaiting playback completion or a compositor callback. Video, bitmap and timers are cleaned up, and the caller stops sharing on every exit path.

Verified with `pnpm support:test`, extension regression checks, and real Chromium canvas-stream pixel tests for both direct capture and the video fallback at `/capture-test.html` in `scripts/preview-support.mjs`. Native screen-picker testing on the affected user's Chrome installation is still a separate rollout check. This hotfix requires updating/reloading the extension to 0.10.32 and reopening the report tab; it is not a backend change.

Scouts: open the extension → Report bug → choose the affected screen → preview → describe the issue → Send report. They may instead attach/paste up to three images or send text only. Native capture uses Chrome's screen chooser and stops after one frame. Capture requires a user click and may be unavailable under OS/browser policies; image attachment is the fallback.

Admins: open the lead dashboard → Bug reports. Filter open/investigating/resolved reports, inspect screenshots and diagnostic context, and save internal notes. The scout's issue time and the server receipt time are separate. Report identity comes from the authenticated user, not client input. Screenshot URLs must not be forwarded outside the support team.

Signed-out scouts can sign in on the report screen without losing their draft. For login failures, Save a copy produces a JSON file containing text, diagnostics and base64 images to share with their manager. This does not automatically create an inbox report. Drafts remain in memory; keep the tab open until confirmation.

## Distribution

Backend/admin deployment alone cannot add the extension button. Publish the 0.10.31 ZIP in the Chrome Web Store and wait for review, or distribute it using the existing managed installation process. Update the Store privacy disclosures to include voluntarily supplied support comments, screenshots, and diagnostic context; the public privacy page documents these now. No new manifest permissions were added.

The version label reads the installed manifest. “New version available” appears only after Chrome emits `runtime.onUpdateAvailable` for the installation's configured update channel. No forced reload interrupts automation. Unpacked installations have no automatic Store update signal and must be updated manually. Packaging a ZIP is not Store publication and does not update the separate self-hosted release server.

## Verification

- `pnpm support:test`: real handlers with auth/storage/database doubles; validation, duplicate handling, failed-upload cleanup, non-admin denial; real report script with DOM/browser doubles for context privacy, cancelled capture, invalid frame and submission.
- `pnpm extension:test`: existing extension regression checks.
- `pnpm check` and `pnpm build`: typecheck/lint/build (one pre-existing unused-variable warning in delete-niche.mjs).
- Live deployed anonymous report submission/list probes rejected correctly.
- Codex browser isolated preview: attach image, preview, remove, submit and confirmation tested. No production report or LinkedIn action was created. Native capture was denied by the in-app browser; actual installed Chrome chooser, authenticated submission-to-inbox and Store update delivery remain rollout checks.
