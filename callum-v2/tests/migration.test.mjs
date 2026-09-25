import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('migration only creates explicitly qualified V2 objects',async()=>{
  const sql=await readFile(new URL('../database/migrations/001_init.sql',import.meta.url),'utf8');
  const tables=[...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([^\s(]+)/g)].map(m=>m[1]);
  assert.ok(tables.length>=15);
  assert.ok(tables.every(t=>t.startsWith('callum_v2.')));
  assert.doesNotMatch(sql,/\b(?:UPDATE|DELETE|ALTER|DROP|TRUNCATE)\s+(?:TABLE\s+)?public\./i);
  assert.match(sql,/UNIQUE \(operator_id, lead_id, action_type, target_key\)/);
  assert.match(sql,/idempotency_key STRING NOT NULL UNIQUE/);
  assert.match(sql,/action_intent_id UUID NOT NULL UNIQUE/);
});
test('invitation migration only alters V2 command type and is repeatable',async()=>{
  const sql=await readFile(new URL('../database/migrations/002_invitation_inspection.sql',import.meta.url),'utf8');
  assert.match(sql,/ALTER TABLE callum_v2\.commands DROP CONSTRAINT IF EXISTS check_type/);
  assert.match(sql,/ALTER TABLE callum_v2\.commands ADD CONSTRAINT check_type/);
  assert.match(sql,/INSPECT_PENDING_INVITATION/);
  assert.doesNotMatch(sql,/\b(?:ALTER|DROP|TRUNCATE|UPDATE|DELETE)\s+(?:TABLE\s+)?public\./i);
});
