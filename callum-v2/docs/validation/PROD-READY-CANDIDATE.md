# Readiness decision

**NOT PROD-READY-CANDIDATE** as of 2026-09-25. Starting main SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`. Latest implementation commit: `25cf3adfcbc65ee55167116ab1539f46f9880f77`; packaged build SHA: `25cf3adfcbc6`. Protocol `1`; extension `2.2.0`; adapter `3`; dev remote config `11`; DB migrations `001_init` and `002_invitation_inspection`.

The local V2 architecture, migration, protocol fixtures, Cockroach action reconciliation, remote config update, Chrome MCP lifecycle, 1k/10k real-catalog shadow workloads, and local API smoke have evidence in sibling validation files. These results do not substitute for all 15 gates in the context kit.

Branch-scoped V2 GitHub Actions runs `36155386021` and `36159922057` passed and uploaded static web files to the V2 FTP directory. Public V2 web/API DNS remains unresolved, and no dedicated backend is deployed.

Read-only comment-state, canary-scoped contact-email, and sent-invitation inspection have fixture and Cockroach tests. The 2.2.0 Chrome shadow run `fe2814e0-e619-4575-9870-4a9bd20c5bd8` proved invitation command routing with config 11, then hit LinkedIn authwall; no invitation age or action was observed. The inspection records only a single matching card's identity, age, and Withdraw-control presence. It does not withdraw anything.

Remaining gates include: authenticated no-op observations through the *running V2 extension* on multiple real profile states and invitation-manager cards; one explicitly consenting QA recipient and exactly-one live acceptance; broader crash/network/concurrency injections; comment submission and withdrawal; approved pay policy; V2 DNS/backend/web staging deployment and auth; final package/security review. V1/V2 shared lead ownership remains a separate cutover design. The current connect path has an explicit `not_submitted` outcome to prevent false reconciliation and pay. No cutover, main merge, V1 deployment or production extension replacement is authorized by this branch.
