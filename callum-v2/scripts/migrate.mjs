import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../apps/control-plane/db.mjs';

const file = fileURLToPath(new URL('../database/migrations/001_init.sql', import.meta.url));
const sql = await readFile(file, 'utf8');
if (/\b(?:DROP|ALTER|TRUNCATE|UPDATE|DELETE)\b\s+(?:TABLE\s+)?(?:public\.|lead_assignments\b|leads\b)/i.test(sql)) throw new Error('Migration failed public-schema safety check');
if ([...sql.matchAll(/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([^\s(]+)/gi)].some(m => !m[1].startsWith('callum_v2.'))) throw new Error('Unqualified V2 table');
const db = openDatabase();
try {
  await db.query(sql);
  await db.query("INSERT INTO callum_v2.schema_migrations(version) VALUES ('001_init') ON CONFLICT (version) DO NOTHING");
  const { rows } = await db.query('SELECT version, applied_at FROM callum_v2.schema_migrations ORDER BY version');
  console.log(JSON.stringify({ migrations: rows.map(r => r.version), schema: 'callum_v2' }));
} finally { await db.close(); }
