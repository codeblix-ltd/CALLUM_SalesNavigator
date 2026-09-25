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
