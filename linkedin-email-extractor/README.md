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
2. Load pending/retryable leads directly from the database (the primary
   option), or switch to pasted LinkedIn profile URLs when needed.
3. Start the queue. Opaque LinkedIn `AC...` URLs are resolved before they are
   sent to Mailmeteor.
4. Found and not-found results are written to the database before the local row
   is marked complete. A pasted URL that is not present in the database remains
   visible as **Not in database**.
5. Database runs load 100 leads by default. The live run-time counter shows the
   minutes or hours for the exact number of leads loaded, then freezes when the
   queue finishes.

## Parallel runs, retries, and stop guarantees

- Up to four leads can be active, with four selected by default.
- Processing tabs open in their own unfocused Chrome window, so the extension
  does not take over the window and tab you are actively using.
- Each LinkedIn resolution and Mailmeteor request has a five-minute default
  timeout.
- An HTTP 429 rate limit rings an alert and retries the same lead once after
  exactly three minutes. If that retry fails for any reason, the alert rings
  again and the queue pauses without launching more leads.
- Timeouts, temporary network failures, and HTTP 5xx responses retry the same
  lead after 15, 30, and 60 seconds. No new lead starts during queue-wide
  backoff.
- When all three automatic retries are exhausted, or a non-temporary error or
  database-save failure occurs, the queue pauses at that lead. Already active
  tabs may finish, but no additional lead is launched.
- **Resume from error** retries the failed row first, then continues with rows
  that were never started.
- Queue state is kept in Chrome local storage. If the extension service worker
  restarts during a lead, that lead is marked interrupted and the queue pauses
  instead of silently moving on.
- Mailmeteor `not found` is a completed result, not an error, so the queue may
  continue to the next lead.
- When every queued lead is complete, the processing window closes and the
  extension plays a short completion chime.

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
- `alarms`: wake the queue for the exact three-minute rate-limit retry.
- `offscreen`: play completion and rate-limit alert sounds.
- `storage`: retain authentication and resumable queue state.
- Host access is limited to LinkedIn, Mailmeteor, the Mailmeteor tools host, and
  the configured Convex deployment.

## Version 2.2.0

- Makes pending database leads the primary queue source.
- Uses a separate background Chrome window for all processing tabs.
- Plays a completion chime after the full queue finishes.
- Rings a separate alert on HTTP 429, retries once after three minutes, and
  pauses with another alert if that retry fails.
- Sets the default per-URL timeout to five minutes.
- Loads 100 database leads by default and shows the exact run time for that
  lead count.
- Removes sample placeholder URLs from the pasted-link field.

## Version 2.1.0

- Adds authenticated CockroachDB persistence through Convex.
- Adds pasted-link and database-queue sources.
- Stores company addresses as `work_email` without overwriting
  `original_email`.
- Adds bounded rate-limit retries, four-way parallel processing, strict
  stop-on-error behavior, and same-row resume.
