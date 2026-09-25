# Protocol validation

Environment: Node 24 local and Cockroach V2. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

`pnpm test` passes schema tests for command UUIDs, operator/run/lead/trace IDs, target LinkedIn URL/key, protocol/config versions, expiry, action-intent requirement, and result sanitization. The server's command claim includes all of these fields. It accepts duplicate ACKs without another state transition and checks installation ownership.

Version `1` also bounds LinkedIn post URLs, a single contact email, invitation age, and three withdrawal confirmation booleans while discarding unrelated page data. `INSPECT_PENDING_INVITATION` and `EXECUTE_WITHDRAW` accept only the exact sent-invitations URL and target profile key; the action requires an intent ID. The control plane drops contact email outside an observed, identity-matched `live_canary` contact command, rechecks target-post membership, and derives invitation eligibility only from a matched name/key, visible Withdraw control, and age of at least 30 days. A withdrawal confirmation additionally needs one-time authorization, target/age verification, a matching dialog, and visible card removal. Cockroach and fixture tests passed these checks without touching LinkedIn. Current extension version: `2.3.0`; adapter engine: `4`.
