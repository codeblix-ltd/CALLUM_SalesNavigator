# Security review

Environment: source review and local tests. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

| Control | Evidence | Remaining limit |
| --- | --- | --- |
| Secret boundary | DB URL and admin token read only by Node server; package script scans every extension JS file; final `dist/` credential-pattern scan passed | Pattern scan cannot prove absence of every possible secret |
| Scoped auth | Installation token stored as SHA-256 hash, tied to one operator, revocable; claim and action authorization now re-read installation revocation and operator enablement after token lookup. Cross-operator claim/ACK/authorization and stale-token revocation Cockroach tests pass | V2 admin bearer token is shared; managed staff identity is needed before rollout |
| Action replay | Unique action target, command idempotency, one-time authorization, expiry, lease uncertainty, reconciliation | Live click race and multi-host concurrency need browser acceptance |
| Remote config | Strict allowlist and bounds for the new viewer-menu and post-detail selectors; no eval/remote JS. Isolated adapter 6 saw temporary config 28 without reload; dev was restored to 27 | Selector effectiveness through an authenticated running extension still needs proof |
| Privacy | Post inspection returns at most five validated LinkedIn URLs and no post text; contact email is accepted only from an observed, identity-matched live canary target and is hidden in admin overview | Contact-email retention and staff access policy still need approval; authenticated UI behavior is unverified |
| Browser permissions | `alarms`, `storage`, `tabs`, exact LinkedIn and V2 API/local host permissions | Final host should be audited after DNS/backend provisioning |

Web UI inserts server data through `textContent`, not HTML. Admin token remains in page memory. CSP and exact staging origin controls are present. This is a source-level review, not penetration testing.

The 2.5 extension build scan found no DB URL, admin token, private key marker, `eval`, or `new Function` in packaged JS. The reviewed action target is an exact normalized LinkedIn post URL equal to its command payload; profile and post author identity are checked again in the content primitive. Read-only browser research returned selector counts and profile keys only, with no page content stored in V2 facts. No authenticated submit behavior or managed admin access has been validated.
