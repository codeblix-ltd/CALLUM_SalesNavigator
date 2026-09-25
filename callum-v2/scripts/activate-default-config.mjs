import { isDeepStrictEqual } from 'node:util';
import { openDatabase } from '../apps/control-plane/db.mjs';
import { ControlPlane, CURRENT_EXTENSION_VERSION } from '../apps/control-plane/service.mjs';
import { DEFAULT_CONFIG } from '../packages/linkedin-config/index.mjs';

const db = openDatabase();
try {
  const control = new ControlPlane(db);
  await control.seed();
  const { rows } = await db.query('SELECT version,config,min_extension_version FROM callum_v2.remote_configs ORDER BY version DESC');
  const existing = rows.find(row => isDeepStrictEqual(row.config, DEFAULT_CONFIG) && row.min_extension_version === CURRENT_EXTENSION_VERSION);
  const version = existing ? Number(existing.version) : Number((await control.createConfig(DEFAULT_CONFIG,CURRENT_EXTENSION_VERSION)).version);
  const activated = await control.activateConfig(version, 'dev');
  console.log(JSON.stringify({ channel: activated.channel, version: activated.version, status: activated.status }));
} finally {
  await db.close();
}
