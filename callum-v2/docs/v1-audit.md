# V1 audit, 2026-09-25

Baseline: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

## A. Useful concepts

- `public.leads` has stable UUID and `profile_key`, URL, name, geography and company fields. `public.lead_niches` is many-to-many; V2 reads both without writing either.
- V1 has exclusive `lead_assignments` by lead UUID, daily connection and engagement limits in `operator_settings`, `operator_daily_usage`, and append-only `lead_assignment_events`. These inform V2's separate schema and server-side limits.
- V1 GHL delivery uses a durable, unique `(lead_id, operator_id)` outbox and email upsert. The concept is useful, but no V2 GHL sends are enabled during this build.
- V1 support reports and recent tests contain concrete Pending/Connect, connection-state, page-navigation, storage and partial-comment failure cases. V2 fixtures should reproduce these browser states.
- Convex auth keeps Cockroach and gateway secrets off clients. V2 retains that security boundary with an isolated server.

## B. Mistakes not to copy

- `chrome-extension/background.js` owns daily workflow phases, queue progression, retries and a persisted run state in `chrome.storage.local`; this makes browser state a second source of truth.
- The content/background layers have broad LinkedIn action parsing and long-lived local receipts. A missing ACK after a click can become ambiguous; V2 must hold a durable intent and reconcile by observation.
- Layout fixes wait for installed extension releases. V2 needs versioned, schema-checked declarative selectors and server kill switches.
- Support cannot reliably infer the exact running extension build or failure stage from ordinary reports.

## C. Compatibility requirements

- V2 lead IDs and niche names must match read-only V1 catalog values. V2 assignments **cannot** reserve leads against V1; V1 is unaware of them. Therefore V2 test runs default to shadow, and live canary requires a separately controlled recipient.
- V1 lives under `internal-vite-react-lead-operations/`; `.github/workflows/deploy-lead-app.yml` deploys that path only to `lead.careeraccelerator.net/public_html/`. Neither path may change here.
- The existing Cockroach cluster can be shared only with all V2 writes explicitly in `callum_v2`. The V1 Convex deployment and Codex gateway are not V2 development targets.

## D. Unresolved assumptions

- V1 compensation rates/eligibility are not a published policy in the inspected files. V2 records versioned rules but defaults to no payable amount until configured.
- A consenting LinkedIn QA recipient is not identified by the reviewed source or support documents; local configuration search and live acceptance remain separate checks.
- Staging DNS, FTP directory, backend host and V2-specific credentials need verification before deployment.
- V1's live assignment changes continue independently, so read-only catalog snapshots are not a cutover or shared-lead-ownership design.

## Support evidence

- Rymaelie's Pending example and hundreds of connection-state failures do not prove each lead is bad; no repeated click is safe.
- Apple had intermittent navigation and connection-state failures after earlier gateway recovery.
- John's v0.10.39 comment progress issue had a storage-related candidate fix in 0.10.47, but his installed-browser root cause remained unverified.

Sources: V1 `README.md`, `database/schema.sql`, `convex/scouts.ts`, `convex/leads.ts`, extension manifest/background, `docs/support-triage-2026-09-25.md`, `docs/john-comment-progress-2026-09-25.md`, and Rymaelie live-validation notes at the baseline SHA.
