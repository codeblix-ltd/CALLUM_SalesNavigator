# Real catalog shadow load

Environment: existing Cockroach cluster; public catalog queried read only, V2-only snapshots/runs/commands/events written. Operator: `antish`. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

| Command | Run | Leads / commands / events | Intents | Time | Throughput | RSS | Invariant failures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `node --env-file=<local server env> scripts/shadow-load.mjs 1000` | `0cc48927-21d1-441e-bff5-e537e9653c88` | 1,000 / 1,000 / 1,000 | 0 | 13.8 s | 73 leads/s | 49 MB | 0 |
| `node --env-file=<local server env> scripts/shadow-load.mjs 10000` | `d72f2a13-3329-447f-bbc0-34a014b277c8` | 10,000 / 10,000 / 10,000 | 0 | 61.9 s | 162 leads/s | 64 MB | 0 |

Read-only inventory query: 406,050 leads, 409,173 lead/niche links, three top niches. Search text `director` count 76,448 in 5.7 s. V1 assignment count was 63,135 before and after each load. Both workloads used deterministic real lead selection and simulated browser facts; command/event rows are marked simulated. They prove catalog selection and bulk V2 state writes at scale. They do **not** prove 10,000 individual claim/ACK transactions, Chrome throughput, LinkedIn actions, or cross-system lead ownership. No live action was generated.
