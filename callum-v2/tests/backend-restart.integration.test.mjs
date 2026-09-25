import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;
test('new backend process reconciles an authorized lost-ACK action without redelivery', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db);
  const operatorId=`v2restart_${randomUUID().slice(0,8)}`;
  const profileKey=`qa-backend-restart-${randomUUID().slice(0,8)}`;
  const port=20000+Math.floor(Math.random()*10000);
  const origin=`http://127.0.0.1:${port}`;
  let server=null;
  async function start(){
    server=spawn(process.execPath,['apps/control-plane/server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),
      env:{...process.env,V2_PORT:String(port),V2_BIND_HOST:'127.0.0.1',V2_WEB_ORIGIN:origin,V2_ADMIN_TOKEN:randomBytes(32).toString('hex'),V2_QA_PROFILE_KEY:profileKey},
      stdio:'ignore',windowsHide:true});
    for(let i=0;i<80;i++){
      if(server.exitCode!==null)throw new Error('BACKEND_START_FAILED');
      try{if((await fetch(`${origin}/api/health`)).ok)return server.pid;}catch{}
      await delay(250);
    }
    throw new Error('BACKEND_START_TIMEOUT');
  }
  async function stop(){
    const current=server;server=null;if(!current)return;
    if(current.exitCode===null){const closed=once(current,'exit');current.kill();await Promise.race([closed,delay(10000,null,{ref:false}).then(()=>{throw new Error('BACKEND_STOP_TIMEOUT')})]);}
  }
  const call=async(token,path,body)=>{
    const response=await fetch(`${origin}${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
      body:JSON.stringify(body),cache:'no-store'});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'BACKEND_REQUEST_FAILED');return data;
  };
  try{
    await control.seed();await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.5.0','b4e9668a');
    const installation=await control.installation(issued.token);
    const configVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const leadId=randomUUID();
    const run=(await db.query("INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version) VALUES ($1,$2,'live_canary',$3) RETURNING id",
      [operatorId,installation.id,configVersion])).rows[0];
    const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
    await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
      [run.id,leadId,profileKey,lead.linkedin_url]);
    await db.tx(q=>control.enqueue(q,{id:run.id,operator_id:operatorId,config_version:configVersion},lead,'INSPECT_PROFILE',`restart:${run.id}`));
    const initial=await control.claim(installation);
    await control.acknowledge(installation,{commandId:initial.command.id,status:'observed',facts:{profileMatched:true,
      profileKey,pageReady:true,connectAvailable:true,diagnosticCode:'OK'}});
    const firstPid=await start();
    const action=(await call(issued.token,'/api/commands/claim',{})).command;
    assert.equal(action.type,'EXECUTE_CONNECT');
    assert.equal((await call(issued.token,`/api/commands/${action.id}/authorize`,{})).authorized,true);
    await stop();
    await db.query("UPDATE callum_v2.commands SET lease_expires_at=now()-INTERVAL '1 second' WHERE id=$1",[action.id]);
    const secondPid=await start();assert.notEqual(firstPid,secondPid);
    const reconcile=(await call(issued.token,'/api/commands/claim',{})).command;
    assert.equal(reconcile.type,'INSPECT_PROFILE');assert.equal(reconcile.payload.reconcile,true);
    assert.equal((await db.query("SELECT count(*)::INT4 n FROM callum_v2.commands WHERE run_id=$1 AND type='EXECUTE_CONNECT'",[run.id])).rows[0].n,1);
    const result=await call(issued.token,`/api/commands/${reconcile.id}/ack`,{commandId:reconcile.id,status:'observed',facts:{
      profileMatched:true,profileKey,pageReady:true,pendingVisible:true,diagnosticCode:'ALREADY_PENDING'}});
    assert.equal(result.stage,'completed');
    assert.equal((await db.query('SELECT state FROM callum_v2.action_intents WHERE run_id=$1',[run.id])).rows[0].state,'confirmed');
    assert.equal((await call(issued.token,'/api/commands/claim',{})).command,null);
  }finally{await stop().catch(()=>{});await db.close();}
});
