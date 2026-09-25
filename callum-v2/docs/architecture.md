# Architecture decision

V2 uses a dedicated Node 24 API and Cockroach schema rather than the existing V1 Convex deployment. This keeps credentials, deployment, state and release cadence separate while using read-only `public.leads` inventory. The API is the only writer to `callum_v2`.

The server issues durable commands to a token-authenticated installation. Commands include operator, run, lead, target identity, config version, expiry, trace and idempotency key. An action command references a unique server-side intent and must pass a just-before-click authorization call. Its lease timeout or uncertain ACK triggers an observation-only reconciliation command. No expired action command is redelivered.

The extension stores only a V2 installation token and environment choice. It navigates, observes visible DOM, performs a single authorized primitive and reports sanitized facts. A browser restart asks the server for the next command; no local workflow journal exists.

The web UI reads V2 support, config, run and pay records through the isolated API. Admin authorization is a V2-only bearer token kept in the page's memory for that session. A stronger managed identity provider should replace this before staff rollout.

During development, `shadow` uses read-only V1 lead rows and V2-only run/command rows. V2 assignments do not reserve leads against V1. `live_canary` requires an exact configured QA profile key and one lead ID, and is disabled when that configuration is absent. It rejects a lead already in `public.lead_assignments` at run creation and again before an irreversible action is authorized. V1 can still assign a lead after the final read; [the ownership cutover design](lead-ownership-cutover.md) records the coordinated protocol required before broader live rollout.
