# Callum Scout V2

Production-isolated canary. The Node control plane owns workflow, command claims, action intents, reconciliation, remote config, events and pay. The MV3 extension only observes LinkedIn or performs one server-authorized atomic action. The web app is a V2 staging administration surface.

Current implemented browser workflow: profile observation and a guarded connection request. Comment, withdrawal, invitation-manager, and contact-info workflows still require implementation and validation; do not use this branch for production scouts. See the readiness record for the remaining gates.

## Local setup

Use Node 24 and pnpm 10. From this directory:

```text
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm test
pnpm run build
```

`COCKROACH_DATABASE_URL` and a unique `V2_ADMIN_TOKEN` (at least 32 characters) are server-only environment variables. `V2_PORT` defaults to 8788. `V2_WEB_ORIGIN` is the exact allowed staging web origin. `V2_QA_PROFILE_KEY` must identify the separately authorized consenting QA recipient before any `live_canary` run can be created. Never copy a V1 Convex or gateway secret into V2 clients.

Run `pnpm server` for the local API and web UI. Create operator `antish` in V2, then issue a V2 installation token. The token is shown once. Load `dist/extension` into the dedicated QA Chrome profile using Chrome DevTools MCP extension tooling when available. Its popup shows the exact build/config and accepts only a V2 installation token.

The web staging target is `https://lead-v2.careeraccelerator.net/`; the dedicated API origin is `https://api-v2.careeraccelerator.net`. The FTP workflow deploys static web assets only. Host and DNS provisioning for the API must be verified separately. No V1 deployment or public-schema migration is part of this project.

Read [architecture](docs/architecture.md) and the [validation records](docs/validation/BASELINE.md) before interpreting readiness.
