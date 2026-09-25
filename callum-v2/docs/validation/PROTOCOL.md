# Protocol validation

Environment: Node 24 local and Cockroach V2. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

`pnpm test` passes schema tests for command UUIDs, operator/run/lead/trace IDs, target LinkedIn URL/key, protocol/config versions, expiry, action-intent requirement, and result sanitization. The server's command claim includes all of these fields. It accepts duplicate ACKs without another state transition and checks installation ownership.

Version `1` also bounds LinkedIn post URLs, a single contact email, and invitation age to a sane integer range while discarding unrelated page data. `INSPECT_PENDING_INVITATION` accepts only the exact sent-invitations URL and target profile key. The control plane drops contact email outside an observed, identity-matched `live_canary` contact command, rechecks target-post membership, and derives invitation eligibility only from a matched name/key, visible Withdraw control, and age of at least 30 days. Cockroach inspection tests passed these server checks. This does not establish authenticated live LinkedIn behavior. Current extension version: `2.2.0`; adapter engine: `3`.
