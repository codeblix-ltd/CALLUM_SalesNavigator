# Real catalog shadow load

Environment: existing Cockroach cluster; public catalog queried read only, V2-only snapshots/runs/commands/events written. Operator: `antish`. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

| Command | Run | Leads / commands / events | Intents | Time | Throughput | RSS | Invariant failures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `node --env-file=<local server env> scripts/shadow-load.mjs 1000` | `0cc48927-21d1-441e-bff5-e537e9653c88` | 1,000 / 1,000 / 1,000 | 0 | 13.8 s | 73 leads/s | 49 MB | 0 |
| `node --env-file=<local server env> scripts/shadow-load.mjs 10000` | `d72f2a13-3329-447f-bbc0-34a014b277c8` | 10,000 / 10,000 / 10,000 | 0 | 61.9 s | 162 leads/s | 64 MB | 0 |

Read-only inventory query: 406,050 leads, 409,173 lead/niche links, three top niches. Search text `director` count 76,448 in 5.7 s. V1 assignment count was 63,135 before and after each load. Both workloads used deterministic real lead selection and simulated browser facts; command/event rows are marked simulated. They prove catalog selection and bulk V2 state writes at scale. They do **not** prove 10,000 individual claim/ACK transactions, Chrome throughput, LinkedIn actions, or cross-system lead ownership. No live action was generated.

## Transactional state-machine shadow run

`node --env-file=<local server env> scripts/shadow-workflow.mjs 2` used two installations and two concurrent V2 shadow runs for a new test operator, selecting real catalog leads read only. At the final run-completion implementation, runs `826a685b-8bb9-4094-adc2-751f1a895ac4` and `9e7f85c8-0cd0-4d70-b6db-93524a8f787d` each claimed and ACKed two `INSPECT_PROFILE` commands through `ControlPlane`, completed all two leads, reached run status `completed`, and emitted one `run_completed` event. Both had zero action commands, intents, and pay entries. V1 assignment count was 63,135 before and after. The four claim/ACK cycles took 38.7 s total (about 0.1 leads/s, 50 MB RSS). A preliminary two-run, five-lead-per-run trial also completed all ten commands in 73.5 s before the final completion-scoping change; that trial is not final-code throughput evidence.

This exercises real catalog selection and durable claim/ACK/terminal-run transactions, including concurrent runs. The simulated browser facts were not read from LinkedIn. Four final-code commands are not a 1k/10k transactional load, and the measured throughput is too low to claim production capacity; the 1k/10k results above remain bulk-write evidence only.
