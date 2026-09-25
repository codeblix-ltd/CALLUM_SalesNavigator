# Failure injection

Environment: Node 24 fixtures, Cockroach V2 test rows, isolated Chrome. Baseline SHA: `68f5971a5e4b91d0814cd0f2b32dd18dbd64237b`.

| Scenario | Evidence / result | Limit |
| --- | --- | --- |
| Duplicate result and command claim | Cockroach integration: duplicate ACK idempotent; leased action not redelivered | Not a multi-host race test |
| Worker/network lost after authorization and click, ACK lost | Forced action lease expiry yielded only `INSPECT_PROFILE` reconciliation; Pending confirmed one intent | Browser click itself was simulated |
| Late action ACK after reconciliation queued or leased | Cockroach regression: a confirmed late ACK cancelled the queued observation; a leased stale observation could not overwrite the confirmed lead/intent | Real browser timing race remains untested |
| Reconciliation and pay | Zero-amount fixture rule yielded one ledger row with version after confirmed result; rule disabled after test | No business rate approved |
| Wrong profile, hydration, Pending, Connected, InMail ambiguity, no action | Adapter fixtures and authenticated page structure review | Not broad real-profile coverage |
| Storage unavailable/full, backend unavailable | Background VM tests pause before tab/action | Chrome quota fault not injected in live browser |
| Navigation fails before content primitive | Background VM reports `not_submitted`; Cockroach test cancels a non-submitted intent without pay or reconciliation | Live Chrome tab-close race still pending |
| Config rollback, stale pending command, operator kill | Cockroach config integration passed | Global kill under concurrent live click not tested |
| Contact gate and stale extension | Cockroach inspection test rejected a 2.0.0 installation for 2.1.0 dev config, blocked a contact command with the contact kill switch, and resumed it after clearing the flag | No authenticated contact extraction in Chrome |
| Invitation observation scope | Cockroach inspection test rejected a forged target profile key, derived 35-day eligibility only for a matched observation, and blocked/resumed a pending read-only command with the withdrawal flag | No authenticated invitation card or withdrawal action tested |
| Withdrawal action uncertainty | Cockroach test required a fresh same-installation QA observation, authorized once, prevented redelivery after an expired lease, used only a read-only reconciliation command, accepted a late confirmed ACK without a second action, and generated no pay; adapter fixtures clicked one matching 35-day card and one confirmation button | No real authenticated LinkedIn withdrawal or browser crash after a live click |
| Withdrawal kill between claim and authorization | Cockroach rejected authorization after the flag changed and recorded `not_submitted` with no pay; worker navigation-failure test also sent `not_submitted` without authorization | Real Chrome tab-close race remains untested |
| Chrome restart/resume, tab closure, DB retry/transaction conflict, network loss before action, comment/withdraw uncertainty | Pending dedicated injection | Safety cannot be claimed from unit tests alone |

`pnpm test` is the local suite. `V2_TEST_DB=1 node --env-file=<local server env> --test tests/db.integration.test.mjs tests/remote-config.integration.test.mjs` is the Cockroach suite, run sequentially because configuration tests change the dev release pointer.
