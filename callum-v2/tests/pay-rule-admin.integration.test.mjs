import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../apps/control-plane/db.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('pay-rule administration is versioned, auditable and reversible without a DB edit',
  {skip:!enabled,timeout:180000},async()=>{
    const db=openDatabase(),adminToken=randomBytes(32).toString('hex');
    const version=Number(String(Date.now()).slice(-12));
    const positiveFixtureVersion=version+1;
    const port=20000+Math.floor(Math.random()*10000),origin=`http://127.0.0.1:${port}`;
    let server=null,positiveFixtureCreated=false;
    try{
      server=spawn(process.execPath,['apps/control-plane/server.mjs'],{
        cwd:fileURLToPath(new URL('../',import.meta.url)),
        env:{...process.env,V2_PORT:String(port),V2_BIND_HOST:'127.0.0.1',V2_WEB_ORIGIN:origin,
          V2_ADMIN_TOKEN:adminToken},stdio:'ignore',windowsHide:true
      });
      let ready=false;
      for(let i=0;i<80;i++){
        if(server.exitCode!==null)throw new Error('BACKEND_START_FAILED');
        try{if((await fetch(`${origin}/api/health`)).ok){ready=true;break;}}catch{}
        await delay(250);
      }
      assert.equal(ready,true);
      const post=(path,payload,token=adminToken)=>fetch(`${origin}${path}`,{
        method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
        body:JSON.stringify(payload),cache:'no-store'
      });
      const getPay=(id,token=adminToken)=>fetch(`${origin}/api/admin/pay/${id}`,{
        headers:{authorization:`Bearer ${token}`},cache:'no-store'
      });
      assert.equal((await getPay('00000000-0000-4000-8000-000000000000','wrong-token')).status,401);
      assert.equal((await getPay('abc')).status,400);
      assert.equal((await getPay('00000000-0000-4000-8000-000000000000')).status,404);
      const rule={version,eventType:'connection_confirmed',amountMinor:0,currency:'USD',enabled:false};
      assert.equal((await post('/api/admin/pay-rules',rule,'wrong-token')).status,401);
      assert.equal((await post('/api/admin/pay-rules',{...rule,version:Number.MAX_SAFE_INTEGER+1})).status,400);
      assert.equal((await post('/api/admin/pay-rules',{...rule,enabled:undefined})).status,400);
      const rejectedPositive=await post('/api/admin/pay-rules',
        {...rule,version:positiveFixtureVersion,amountMinor:1,currency:'XTS',enabled:true});
      assert.equal(rejectedPositive.status,400);
      assert.equal((await rejectedPositive.json()).error,'PAY_POLICY_NOT_APPROVED');
      assert.equal((await db.query('SELECT count(*)::INT4 AS n FROM callum_v2.pay_rules WHERE version=$1',
        [positiveFixtureVersion])).rows[0].n,0);
      const fixture=await db.query(`INSERT INTO callum_v2.pay_rules(version,event_type,amount_minor,currency,enabled)
        VALUES ($1,'connection_confirmed',1,'XTS',false) ON CONFLICT DO NOTHING`,[positiveFixtureVersion]);
      assert.equal(fixture.rowCount,1);
      positiveFixtureCreated=true;
      const blockedEnable=await post('/api/admin/pay-rules/status',{version:positiveFixtureVersion,enabled:true});
      assert.equal(blockedEnable.status,400);
      assert.equal((await blockedEnable.json()).error,'PAY_POLICY_NOT_APPROVED');
      assert.equal((await db.query('SELECT enabled FROM callum_v2.pay_rules WHERE version=$1',
        [positiveFixtureVersion])).rows[0].enabled,false);
      const created=await post('/api/admin/pay-rules',rule);
      assert.equal(created.status,200);
      assert.equal((await created.json()).version,version);
      const duplicate=await post('/api/admin/pay-rules',rule);
      assert.equal(duplicate.status,400);
      assert.equal((await duplicate.json()).error,'PAY_RULE_EXISTS');
      const enable=await post('/api/admin/pay-rules/status',{version,enabled:true});
      assert.equal(enable.status,200);
      assert.equal((await enable.json()).changed,true);
      assert.equal((await (await post('/api/admin/pay-rules/status',{version,enabled:true})).json()).changed,false);
      const disable=await post('/api/admin/pay-rules/status',{version,enabled:false});
      assert.equal(disable.status,200);
      assert.equal((await disable.json()).changed,true);

      const overview=await fetch(`${origin}/api/admin/overview`,{
        headers:{authorization:`Bearer ${adminToken}`},cache:'no-store'
      });
      assert.equal(overview.status,200);
      const visible=await overview.json();
      const saved=visible.payRules.find(x=>Number(x.version)===version);
      assert.equal(saved?.enabled,false);
      assert.equal(Number(saved?.amount_minor),0);
      const events=visible.events.filter(x=>Number(x.pay_rule_version)===version);
      assert.deepEqual(events.map(x=>x.event_type).sort(),['pay_rule_created','pay_rule_disabled','pay_rule_enabled']);
      assert.equal(events.some(x=>Object.hasOwn(x,'details')),false);
      assert.equal(JSON.stringify(visible).includes(adminToken),false);
      const stored=(await db.query(`SELECT event_type,details FROM callum_v2.events
        WHERE event_key LIKE $1 ORDER BY created_at,id`,[`pay_rule:${version}:%`])).rows;
      assert.equal(stored.length,3);
      assert.equal(JSON.stringify(stored).includes(adminToken),false);
      assert.equal((await db.query('SELECT count(*)::INT4 AS n FROM callum_v2.pay_ledger WHERE pay_rule_version=$1',[version])).rows[0].n,0);
    }finally{
      await db.query('UPDATE callum_v2.pay_rules SET enabled=false WHERE version=$1',[version]).catch(()=>{});
      if(positiveFixtureCreated)await db.query('DELETE FROM callum_v2.pay_rules WHERE version=$1',
        [positiveFixtureVersion]).catch(()=>{});
      if(server?.exitCode===null){
        const closed=once(server,'exit');server.kill();
        await Promise.race([closed,delay(10000,null,{ref:false}).then(()=>{throw new Error('BACKEND_STOP_TIMEOUT')})]);
      }
      await db.close();
    }
  });
