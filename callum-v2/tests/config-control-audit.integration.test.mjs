import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane,CURRENT_EXTENSION_VERSION} from '../apps/control-plane/service.mjs';
import {DEFAULT_CONFIG} from '../packages/linkedin-config/index.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('config drafts and channel changes audit atomically and skip no-ops',
  {skip:!enabled,timeout:180000},async()=>{
    const db=openDatabase(),control=new ControlPlane(db);
    let previous=null,version=null;
    try{
      await control.seed();
      previous=(await db.query(`SELECT r.active_config_version,c.rollout_percent FROM callum_v2.release_channels r
        JOIN callum_v2.remote_configs c ON c.version=r.active_config_version WHERE r.channel='dev'`)).rows[0];
      const draft=await control.createConfig(DEFAULT_CONFIG);
      version=Number(draft.version);
      const drafted=(await db.query(`SELECT config_version,details FROM callum_v2.events
        WHERE event_key=$1`,[`config:${version}:drafted`])).rows;
      assert.equal(drafted.length,1);
      assert.equal(Number(drafted[0].config_version),version);
      assert.equal(drafted[0].details.checksum,draft.checksum);

      assert.equal((await control.activateConfig(version,'dev',30)).changed,true);
      assert.equal((await control.activateConfig(version,'dev',30)).changed,false);
      const failedAudit=new ControlPlane({...db,tx:fn=>db.tx(q=>fn({query:(sql,args)=>{
        if(sql.includes('INSERT INTO callum_v2.events'))throw new Error('AUDIT_INJECTED_FAILURE');
        return q.query(sql,args);
      }}))});
      await assert.rejects(()=>failedAudit.activateConfig(version,'dev',35),/AUDIT_INJECTED_FAILURE/);
      const active=(await db.query(`SELECT r.active_config_version,c.status,c.rollout_percent
        FROM callum_v2.release_channels r JOIN callum_v2.remote_configs c ON c.version=r.active_config_version
        WHERE r.channel='dev'`)).rows[0];
      assert.equal(Number(active.active_config_version),version);
      assert.equal(active.status,'canary');
      assert.equal(active.rollout_percent,30,'channel policy rolls back with failed audit');
      const events=(await db.query(`SELECT details FROM callum_v2.events
        WHERE event_type='config_activated' AND config_version=$1`,[version])).rows;
      assert.equal(events.length,1);
      assert.deepEqual(events[0].details,{channel:'dev',status:'canary',rolloutPercent:30});
      const visible=(await control.overview()).events.filter(x=>Number(x.config_version)===version);
      assert.equal(visible.find(x=>x.event_type==='config_drafted')?.config_min_extension_version,CURRENT_EXTENSION_VERSION);
      assert.equal(visible.find(x=>x.event_type==='config_activated')?.config_channel,'dev');
      assert.equal(visible.find(x=>x.event_type==='config_activated')?.config_rollout_percent,'30');
      assert.equal(visible.some(x=>Object.hasOwn(x,'details')),false);
      assert.equal(JSON.stringify(visible).includes('button[aria-label'),false,'selector payload stays private');
    }finally{
      if(previous)await control.activateConfig(Number(previous.active_config_version),'dev',Number(previous.rollout_percent)).catch(()=>{});
      await db.close();
    }
  });
