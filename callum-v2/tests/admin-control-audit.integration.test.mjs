import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('operator, installation and kill-switch changes have one sanitized audit event each',
  {skip:!enabled,timeout:180000},async()=>{
    const db=openDatabase(),control=new ControlPlane(db);
    const operatorId=`v2audit_${randomUUID().slice(0,8)}`;
    const flagKey=`operator:${operatorId}`;
    try{
      await control.createOperator(operatorId,'dev',1);
      const issued=await control.createInstallation(operatorId,'2.5.2','aaf758d4');
      assert.equal((await control.disableOperator(operatorId,true)).changed,true);
      assert.equal((await control.disableOperator(operatorId,true)).changed,false);
      await assert.rejects(()=>control.installation(issued.token),/UNAUTHORIZED/);
      assert.equal((await control.disableOperator(operatorId,false)).changed,true);
      await assert.rejects(()=>control.disableOperator(operatorId,undefined),/OPERATOR_INVALID/);

      assert.equal((await control.setFlag(flagKey,true)).changed,true);
      assert.equal((await control.setFlag(flagKey,true)).changed,false);
      await assert.rejects(()=>control.setFlag(flagKey,undefined),/FLAG_INVALID/);
      assert.equal((await control.setFlag(flagKey,false)).changed,true);
      assert.equal((await control.revokeInstallation(issued.id)).changed,true);
      assert.equal((await control.revokeInstallation(issued.id)).changed,false);
      await assert.rejects(()=>control.installation(issued.token),/UNAUTHORIZED/);
      await assert.rejects(()=>control.rotateInstallationToken(issued.id),/INSTALLATION_NOT_FOUND/);

      const rows=(await db.query(`SELECT event_type,installation_id,details FROM callum_v2.events
        WHERE operator_id=$1 AND event_type IN ('operator_disabled','operator_enabled','feature_flag_changed','installation_revoked')
        ORDER BY created_at,id`,[operatorId])).rows;
      assert.deepEqual(rows.map(x=>x.event_type).sort(),[
        'feature_flag_changed','feature_flag_changed','installation_revoked','operator_disabled','operator_enabled'
      ]);
      assert.deepEqual(rows.filter(x=>x.event_type==='feature_flag_changed').map(x=>x.details.disabled).sort(),[false,true]);
      assert.equal(rows.find(x=>x.event_type==='installation_revoked')?.installation_id,issued.id);
      assert.equal(JSON.stringify(rows).includes(issued.token),false);
      const visible=(await control.overview()).events.filter(x=>x.operator_id===operatorId);
      const visibleFlags=visible.filter(x=>x.event_type==='feature_flag_changed');
      assert.deepEqual(visibleFlags.map(x=>[x.flag_key,x.flag_disabled]).sort(),[[flagKey,'false'],[flagKey,'true']]);
      assert.equal(visibleFlags.some(x=>Object.hasOwn(x,'details')),false);
      assert.equal(JSON.stringify(visible).includes(issued.token),false);
    }finally{
      await control.setFlag(flagKey,false).catch(()=>{});
      await control.disableOperator(operatorId,true).catch(()=>{});
      await db.close();
    }
  });
