# Extension validation

Environment: Chrome DevTools MCP launched with `--categoryExtensions --headless --isolated --workspace=.` against a dedicated temporary Chrome profile. Latest packaged extension version `2.0.0`, build SHA `b820d22748bb` from implementation commit `b820d22748bb65b563e48b394cea70e5c434d69a`.

| Command | Result | Proves | Does not prove |
| --- | --- | --- | --- |
| `node scripts/chrome-mcp-inventory.mjs` | All five extension tools available in direct MCP session | Extension lifecycle tooling exists locally | Tools exposed in the current Codex task's tool list |
| `node scripts/chrome-lifecycle.mjs extension` | Installed ID `jemonngcmkgldopnohedppnkaddpgfkk`, listed v2.0.0, reloaded, triggered, popup loaded, service worker `background.js` present, no popup console errors, uninstalled | Real MV3 lifecycle works in isolated Chrome | Authenticated LinkedIn behavior or final build |
| `node --env-file=<local server env> scripts/chrome-shadow-smoke.mjs extension` | Command claimed, content result ACKed, `PROFILE_MISMATCH` paused lead after LinkedIn authwall redirect | Backend → extension → DOM → backend correlation and safe mismatch path | Signed-in QA profile observation |
| `pnpm run build` then `node scripts/chrome-lifecycle.mjs dist/extension` | Initial package installed as ID `blkkihmcpjhihcfihfoijkgnmfpeigbd`, listed v2.0.0, reloaded, triggered, popup build SHA `4b4a5b8501d8`, service worker present, no popup console errors, uninstalled | That packaged build runs as MV3 | Authenticated LinkedIn behavior |
| Same lifecycle command after late-ACK code commit | Rebuilt package `b820d22748bb` installed as ID `blkkihmcpjhihcfihfoijkgnmfpeigbd`, reloaded, popup reported new SHA, service worker present, no popup errors, uninstalled | Latest package metadata and MV3 lifecycle | Authenticated LinkedIn behavior |
| `node --env-file=<local server env> scripts/chrome-shadow-smoke.mjs dist/extension` | Run `5ad02216-a189-474f-9456-bce332a0a271` completed command and ACKed `PROFILE_MISMATCH` after authwall redirect; extension saw config `6` | Final packaged extension and current remote config reach V2 backend | Signed-in QA profile observation |

The extension stores only its V2 token and environment choice locally. Workflow state lives in Cockroach. Local storage and backend outage tests assert no browser action begins. No broad browsing permission or V1 extension file is used.
