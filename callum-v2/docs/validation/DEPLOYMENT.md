# Deployment validation

Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

- V2-only workflow: `.github/workflows/deploy-lead-v2.yml`; branch-scoped to `codex/thin-extension-v2`, separate concurrency, static files from `callum-v2/dist/web/` to `lead-v2.careeraccelerator.net/public_html/`. V1 workflow remains untouched.
- GitHub secret names `FTP_USERNAME` and `FTP_PASSWORD` exist. Their values were neither read nor printed.
- DNS lookup on 2026-09-25 found **no A record** for `lead-v2.careeraccelerator.net` or `api-v2.careeraccelerator.net`. Static staging and dedicated API were not reachable; no deployment success is claimed. In the same check, `lead.careeraccelerator.net` resolved and returned HTTP 200 (607-byte HTML response).
- Local API smoke: `/api/health` returned `ok`, web root HTTP 200 with V2 banner, admin overview returned data with bearer token, missing bearer returned 401. This proves local serve/auth only.
- Backend Dockerfile/compose example isolates the API. No V1 Convex push or V1 web deployment ran.

Exact external gate: provision V2 DNS, web directory, dedicated API host/TLS and V2 server credentials. Then trigger/inspect V2 workflow and verify both staging endpoints and V1 health. Do not reuse the V1 Convex deployment.
