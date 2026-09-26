# Callum Scout V2

Production-isolated canary. The Node control plane owns workflow, command claims, action intents, reconciliation, remote config, events and pay. The MV3 extension only observes LinkedIn or performs one server-authorized atomic action. The web app is a V2 staging administration surface.

Current browser work includes profile observation, recent-post/comment-state and sent-invitation inspection, controlled contact-email extraction, guarded connection and withdrawal actions, and a reviewed QA comment action. Connect, withdrawal, and comment actions require the configured signed-in actor and recent same-installation observation before one-time server authorization. Uncertain submissions receive observation-only reconciliation. Authenticated LinkedIn action validation remains open; do not use this branch for production scouts. See the readiness record for the remaining gates.

An admin can rotate an installation token in place. The replacement is shown once, the old token stops authenticating, and active server requests recheck the stored token hash before claiming, authorizing, or acknowledging commands. The installation ID and its run bindings stay intact.

## Local setup

Use Node 24 and pnpm 10. From this directory:

```text
# Only if dependencies are missing or the lockfile changed:
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm test
pnpm run build
```

`COCKROACH_DATABASE_URL` and a unique `V2_ADMIN_TOKEN` (at least 32 characters) are server-only environment variables. `V2_PORT` defaults to 8788. Staging requires `V2_ENVIRONMENT=staging`, `V2_WEB_ORIGIN=https://lead-v2.careeraccelerator.net`, and `V2_EXTENSION_ORIGIN=chrome-extension://<the installed V2 extension ID>`; the API accepts only those exact browser origins. Use the ID from the actual V2 package installed in the target QA profile. Local mode binds to loopback and permits isolated test extension origins. `V2_QA_PROFILE_KEY` must identify the separately authorized consenting QA recipient before any `live_canary` run can be created. Never copy a V1 Convex or gateway secret into V2 clients.

Run `pnpm server` for the local API and web UI. Load `dist/extension` into the selected QA Chrome profile using Chrome DevTools MCP extension tooling when available. Read the exact extension version and build SHA from its popup. Create operator `antish` in V2, then issue an installation for those exact values and the signed-in actor profile. The token is shown once; enter it directly in the V2 popup and do not put it in shared notes. Rotation invalidates the previous token. The admin form requires the operator to enter version and build rather than pre-filling a potentially stale package identity. Authenticated extension validation in the selected profile is still pending.

The web staging target is `https://lead-v2.careeraccelerator.net/`; the dedicated API origin is `https://api-v2.careeraccelerator.net`. The FTP workflow deploys static web assets only. Host and DNS provisioning for the API must be verified separately. No V1 deployment or public-schema migration is part of this project.

Read [architecture](docs/architecture.md) and the [validation records](docs/validation/BASELINE.md) before interpreting readiness.
