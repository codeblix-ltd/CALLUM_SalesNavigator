# Pay and tracking validation

Environment: Node fixtures and Cockroach V2 test operator. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

`pnpm test` proves attempts and uncertain intents do not satisfy the payable predicate. The Cockroach integration test created an explicitly test-only, zero-amount enabled rule, confirmed a synthetic action, delivered its ACK twice, and observed exactly one ledger item referencing a source event and rule version. It also observed Pending after an explicitly `not_submitted` command: that intent became `cancelled`, generated no reconciliation command, and generated no pay. The rule was disabled in test cleanup.

This proves derivation and uniqueness for the tested connection outcome. It does not establish real scout compensation policy, actual payable rates, comment/observation eligibility, payroll approval or live-action attribution. Those require owner-approved versioned rules and further tests.

The later Cockroach regression enabled the fixture rule before reconciliation. A Pending observation after a lost action ACK produced one ledger row tied to a `connection_confirmed` source event and the tested rule version. Direct confirmation, late ACK, and `not_submitted` cases remained distinct.

The withdrawal Cockroach test produced zero pay rows across confirmed, uncertain, late-ACK, and `not_submitted` outcomes. Withdrawal compensation is not configured or implied by this implementation.

The admin API now creates a versioned pay rule and an audit event in one V2 transaction. It rejects unsafe integer values, missing enabled state, unsupported event types, invalid currency codes and duplicate versions. An admin can enable or disable an existing rule through the API and web form without editing the database; a no-op repeat does not add an event. The admin overview shows current rule versions and enabled state plus selected audit version/state fields. A focused Cockroach-backed local HTTP test passed 1/1: an unauthorized request was rejected, a **zero-amount** disabled fixture rule was created, enabled, repeated, and disabled, with three sanitized audit events, no pay-ledger row, and no admin token in stored or visible data. The test left the fixture rule disabled. This validates administration and rollback mechanics only; it does not approve a compensation rate or establish payroll policy. The shared admin token still cannot attribute the change to an individual approver.
