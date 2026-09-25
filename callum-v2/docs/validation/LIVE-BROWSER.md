# Live browser evidence

Environment: isolated MCP Chrome for the actual V2 extension; separately, an already authenticated user Chrome session observed read only. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

- MCP V2 extension shadow run `f1c916fa-7092-4aa9-8eb3-59db7090e41f` claimed `INSPECT_PROFILE`, navigated LinkedIn, and ACKed `PROFILE_MISMATCH` after an authwall redirect. The server recorded `run_started`, `observation_completed`, `browser_failure` and paused the lead. No invitation/comment was sent.
- Final packaged build `4b4a5b8501d8` repeated that safe path in run `5ad02216-a189-474f-9456-bce332a0a271`; it loaded dev config `6` and recorded a completed command with `PROFILE_MISMATCH`. The isolated browser still redirected to the authwall.
- Packaged 2.1.0 build `0c647e29c017` processed read-only comment-state command `0cd87c16-d37c-4af2-a815-3955ca737667` in run `a9086837-853e-4129-8d95-05bfb1d668a9`. Config 10 reached the running extension; authwall caused `PROFILE_MISMATCH`, and no post data or action was recorded.
- Packaged 2.2.0 build `25cf3adfcbc6` processed read-only invitation-manager command `1c655cf6-ea92-4faf-8357-f9e5cb53aa1b` in run `fe2814e0-e619-4575-9870-4a9bd20c5bd8`. Config 11 reached the running extension; authwall caused `PROFILE_MISMATCH`, invitation eligibility was false, and no withdrawal or other action occurred.
- Packaged 2.3.0 build `7a1e5a3dd88c` processed read-only invitation-manager command `372c60ad-7c05-4d00-a922-5c82052bc0aa` in run `45885c19-0995-4945-ad4f-78a18f04f769`. Config 15 reached the running extension; authwall again caused `PROFILE_MISMATCH`. The new withdrawal command was not queued or exercised on LinkedIn.
- In an authenticated Chrome account, read-only inspection of the account's own profile showed the current H2/section top-card structure, with More but no Connect. That finding updated V2's selector candidates and identity-scoped adapter. A second profile navigation was attempted, but the browser inspection timed out; no result is claimed.
- The authenticated Chrome session did not have the MCP-installed V2 extension; the MCP session was unauthenticated. Therefore the required *authenticated V2 extension* observation gate has **not passed**.
- Repository and local configuration search found no designated consenting QA recipient. Live action was not attempted. An arbitrary lead is not consent.

This record intentionally contains no cookies, tokens, screenshots, page HTML, private messages, or contact details.
