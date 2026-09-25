# Protocol validation

Environment: Node 24 local and Cockroach V2. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

`pnpm test` passes schema tests for command UUIDs, operator/run/lead/trace IDs, target LinkedIn URL/key, protocol/config versions, expiry, action-intent requirement, and result sanitization. The server's command claim includes all of these fields. It accepts duplicate ACKs without another state transition and checks installation ownership.

Version `1` now also bounds LinkedIn post URLs and a single contact email while discarding unrelated page data. The control plane drops contact email outside an observed, identity-matched `live_canary` contact command and rechecks target-post membership for comment-state observations. The Cockroach inspection test passed those server checks. This does not establish authenticated live LinkedIn behavior. Current extension version: `2.1.0`; adapter engine: `2`.
