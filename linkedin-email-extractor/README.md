# Callum Work Email Finder

A Chrome Manifest V3 extension that finds company work email addresses with
Mailmeteor and saves matched results to the Callum Leads CockroachDB database
through authenticated Convex actions.

The lead record now has two explicit email fields:

- `original_email`: the address exposed by the person's LinkedIn contact info
  (the email used for their LinkedIn account).
- `work_email`: the company-domain address returned by Mailmeteor.

## Install or update

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder, or click **Reload** on an
   existing installation.
4. Pin **Callum Work Email Finder**.

## Use

1. Sign in with the Callum Leads administrator account. Authentication is
   required for both sources so matched results can be saved.
2. Choose one source:
   - paste LinkedIn profile URLs, one per line; or
   - load pending/retryable leads directly from the database.
3. Start the queue. Opaque LinkedIn `AC...` URLs are resolved before they are
   sent to Mailmeteor.
4. Found and not-found results are written to the database before the local row
   is marked complete. A pasted URL that is not present in the database remains
   visible as **Not in database**.

## Stop and error guarantees

- Processing is intentionally sequential: only one lead can be active.
- Any extraction error, network failure, timeout, HTTP error, rate limit, or
  database-save failure pauses the queue immediately.
- No later lead starts after a failure is detected.
- **Resume from error** retries the failed row first, then continues with rows
  that were never started.
- Queue state is kept in Chrome local storage. If the extension service worker
  restarts during a lead, that lead is marked interrupted and the queue pauses
  instead of silently moving on.
- Mailmeteor `not found` is a completed result, not an error, so the queue may
  continue to the next lead.

## Important behavior

- Stay signed in to LinkedIn in the same Chrome profile.
- Chrome shows a debugging notice while Mailmeteor is open because the
  extension reads the public tool's response through Chrome's Debugger API.
- Do not open DevTools on a processing tab; that detaches the extension.
- The extension does not call Mailmeteor's API directly, generate or reuse
  Turnstile tokens, solve CAPTCHAs, or bypass rate limits.
- Use professional contact data lawfully, honor opt-outs, and respect applicable
  privacy, anti-spam, and platform rules.

## Permissions

- `tabs`: resolve LinkedIn URLs and open Mailmeteor.
- `debugger`: capture the Mailmeteor email-finder response.
- `storage`: retain authentication and resumable queue state.
- Host access is limited to LinkedIn, Mailmeteor, the Mailmeteor tools host, and
  the configured Convex deployment.

## Version 2.0.0

- Adds authenticated CockroachDB persistence through Convex.
- Adds pasted-link and database-queue sources.
- Stores company addresses as `work_email` without overwriting
  `original_email`.
- Adds strict stop-on-error/rate-limit behavior and same-row resume.
