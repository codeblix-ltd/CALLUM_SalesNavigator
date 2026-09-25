import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../apps/control-plane/db.mjs';
import { ControlPlane } from '../apps/control-plane/service.mjs';
import { DEFAULT_CONFIG } from '../packages/linkedin-config/index.mjs';

const enabled=process.env.V2_TEST_DB==='1' && !!process.env.COCKROACH_DATABASE_URL;
test('server hotfix, rollback and operator kill apply to pending commands', {skip:!enabled}, async()=>{
  const db=openDatabase(),s=new ControlPlane(db),op=`v2cfg_${randomUUID().slice(0,8)}`;
  let version=null,previousConfig=null;
  try {
    await s.seed();await s.createOperator(op,'dev',1);
    previousConfig=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const issued=await s.createInstallation(op,'2.4.0','68f5971a'),installation=await s.installation(issued.token);
    const before=await s.createRun({operatorId:op,mode:'shadow',count:1});
    const draft=await s.createConfig({...DEFAULT_CONFIG,connect:['button[data-callum-hotfix="connect"]']});version=Number(draft.version);
    await s.activateConfig(version,'dev');
    const claimed=await s.claim(installation);
    assert.equal(claimed.config.version,version);
    assert.equal(claimed.command?.configVersion,version);
    assert.equal(claimed.command?.runId,before.id);
    await s.activateConfig(1,'dev');
    assert.equal((await db.query('SELECT status FROM callum_v2.remote_configs WHERE version=1')).rows[0].status,'stable');
    const after=await s.createRun({operatorId:op,mode:'shadow',count:1});
    await s.setFlag(`operator:${op}`,true);
    const blocked=await s.claim(installation);
    assert.equal(blocked.command,null);
    const statuses=await db.query("SELECT status FROM callum_v2.commands WHERE run_id=$1",[after.id]);
    assert.equal(statuses.rows[0].status,'pending');
    await s.setFlag(`operator:${op}`,false);
    const resumed=await s.claim(installation);
    assert.equal(resumed.command?.runId,after.id);
  } finally {
    await s.setFlag(`operator:${op}`,false).catch(()=>{});
    if(previousConfig!==null)await s.activateConfig(previousConfig,'dev').catch(()=>{});
    await db.close();
  }
});
