# Protocol validation

Environment: Node 24 local and Cockroach V2. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

`pnpm test` passes schema tests for command UUIDs, operator/run/lead/trace IDs, target LinkedIn URL/key, protocol/config versions, expiry, action-intent requirement, and result sanitization. The server's command claim includes all of these fields. It accepts duplicate ACKs without another state transition and checks installation ownership.

This proves local parser and DB integration behavior. It does not establish compatibility with an authenticated live LinkedIn action or a later extension release. Current protocol version: `1`; extension version: `2.0.0`.
