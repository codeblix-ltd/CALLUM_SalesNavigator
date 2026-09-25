# Deployment validation

Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

- V2-only workflow: `.github/workflows/deploy-lead-v2.yml`; branch-scoped to `codex/thin-extension-v2`, separate concurrency, static files from `callum-v2/dist/web/` to `lead-v2.careeraccelerator.net/public_html/`. V1 workflow remains untouched.
- GitHub secret names `FTP_USERNAME` and `FTP_PASSWORD` exist. Their values were neither read nor printed.
- [GitHub Actions V2 run 36155386021](https://github.com/codeblix-ltd/CALLUM_SalesNavigator/actions/runs/36155386021) passed `pnpm test`, `pnpm run build`, and FTP upload. The log confirmed sync to `lead-v2.careeraccelerator.net/public_html/`. This proves static files reached that FTP directory; it does not prove public HTTP serving.
- [2.1.0 implementation run 36159922057](https://github.com/codeblix-ltd/CALLUM_SalesNavigator/actions/runs/36159922057) also passed tests, build, and the V2-only FTP sync after the inspection changes.
- [2.2.0 implementation run 36162224393](https://github.com/codeblix-ltd/CALLUM_SalesNavigator/actions/runs/36162224393) passed `pnpm test`, `pnpm run build`, and the V2-only FTP sync on branch SHA `1f497d7d1fa4731dbc19a708c32064a84a0db553`. This confirms upload of the updated admin UI; it still does not prove public HTTP serving.
- [2.3.0 implementation run 36165164943](https://github.com/codeblix-ltd/CALLUM_SalesNavigator/actions/runs/36165164943) passed tests, build, and the V2-only FTP sync on branch SHA `88967c21db0ce9cee975c09efea3323c02a3331b`. This includes the QA-scoped withdrawal admin form; public HTTP and the dedicated API remain unverified.
- [2.4.0 branch run 36168741046](https://github.com/codeblix-ltd/CALLUM_SalesNavigator/actions/runs/36168741046) passed tests, build, and V2-only FTP sync on SHA `aa806859db33418664ae5fca5df49efacc388ee5`. The reviewed comment UI is in the static package. Public HTTP and the dedicated API remain unverified.
- [Recovery branch run 36171523056](https://github.com/codeblix-ltd/CALLUM_SalesNavigator/actions/runs/36171523056) passed tests, build, and V2-only FTP sync on SHA `0b8b927a6a072de9d5585b549ca40db617722cc3`. This includes backend restart/run-control tests and the same V2 static UI. Public HTTP and the dedicated API remain unverified.
- [Branch run 36177796073](https://github.com/codeblix-ltd/CALLUM_SalesNavigator/actions/runs/36177796073) passed tests, build, and V2-only FTP sync on SHA `50247f9ac4e46d1904a4bd4312f18cddba98f438`. The static UI now accepts the required live-canary installation UUID. This CI run did not configure Cockroach integration tests; those were run separately against the local configured cluster. Public V2 HTTP and the dedicated API remain unverified.
- DNS lookup on 2026-09-25 found **no A record** for `lead-v2.careeraccelerator.net` or `api-v2.careeraccelerator.net`. Public static staging and dedicated API were not reachable. In the same check, `lead.careeraccelerator.net` resolved and returned HTTP 200 (607-byte HTML response).
- Local API smoke: `/api/health` returned `ok`, web root HTTP 200 with V2 banner, admin overview returned data with bearer token, missing bearer returned 401. This proves local serve/auth only.
- Backend Dockerfile/compose example isolates the API. No V1 Convex push or V1 web deployment ran.

Exact external gate: provision V2 DNS and dedicated API host/TLS with V2 server credentials, then verify public web/API endpoints and auth. The V2 web FTP directory and upload work. Do not reuse the V1 Convex deployment.
