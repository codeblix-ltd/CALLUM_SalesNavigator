import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../apps/control-plane/db.mjs';

const db = openDatabase();
try {
  for (const version of ['001_init','002_invitation_inspection']) {
    if (version !== '001_init' && (await db.query('SELECT 1 FROM callum_v2.schema_migrations WHERE version=$1',[version])).rows.length) continue;
    const file = fileURLToPath(new URL(`../database/migrations/${version}.sql`, import.meta.url));
    const sql = await readFile(file, 'utf8');
    if (/\b(?:DROP|ALTER|TRUNCATE|UPDATE|DELETE)\b\s+(?:TABLE\s+)?(?:public\.|lead_assignments\b|leads\b)/i.test(sql)) throw new Error('Migration failed public-schema safety check');
    if ([...sql.matchAll(/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([^\s(]+)/gi)].some(m=>!m[1].startsWith('callum_v2.'))) throw new Error('Unqualified V2 table');
    if ([...sql.matchAll(/\b(?:ALTER|DROP)\s+TABLE\s+([^\s;]+)/gi)].some(m=>!m[1].startsWith('callum_v2.'))) throw new Error('Unqualified V2 alteration');
    await db.query(sql);
    await db.query('INSERT INTO callum_v2.schema_migrations(version) VALUES ($1) ON CONFLICT (version) DO NOTHING',[version]);
  }
  const { rows } = await db.query('SELECT version, applied_at FROM callum_v2.schema_migrations ORDER BY version');
  console.log(JSON.stringify({ migrations: rows.map(r => r.version), schema: 'callum_v2' }));
} finally { await db.close(); }
