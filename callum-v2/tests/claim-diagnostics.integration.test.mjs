import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('incompatible extension claims leave a bounded support event with version evidence', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db);
  const operatorId=`v2claimdiag_${randomUUID().slice(0,8)}`;
  try{
    await control.seed();await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.0.0','3016092d');
    const installation=await control.installation(issued.token);
    const active=(await db.query(`SELECT c.version,c.min_extension_version FROM callum_v2.release_channels r
      JOIN callum_v2.remote_configs c ON c.version=r.active_config_version WHERE r.channel='dev'`)).rows[0];
    assert.ok(active);
    for(let i=0;i<2;i++)await assert.rejects(()=>control.claim(installation),/CONFIG_INCOMPATIBLE/);
    const events=(await db.query(`SELECT event_type,operator_id,installation_id,extension_version,build_sha,
      config_version,diagnostic_code,details FROM callum_v2.events
      WHERE installation_id=$1 AND event_type='claim_rejected'`,[issued.id])).rows;
    assert.equal(events.length,1,'repeated polls are deduplicated within the hour');
    assert.equal(events[0].operator_id,operatorId);
    assert.equal(events[0].installation_id,issued.id);
    assert.equal(events[0].extension_version,'2.0.0');
    assert.equal(events[0].build_sha,'3016092d');
    assert.equal(Number(events[0].config_version),Number(active.version));
    assert.equal(events[0].diagnostic_code,'CONFIG_INCOMPATIBLE');
    assert.equal(events[0].details.minimumExtensionVersion,active.min_extension_version);
    const support=(await control.overview()).events.find(row=>row.installation_id===issued.id && row.event_type==='claim_rejected');
    assert.equal(support?.diagnostic_code,'CONFIG_INCOMPATIBLE');
  }finally{await db.close();}
});
