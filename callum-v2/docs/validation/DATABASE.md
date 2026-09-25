# Database validation

Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`. Environment: existing Cockroach cluster, V2 schema only; URL is server-side and omitted here.

| Command | Result | Proves | Does not prove |
| --- | --- | --- | --- |
| `node --env-file=<local server env> scripts/migrate.mjs` | `001_init` applied; 17 `callum_v2` tables observed | Empty-schema migration executes against Cockroach | Future migrations or production deployment |
| Same migration command repeated | Success; still one `001_init` record | Initial migration is repeatable | Rollback quality |
| `node --test tests/migration.test.mjs` | Pass | Static qualification and uniqueness constraints in source | Runtime transaction behavior |
| `V2_TEST_DB=1 node --env-file=<local server env> --test tests/db.integration.test.mjs` | Pass with five V2 runs, including late ACK and reconciled-pay cases | Actual DB command lease, queued/leased reconciliation races and unique pay line | Live LinkedIn click or full concurrent load |
| `V2_TEST_DB=1 node --env-file=<local server env> --test tests/inspection.integration.test.mjs` | Pass: 2.0.0 incompatibility, comment and contact claims/ACKs, contact kill/resume, canary email scope, forged fact rejection | Read-only commands do not change lead stage or reserve Connect; email is withheld outside a controlled observed canary result | Authenticated LinkedIn post/contact layout |

`public.leads` and `public.lead_niches` are queried read only. `run_leads` stores V2 snapshots and does not claim exclusive ownership against V1. The migration uses `CREATE IF NOT EXISTS`; forward fixes require a new numbered migration. No public-schema rollback is allowed. `commands.idempotency_key`, action-target uniqueness, event keys and pay intent uniqueness are enforced by DB constraints. Indexes include operator/status command polling and run/event diagnostics.
