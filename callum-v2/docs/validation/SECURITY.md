# Security review

Environment: source review and local tests. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

| Control | Evidence | Remaining limit |
| --- | --- | --- |
| Secret boundary | DB URL and admin token read only by Node server; package script scans every extension JS file; final `dist/` credential-pattern scan passed | Pattern scan cannot prove absence of every possible secret |
| Scoped auth | Installation token stored as SHA-256 hash, tied to one operator, revocable; claim/ACK/authorize check ownership | V2 admin bearer token is shared; managed staff identity is needed before rollout |
| Action replay | Unique action target, command idempotency, one-time authorization, expiry, lease uncertainty, reconciliation | Live click race and multi-host concurrency need browser acceptance |
| Remote config | Strict allowlist and bounds; no eval/remote JS | Selector effectiveness on authenticated LinkedIn still needs proof |
| Privacy | Structured facts only; no arbitrary HTML, cookies, messages, or unrelated tabs in DB events | Public lead/profile metadata still needs retention/access policy before production |
| Browser permissions | `alarms`, `storage`, `tabs`, exact LinkedIn and V2 API/local host permissions | Final host should be audited after DNS/backend provisioning |

Web UI inserts server data through `textContent`, not HTML. Admin token remains in page memory. CSP and exact staging origin controls are present. This is a source-level review, not penetration testing.
