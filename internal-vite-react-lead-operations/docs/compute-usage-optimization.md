# Compute usage changes — Scout 0.10.35

The backend and the extension must both be updated for the AI savings. Older
extensions still use the synchronous `scouts:*` AI endpoints. Those endpoints
remain available so that a scout already working a lead is not interrupted.

## What changes

- AI submission returns a job receipt immediately. The extension reads job
  status through Convex queries, with polling backing off from 2 to 10 seconds.
- The scheduled worker uses the 64 MiB Convex runtime. The CockroachDB steps
  use short, separate Node actions. The 512 MiB Node runtime no longer waits
  for the AI gateway on the new route. This reduces the memory component of
  AI waiting compute by 87.5%; it does not promise that reduction in the total bill.
- Each scout can run one AI job at a time. Identical in-progress submissions
  reuse that job. The latest successful result for each operation is cached for
  one hour; a failure has a 30-second retry cooldown.
- Each scout has at most three reusable job documents, one for each operation.
  Request text is cleared on completion. Expired jobs can be replaced, and a
  late result cannot overwrite a replacement job.
- A scout can start at most 120 new jobs per UTC clock hour, across all three
  operations. Cached results do not count. Server-only environment variable
  `SCOUT_AI_MAX_JOBS_PER_HOUR` can change this limit. This is an application
  guard for the new AI endpoints, not an account-wide billing cap.
- Quota or concurrent-job failures stop the lead run rather than trying and
  failing every remaining lead. No LinkedIn message or connection is sent by
  the job worker; it only returns drafts and language results.
- Dashboard reads no longer attempt inserts when the scout's settings and
  daily usage rows already exist. Existing users save two SQL round trips per
  dashboard request. First-use initialization still handles concurrent inserts.
- Simultaneous extension dashboard reads are coalesced. Popup hydration can
  reuse a same-account summary for 30 seconds; explicit refreshes remain fresh.
  The final automation badge reuses the just-fetched dashboard.
- The admin GHL history refreshes every 60 seconds while visible and skips
  background refreshes while hidden or loading.
- Admin gateway actions also use the smaller Convex runtime.

## Rollout and verification

Deploy the backend to the deployment configured in `.env.local`, then distribute
the 0.10.35 extension through the existing installation channel. Reload the
admin page to load the new polling behavior. Older extensions must update to
receive the new AI job flow; backend deployment alone does not update them.

Run `node scripts/test-compute-usage.mjs` for job deduplication, caching, quota,
ownership, stale completion, bounded storage, query polling, read coalescing,
and worker success/failure checks. Run `node scripts/test-extension.mjs` for the
existing automation and authentication regression checks.

In Convex Usage, select **Compute** and compare the old `scouts:*` AI actions
against `scoutAi:run` after scouts update. Compare compute per completed lead
over similar workloads. Completed-job storage and query polling have a small
cost, and legitimate usage continues to accrue. Usage already recorded this
month is not reversed.
