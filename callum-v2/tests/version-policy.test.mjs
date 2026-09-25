import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ControlPlane } from '../apps/control-plane/service.mjs';
import { DEFAULT_CONFIG } from '../packages/linkedin-config/index.mjs';

test('extension versions must be exact bounded V2 versions before issue or config use', async () => {
  const control=new ControlPlane({query:async()=>({rows:[{id:randomUUID(),operator_id:'qa'}]})});
  for(const version of ['2.5.0extra','2.999.0x','2.01.0','2.1000000.0','3.0.0']){
    await assert.rejects(()=>control.createInstallation('qa',version,'a142581d'),/INSTALLATION_INVALID/);
    await assert.rejects(()=>control.createConfig(DEFAULT_CONFIG,version),/CONFIG_INVALID/);
  }
  const issued=await control.createInstallation('qa','2.5.0','a142581d');
  assert.ok(issued.token.length>=30);
  const q={query:async()=>({rows:[{version:1,config:DEFAULT_CONFIG,min_extension_version:'2.5.0',
    checksum:'fixture',status:'stable',rollout_percent:100}]})};
  await assert.rejects(()=>control.activeConfig(q,{cohort:'dev',extension_version:'2.999.0x'}),/CONFIG_INCOMPATIBLE/);
  assert.equal((await control.activeConfig(q,{cohort:'dev',extension_version:'2.5.0'})).version,1);
});
