# Security review

Environment: source review and local tests. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

| Control | Evidence | Remaining limit |
| --- | --- | --- |
| Secret boundary | DB URL and admin token read only by Node server; package script scans every extension JS file; final `dist/` credential-pattern scan passed | Pattern scan cannot prove absence of every possible secret |
| Scoped auth | Installation token stored as SHA-256 hash, tied to one operator, revocable; claim and action authorization re-read installation revocation and operator enablement after token lookup. Live canary run creation requires an enabled installation owned by the run operator (`2c8de40`). Final authorization for all irreversible actions also rechecks live-canary mode, exact configured QA profile key, and the run's installation. A focused Connect regression and six affected Cockroach integration files passed sequentially on 2026-09-26 | V2 admin bearer token is shared; managed staff identity is needed before rollout |
| Action replay | Unique action target, command idempotency, one-time authorization, expiry, lease uncertainty, reconciliation | Live click race and multi-host concurrency need browser acceptance |
| Remote config | Strict allowlist and bounds for the new viewer-menu and post-detail selectors; no eval/remote JS. Isolated adapter 6 saw temporary config 28 without reload; dev was restored to 27 | Selector effectiveness through an authenticated running extension still needs proof |
| Privacy | Post inspection returns at most five validated LinkedIn URLs and no post text; contact email is accepted only from an observed, identity-matched live canary target and is hidden in admin overview | Contact-email retention and staff access policy still need approval; authenticated UI behavior is unverified |
| Browser permissions | `alarms`, `storage`, `tabs`, exact LinkedIn and V2 API/local host permissions | Final host should be audited after DNS/backend provisioning |
| API browser origins | Staging startup requires an exact HTTPS web origin and a 32-character Chrome extension ID origin. A focused server test accepted only the configured web/extension origins and denied another extension ID and local web origin; local mode is loopback-bound | CORS is an additional browser boundary, not a substitute for token auth; the deployed extension ID and managed admin auth remain to be configured |

Web UI inserts server data through `textContent`, not HTML. Admin token remains in page memory. CSP and exact staging origin controls are present. This is a source-level review, not penetration testing.

The 2.5 extension build scan found no DB URL, admin token, private key marker, `eval`, or `new Function` in packaged JS. The reviewed action target is an exact normalized LinkedIn post URL equal to its command payload; profile and post author identity are checked again in the content primitive. Read-only browser research returned selector counts and profile keys only, with no page content stored in V2 facts. No authenticated submit behavior or managed admin access has been validated.

`pnpm audit --prod --audit-level high` returned "No known vulnerabilities found" on 2026-09-26 for the locked production dependencies. This registry check does not establish that the application or deployed infrastructure is free of vulnerabilities.

The support diagnostic API now returns only selected browser booleans and an email-present flag alongside workflow metadata. A Cockroach regression stored a test contact email in an observation and confirmed that the diagnostic response omitted the address. The broader admin overview still requires managed staff identity and a retention/access policy before rollout.

## Follow-up review: migration and version boundary

Migration `005_global_action_targets` added a V2-only primary key on `(action_type,target_key)` and backfilled historical target keys. The control plane now claims that guard in the same transaction as a new Connect, comment or withdrawal intent. A concurrent Cockroach test used two operators and different lead IDs for one profile and observed one reservation, intent and action command. Direct writes to `action_intents` bypass the service guard, so production action creation must remain behind the control plane; V1/V2 ownership is still not atomic.

Installation issue and remote-config minimum versions now require exact, bounded V2 version strings. The focused test rejects suffixes, leading zeros, oversized components and the wrong major version, and accepts `2.5.0`. This closes a compatibility-input gap; it does not attest that an operator's reported extension build actually matches the installed package.

A local scan of all 12 `dist` files found no exact occurrence of the configured Cockroach URL. The local environment did not contain `V2_ADMIN_TOKEN`, so its value could not be compared with the package. Neither secret variable name appears in the web/extension source or distribution. The server returns a newly issued installation token only at creation, while the admin page displays that token until the page closes. Public staging TLS, a deployed-package review, managed staff identity and a token rotation procedure remain open.
