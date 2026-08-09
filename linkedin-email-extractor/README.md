# Mailmeteor LinkedIn Queue

A Chrome Manifest V3 extension that:

1. Accepts LinkedIn profile URLs, one per line.
2. Opens each URL in your normal Chrome profile.
3. Waits for LinkedIn redirects such as an opaque `AC...` profile ID to resolve to its public `/in/name-id/` URL.
4. Opens Mailmeteor's LinkedIn Email Finder using the resolved URL.
5. Captures the JSON response from `tools.mailmeteor.com/api/email-finder/linkedin`.
6. Displays results and exports CSV or JSON.

## Install or update

1. Unzip this folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Remove the old version, then click **Load unpacked** and select this folder. You can also replace the old files and click **Reload**.
5. Pin the extension and click its icon.

## Use

1. Paste LinkedIn profile URLs, one per line. Both ordinary profile URLs and opaque redirect URLs are supported.
2. Choose concurrency (maximum 5), stagger, timeout, and whether failed tabs stay open.
3. Click **Start queue**.
4. Each tab first loads LinkedIn, captures the final profile URL, then continues to Mailmeteor automatically.
5. Export the results as CSV or copy JSON. Exports include both the original and resolved LinkedIn URL.

## Important behavior

- You should be signed in to LinkedIn in the same Chrome profile. Otherwise LinkedIn may redirect to a login or auth-wall page instead of the public profile URL.
- Opaque `AC...` inputs are not sent to Mailmeteor until their URL actually changes to a public LinkedIn profile URL.
- Chrome displays a notice that the extension is debugging the browser while the Mailmeteor stage runs. This is expected because response bodies are read through the Chrome Debugger API.
- Do not open DevTools on a processing tab; Chrome will detach the extension debugger from that tab.
- Successful and not-found tabs close automatically. Failed or timed-out tabs stay open when **Keep failed tabs open** is enabled.
- The extension does not call Mailmeteor's API directly, generate or reuse Turnstile tokens, click CAPTCHA challenges, or bypass rate limits.
- Use professional contact data lawfully, honor opt-outs, and respect applicable privacy, anti-spam, and platform rules.

## Permissions

- `tabs`: load LinkedIn URLs, observe their final URL, and navigate to Mailmeteor.
- `debugger`: read the target Mailmeteor API response body through Chrome DevTools Protocol.
- `storage`: retain queue progress and results locally.
- Host access is limited to LinkedIn, Mailmeteor, and Mailmeteor's tools host.

No data is sent anywhere by the extension itself. Results remain in Chrome extension local storage until cleared.

## Version 1.1.0

- Adds LinkedIn redirect resolution before the Mailmeteor step.
- Supports opaque profile links such as `linkedin.com/in/AC...`.
- Displays and exports the resolved LinkedIn profile URL.
- Retains the v1.0.1 POST-only response capture and response-body retry fix.
