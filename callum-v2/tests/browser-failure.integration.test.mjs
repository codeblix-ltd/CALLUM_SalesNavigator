import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('browser failures replay once with scoped metadata and no page content', {skip:!enabled,timeout:180000},async()=>{
  const db=openDatabase(),control=new ControlPlane(db);
  const operatorId=`v2browserfail_${randomUUID().slice(0,8)}`;
  const port=20000+Math.floor(Math.random()*10000),origin=`http://127.0.0.1:${port}`;
  let server=null;
  try{
    await control.seed();
    await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.5.2','97fa90cb');
    const configVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const leadId=randomUUID(),profileKey=`qa-browser-failure-${leadId.slice(0,8)}`;
    const url=`https://www.linkedin.com/in/${profileKey}/`;
    const run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'synthetic',$3) RETURNING id",
      [operatorId,issued.id,configVersion])).rows[0];
    await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
      [run.id,leadId,profileKey,url]);
    const command=await db.tx(q=>control.enqueue(q,{id:run.id,operator_id:operatorId,config_version:configVersion},
      {id:leadId,profile_key:profileKey,linkedin_url:url},'INSPECT_PROFILE',`browser-failure:${run.id}`));
    await db.query("UPDATE callum_v2.commands SET status='leased',installation_id=$2 WHERE id=$1",[command.id,issued.id]);

    server=spawn(process.execPath,['apps/control-plane/server.mjs'],{
      cwd:fileURLToPath(new URL('../',import.meta.url)),
      env:{...process.env,V2_PORT:String(port),V2_BIND_HOST:'127.0.0.1',V2_WEB_ORIGIN:origin,
        V2_ADMIN_TOKEN:randomBytes(32).toString('hex')},stdio:'ignore',windowsHide:true
    });
    let ready=false;
    for(let i=0;i<80;i++){
      if(server.exitCode!==null)throw new Error('BACKEND_START_FAILED');
      try{if((await fetch(`${origin}/api/health`)).ok){ready=true;break;}}catch{}
      await delay(250);
    }
    assert.equal(ready,true);
    const post=(payload,token=issued.token)=>fetch(`${origin}/api/browser-failures`,{
      method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
      body:JSON.stringify(payload),cache:'no-store'
    });
    const occurredAt=new Date().toISOString();
    const outage={eventId:randomUUID(),stage:'installation',code:'BACKEND_UNAVAILABLE',commandId:null,
      occurredAt,pageHtml:'<private-page>',token:'must-not-store'};
    assert.equal((await post(outage)).status,200);
    assert.equal((await post(outage)).status,200,'replayed report is accepted idempotently');
    assert.equal((await post({...outage,eventId:randomUUID(),code:'ARBITRARY_CONTENT'})).status,400);
    assert.equal((await post({...outage,eventId:randomUUID(),commandId:randomUUID()})).status,400);
    assert.equal((await post({...outage,eventId:randomUUID()},'wrong-token')).status,401);
    const commandFailure={eventId:randomUUID(),stage:'ack',code:'BACKEND_UNAVAILABLE',commandId:command.id,occurredAt};
    assert.equal((await post(commandFailure)).status,200);
    const rows=(await db.query(`SELECT id,event_key,event_type,operator_id,installation_id,extension_version,build_sha,
      run_id,lead_id,command_id,config_version,diagnostic_code,details FROM callum_v2.events
      WHERE installation_id=$1 AND event_type='browser_failure' ORDER BY event_key`,[issued.id])).rows;
    assert.equal(rows.length,2);
    const preCommand=rows.find(row=>row.event_key.endsWith(outage.eventId));
    const scoped=rows.find(row=>row.event_key.endsWith(commandFailure.eventId));
    assert.equal(preCommand?.command_id,null);
    assert.equal(preCommand?.diagnostic_code,'BACKEND_UNAVAILABLE');
    assert.equal(scoped?.run_id,run.id);
    assert.equal(scoped?.lead_id,leadId);
    assert.equal(scoped?.command_id,command.id);
    assert.equal(Number(scoped?.config_version),configVersion);
    assert.equal(scoped?.extension_version,'2.5.2');
    assert.equal(scoped?.details.stage,'ack');
    assert.equal(JSON.stringify(rows).includes('<private-page>'),false);
    assert.equal(JSON.stringify(rows).includes(issued.token),false);
    const support=(await control.overview()).events.find(row=>row.id===scoped.id);
    assert.equal(support?.failure_stage,'ack');
    assert.equal(support?.reported_occurred_at,occurredAt);
  }finally{
    if(server?.exitCode===null){
      const closed=once(server,'exit');server.kill();
      await Promise.race([closed,delay(10000,null,{ref:false}).then(()=>{throw new Error('BACKEND_STOP_TIMEOUT')})]);
    }
    await db.close();
  }
});

test('concurrent browser failure reports respect the installation hourly cap', {skip:!enabled,timeout:180000},async()=>{
  const db=openDatabase(),otherDb=openDatabase(),control=new ControlPlane(db);
  const operatorId=`v2failurecap_${randomUUID().slice(0,8)}`;
  try{
    await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.5.2','bc97f360');
    const installation=await control.installation(issued.token);
    const prefix=`installation:${issued.id}:browser_failure:seed:${randomUUID()}`;
    await db.query(`INSERT INTO callum_v2.events(event_key,event_type,operator_id,installation_id)
      SELECT $1 || ':' || i::STRING,'browser_failure',$2,$3 FROM generate_series(1,29) AS g(i)`,
      [prefix,operatorId,issued.id]);
    const counts=[];
    let releaseCounts;
    const bothCounted=new Promise(resolve=>{releaseCounts=resolve;});
    const countedDb=base=>({
      tx:fn=>base.tx(q=>fn({query:async(sql,args)=>{
        const result=await q.query(sql,args);
        if(sql.includes('SELECT count(*)::INT4 AS n FROM callum_v2.events')&&counts.length<2){
          counts.push(Number(result.rows[0].n));
          if(counts.length===2)releaseCounts();
          await Promise.race([bothCounted,delay(15000,null,{ref:false}).then(()=>{throw new Error('COUNT_BARRIER_TIMEOUT');})]);
        }
        return result;
      }}))
    });
    const reporters=[new ControlPlane(countedDb(db)),new ControlPlane(countedDb(otherDb))];
    const report=reporter=>reporter.reportBrowserFailure(installation,{
      eventId:randomUUID(),stage:'claim',code:'BACKEND_UNAVAILABLE',occurredAt:new Date().toISOString()
    });
    const results=await Promise.all(reporters.map(report));
    assert.deepEqual(counts,[29,29],'both transactions saw the same pre-cap count before insertion');
    assert.equal(results.filter(x=>x.rateLimited).length,1);
    const count=(await db.query(`SELECT count(*)::INT4 AS n FROM callum_v2.events
      WHERE operator_id=$1 AND installation_id=$2 AND event_type='browser_failure'`,
      [operatorId,issued.id])).rows[0].n;
    assert.equal(count,30);
  }finally{ await db.close(); await otherDb.close(); }
});
