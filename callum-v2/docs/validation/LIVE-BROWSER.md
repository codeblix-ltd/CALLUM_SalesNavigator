# Live browser evidence

Environment: isolated MCP Chrome for the actual V2 extension; separately, an already authenticated user Chrome session observed read only. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

- MCP V2 extension shadow run `f1c916fa-7092-4aa9-8eb3-59db7090e41f` claimed `INSPECT_PROFILE`, navigated LinkedIn, and ACKed `PROFILE_MISMATCH` after an authwall redirect. The server recorded `run_started`, `observation_completed`, `browser_failure` and paused the lead. No invitation/comment was sent.
- Final packaged build `4b4a5b8501d8` repeated that safe path in run `5ad02216-a189-474f-9456-bce332a0a271`; it loaded dev config `6` and recorded a completed command with `PROFILE_MISMATCH`. The isolated browser still redirected to the authwall.
- In an authenticated Chrome account, read-only inspection of the account's own profile showed the current H2/section top-card structure, with More but no Connect. That finding updated V2's selector candidates and identity-scoped adapter. A second profile navigation was attempted, but the browser inspection timed out; no result is claimed.
- The authenticated Chrome session did not have the MCP-installed V2 extension; the MCP session was unauthenticated. Therefore the required *authenticated V2 extension* observation gate has **not passed**.
- Repository and local configuration search found no designated consenting QA recipient. Live action was not attempted. An arbitrary lead is not consent.

This record intentionally contains no cookies, tokens, screenshots, page HTML, private messages, or contact details.
