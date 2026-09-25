# Pay and tracking validation

Environment: Node fixtures and Cockroach V2 test operator. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

`pnpm test` proves attempts and uncertain intents do not satisfy the payable predicate. The Cockroach integration test created an explicitly test-only, zero-amount enabled rule, confirmed a synthetic action, delivered its ACK twice, and observed exactly one ledger item referencing a source event and rule version. It also observed Pending after an explicitly `not_submitted` command: that intent became `cancelled`, generated no reconciliation command, and generated no pay. The rule was disabled in test cleanup.

This proves derivation and uniqueness for the tested connection outcome. It does not establish real scout compensation policy, actual payable rates, comment/observation eligibility, payroll approval or live-action attribution. Those require owner-approved versioned rules and further tests.

The later Cockroach regression enabled the fixture rule before reconciliation. A Pending observation after a lost action ACK produced one ledger row tied to a `connection_confirmed` source event and the tested rule version. Direct confirmation, late ACK, and `not_submitted` cases remained distinct.
