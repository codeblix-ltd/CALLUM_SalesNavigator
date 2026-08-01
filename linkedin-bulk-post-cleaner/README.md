# LinkedIn Page Post Cleaner

A local Chrome Manifest V3 extension that clicks LinkedIn's visible Page-admin controls to delete posts matching an exact author name or exact LinkedIn profile slug.

## Safety features

- Restricted to `www.linkedin.com/company/<company-id>/admin/page-posts/published`.
- Matches the exact normalized author name **or** exact profile slug.
- Read-only **Scan visible posts** action highlights matches in amber.
- Live deletion requires a checkbox and typing `DELETE`.
- Configurable maximum deletions and randomized delay.
- On-page Pause/Resume/Stop panel remains available after the popup closes.
- A failed card is marked red and skipped rather than retried indefinitely.

## Install

1. Extract the ZIP.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the extracted folder.
5. Open your LinkedIn company Page's **Admin → Posts → Published** screen.
6. Click the extension icon.

## Recommended workflow

1. Confirm the Company ID.
2. Leave the defaults for the supplied author:
   - Name: `Antish Choolun`
   - Profile slug: `antish-software-developer`
3. Click **Scan visible posts** and inspect the amber outlines.
4. Start with a maximum of 5–10 deletions.
5. Verify the result, then increase the batch size gradually.

## Important limitations

- LinkedIn can change its HTML and button labels at any time. If selectors change, the extension will stop or skip cards rather than intentionally using private APIs.
- Keep the LinkedIn tab open and in the same admin route.
- Deletions are permanent and remove engagement/analytics associated with the posts.
- High-volume automated clicking may trigger rate limits or account safeguards. Use conservative batches and delays.
- This project is not affiliated with LinkedIn.
