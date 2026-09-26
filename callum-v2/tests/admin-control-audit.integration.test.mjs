import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('operator policy, installation and kill-switch changes have one sanitized audit event each',
  {skip:!enabled,timeout:180000},async()=>{
    const db=openDatabase(),control=new ControlPlane(db);
    const operatorId=`v2audit_${randomUUID().slice(0,8)}`;
    const flagKey=`operator:${operatorId}`;
    try{
      await control.createOperator(operatorId,'dev',1);
      await control.createOperator(operatorId,'dev',1);
      await control.createOperator(operatorId,'canary',2);
      await control.createOperator(operatorId,'canary',2);
      await control.createOperator(operatorId,'dev',1);
      const failedAudit=new ControlPlane({...db,tx:fn=>db.tx(q=>fn({query:(sql,args)=>{
        if(sql.includes('INSERT INTO callum_v2.events'))throw new Error('AUDIT_INJECTED_FAILURE');
        return q.query(sql,args);
      }}))});
      await assert.rejects(()=>failedAudit.createOperator(operatorId,'stable',3),/AUDIT_INJECTED_FAILURE/);
      const unchanged=(await db.query('SELECT cohort,daily_connection_limit FROM callum_v2.operators WHERE id=$1',
        [operatorId])).rows[0];
      assert.equal(unchanged.cohort,'dev');
      assert.equal(unchanged.daily_connection_limit,1,'policy update rolls back with failed audit');
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
      const configured=(await db.query(`SELECT details FROM callum_v2.events
        WHERE operator_id=$1 AND event_type='operator_configured' ORDER BY created_at,id`,[operatorId])).rows;
      assert.deepEqual(configured.map(x=>[x.details.cohort,x.details.dailyLimit]).sort(),
        [['dev',1],['canary',2],['dev',1]].sort(),'create and two changes each audit once');
      const visible=(await control.overview()).events.filter(x=>x.operator_id===operatorId);
      const visibleFlags=visible.filter(x=>x.event_type==='feature_flag_changed');
      assert.deepEqual(visibleFlags.map(x=>[x.flag_key,x.flag_disabled]).sort(),[[flagKey,'false'],[flagKey,'true']]);
      assert.deepEqual(visible.filter(x=>x.event_type==='operator_configured')
        .map(x=>[x.operator_cohort,x.operator_daily_limit]).sort(),
        [['dev','1'],['canary','2'],['dev','1']].sort());
      assert.equal(visibleFlags.some(x=>Object.hasOwn(x,'details')),false);
      assert.equal(JSON.stringify(visible).includes(issued.token),false);
    }finally{
      await control.setFlag(flagKey,false).catch(()=>{});
      await control.disableOperator(operatorId,true).catch(()=>{});
      await db.close();
    }
  });
