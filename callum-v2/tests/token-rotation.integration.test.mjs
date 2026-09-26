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

test('installation token rotation preserves the installation and immediately invalidates old tokens', {skip:!enabled},async()=>{
  const db=openDatabase(),control=new ControlPlane(db);
  const operatorId=`v2rotate_${randomUUID().slice(0,8)}`;
  try{
    await control.seed();await control.createOperator(operatorId,'dev',1);
    const issued=await control.createInstallation(operatorId,'2.5.1','3b013703');
    const before=await control.installation(issued.token);
    await assert.rejects(()=>control.rotateInstallationToken('not-a-uuid'),/INSTALLATION_INVALID/);
    const rotated=await control.rotateInstallationToken(issued.id);
    assert.equal(rotated.id,issued.id);assert.equal(rotated.operator_id,operatorId);
    assert.notEqual(rotated.token,issued.token);
    await assert.rejects(()=>control.installation(issued.token),/UNAUTHORIZED/);
    await assert.rejects(()=>control.claim(before),/UNAUTHORIZED/,'a server object authenticated before rotation is stale');
    const after=await control.installation(rotated.token);
    assert.equal(after.id,before.id);
    assert.equal(after.actor_profile_key,before.actor_profile_key);
    const second=await control.rotateInstallationToken(issued.id);
    await assert.rejects(()=>control.installation(rotated.token),/UNAUTHORIZED/);
    assert.equal((await control.installation(second.token)).id,issued.id);
    const audit=(await db.query(`SELECT event_key,details FROM callum_v2.events
      WHERE installation_id=$1 AND event_type='installation_token_rotated'`,[issued.id])).rows;
    assert.equal(audit.length,2);
    assert.equal(JSON.stringify(audit).includes(rotated.token),false);
    assert.equal(JSON.stringify(audit).includes(second.token),false);
    const stored=(await db.query('SELECT token_hash FROM callum_v2.installations WHERE id=$1',[issued.id])).rows[0];
    assert.notEqual(stored.token_hash,second.token);
    await control.revokeInstallation(issued.id);
    await assert.rejects(()=>control.rotateInstallationToken(issued.id),/INSTALLATION_NOT_FOUND/);
    await assert.rejects(()=>control.installation(second.token),/UNAUTHORIZED/);
  }finally{await db.close();}
});

test('the admin rotation route requires admin auth and returns only the new token', {skip:!enabled},async()=>{
  const port=20000+Math.floor(Math.random()*10000),origin=`http://127.0.0.1:${port}`;
  const adminToken=randomBytes(32).toString('hex');
  const server=spawn(process.execPath,['apps/control-plane/server.mjs'],{
    cwd:fileURLToPath(new URL('../',import.meta.url)),
    env:{...process.env,V2_PORT:String(port),V2_BIND_HOST:'127.0.0.1',V2_WEB_ORIGIN:origin,V2_ADMIN_TOKEN:adminToken},
    stdio:'ignore',windowsHide:true
  });
  const post=async(path,payload,token)=>fetch(`${origin}${path}`,{
    method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify(payload),cache:'no-store'
  });
  try{
    let ready=false;
    for(let i=0;i<80;i++){
      if(server.exitCode!==null)throw new Error('BACKEND_START_FAILED');
      try{if((await fetch(`${origin}/api/health`)).ok){ready=true;break;}}catch{}
      await delay(250);
    }
    assert.equal(ready,true);
    const operatorId=`v2rotatehttp_${randomUUID().slice(0,8)}`;
    assert.equal((await post('/api/admin/operators',{id:operatorId,cohort:'dev',dailyLimit:1},adminToken)).status,200);
    const issuedResponse=await post('/api/admin/installations',{
      operatorId,extensionVersion:'2.5.1',buildSha:'3b013703'
    },adminToken);
    assert.equal(issuedResponse.status,200);
    const issued=await issuedResponse.json();
    assert.equal((await post('/api/admin/installations/rotate-token',{id:issued.id},'wrong-admin-token')).status,401);
    const rotatedResponse=await post('/api/admin/installations/rotate-token',{id:issued.id},adminToken);
    assert.equal(rotatedResponse.status,200);
    assert.equal(rotatedResponse.headers.get('cache-control'),'no-store');
    const rotated=await rotatedResponse.json();
    assert.equal(rotated.id,issued.id);assert.notEqual(rotated.token,issued.token);
    assert.equal((await fetch(`${origin}/api/installation`,{headers:{authorization:`Bearer ${issued.token}`}})).status,401);
    const identityResponse=await fetch(`${origin}/api/installation`,{headers:{authorization:`Bearer ${rotated.token}`}});
    assert.equal(identityResponse.status,200);
    assert.equal(Object.hasOwn(await identityResponse.json(),'token_hash'),false);
  }finally{
    if(server.exitCode===null){
      const closed=once(server,'exit');server.kill();
      await Promise.race([closed,delay(10000,null,{ref:false}).then(()=>{throw new Error('BACKEND_STOP_TIMEOUT')})]);
    }
  }
});
