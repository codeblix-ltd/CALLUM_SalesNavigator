import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../apps/control-plane/db.mjs';

const enabled = process.env.V2_TEST_DB === '1' && !!process.env.COCKROACH_DATABASE_URL;

test('an injected 40001 rolls back the first V2 write and commits one event', { skip: !enabled }, async () => {
  const db = openDatabase();
  const eventKey = `db-retry:${randomUUID()}`;
  let attempts = 0;
  try {
    await db.tx(async q => {
      attempts++;
      await q.query(`INSERT INTO callum_v2.events(event_key,event_type)
        VALUES ($1,'db_retry_injected')`, [eventKey]);
      if (attempts === 1) {
        const retry = new Error('INJECTED_SERIALIZATION_RETRY');
        retry.code = '40001';
        throw retry;
      }
    });
    assert.equal(attempts, 2);
    const { rows } = await db.query(`SELECT count(*)::INT4 AS n FROM callum_v2.events
      WHERE event_key=$1 AND event_type='db_retry_injected'`, [eventKey]);
    assert.equal(rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test('a concurrent V2 row update retries a stale serializable transaction', { skip: !enabled, timeout: 300000 }, async () => {
  const db = openDatabase();
  const operatorId = `v2retry_${randomUUID().slice(0, 8)}`;
  let attempts = 0;
  try {
    await db.query(`INSERT INTO callum_v2.operators(id,daily_connection_limit)
      VALUES ($1,1)`, [operatorId]);

    let releaseFirst, signalRead, signalFailure;
    const waitForRelease = new Promise(resolve => { releaseFirst = resolve; });
    const firstRead = new Promise((resolve, reject) => { signalRead = resolve; signalFailure = reject; });
    const first = db.tx(async q => {
      attempts++;
      const { rows } = await q.query(`SELECT daily_connection_limit FROM callum_v2.operators WHERE id=$1`, [operatorId]);
      if (attempts === 1) {
        signalRead();
        await waitForRelease;
      }
      await q.query(`UPDATE callum_v2.operators SET daily_connection_limit=$2 WHERE id=$1`,
        [operatorId, rows[0].daily_connection_limit + 1]);
    });
    first.catch(signalFailure);

    try {
      await firstRead;
      await db.tx(q => q.query(`UPDATE callum_v2.operators
        SET daily_connection_limit=daily_connection_limit+1 WHERE id=$1`, [operatorId]));
    } finally {
      releaseFirst();
      await first.catch(() => {});
    }
    await first;
    assert.ok(attempts >= 2, `Expected a serialization retry, got ${attempts} attempt`);
    const { rows } = await db.query(`SELECT daily_connection_limit FROM callum_v2.operators WHERE id=$1`, [operatorId]);
    assert.equal(rows[0].daily_connection_limit, 3);
  } finally {
    await db.close();
  }
});
