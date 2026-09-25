# Deployment validation

Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

- V2-only workflow: `.github/workflows/deploy-lead-v2.yml`; branch-scoped to `codex/thin-extension-v2`, separate concurrency, static files from `callum-v2/dist/web/` to `lead-v2.careeraccelerator.net/public_html/`. V1 workflow remains untouched.
- GitHub secret names `FTP_USERNAME` and `FTP_PASSWORD` exist. Their values were neither read nor printed.
- [GitHub Actions V2 run 36155386021](https://github.com/codeblix-ltd/CALLUM_SalesNavigator/actions/runs/36155386021) passed `pnpm test`, `pnpm run build`, and FTP upload. The log confirmed sync to `lead-v2.careeraccelerator.net/public_html/`. This proves static files reached that FTP directory; it does not prove public HTTP serving.
- DNS lookup on 2026-09-25 found **no A record** for `lead-v2.careeraccelerator.net` or `api-v2.careeraccelerator.net`. Public static staging and dedicated API were not reachable. In the same check, `lead.careeraccelerator.net` resolved and returned HTTP 200 (607-byte HTML response).
- Local API smoke: `/api/health` returned `ok`, web root HTTP 200 with V2 banner, admin overview returned data with bearer token, missing bearer returned 401. This proves local serve/auth only.
- Backend Dockerfile/compose example isolates the API. No V1 Convex push or V1 web deployment ran.

Exact external gate: provision V2 DNS and dedicated API host/TLS with V2 server credentials, then verify public web/API endpoints and auth. The V2 web FTP directory and upload work. Do not reuse the V1 Convex deployment.
