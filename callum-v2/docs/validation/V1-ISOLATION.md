# V1 isolation

Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

| Check | Environment / command | Result | Proves | Does not prove |
| --- | --- | --- | --- | --- |
| Source protection | V2 worktree, `pnpm verify:v1` after implementation commit | Passed against baseline | The protected extension, Convex, DB and V1 deploy workflow have no V2 diff | Runtime production health |
| Read-only V1 catalog | Cockroach `SELECT` of `public.leads`, `public.lead_niches`, `public.lead_assignments` | 406,050 leads; 409,173 lead/niche links; assignment count 63,135 during tests | V2 load used existing inventory without public DML | Other V1 writers may change counts concurrently |
| V2 writes | Migration and load SQL inspection | All V2 DDL and test writes use `callum_v2` qualification | The shipped scripts do not target public writes | An independently deployed future service must still be monitored |
| Worktree | `git worktree list --porcelain` | Separate `codex/thin-extension-v2` worktree created from fetched main | Filesystem and branch isolation | Production deployment health |

No V1 deployment command was run in this task. V2 was pushed only to `codex/thin-extension-v2`, never to `main`.

After the V2 branch push, GitHub Actions showed only `Deploy Callum V2 web staging` for that branch. The latest V1 production workflow run was on `main` at 13:52 UTC, before the V2 push; V2 did not trigger it.

An independent HTTP check on 2026-09-25 returned 200 from `https://lead.careeraccelerator.net/`. It confirms the V1 web endpoint responded at that moment; it does not certify all V1 workflows.
