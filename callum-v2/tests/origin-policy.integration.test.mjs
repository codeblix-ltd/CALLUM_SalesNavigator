import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('staging server permits only the configured browser origins', {skip:!enabled},async()=>{
  const port=30000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${port}`;
  const extension='chrome-extension://blkkihmcpjhihcfihfoijkgnmfpeigbd';
  const other='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const web='https://lead-v2.careeraccelerator.net';
  const server=spawn(process.execPath,['apps/control-plane/server.mjs'],{
    cwd:fileURLToPath(new URL('../',import.meta.url)),
    env:{...process.env,V2_PORT:String(port),V2_BIND_HOST:'127.0.0.1',V2_ENVIRONMENT:'staging',
      V2_WEB_ORIGIN:web,V2_EXTENSION_ORIGIN:extension,V2_ADMIN_TOKEN:randomBytes(32).toString('hex')},
    stdio:'ignore',windowsHide:true
  });
  try{
    let ready=false;
    for(let i=0;i<80;i++){
      if(server.exitCode!==null)throw new Error('STAGING_SERVER_START_FAILED');
      try{if((await fetch(`${base}/api/health`)).ok){ready=true;break;}}catch{}
      await delay(250);
    }
    assert.equal(ready,true,'staging server starts with exact origins');
    for(const origin of [web,extension]){
      const response=await fetch(`${base}/api/health`,{headers:{origin}});
      assert.equal(response.status,200,origin);
      assert.equal(response.headers.get('access-control-allow-origin'),origin);
    }
    for(const origin of [other,`${extension}/popup.html`,'http://localhost:8788']){
      const response=await fetch(`${base}/api/health`,{headers:{origin}});
      assert.equal(response.status,403,origin);
      assert.equal(response.headers.get('access-control-allow-origin'),null);
    }
  }finally{
    if(server.exitCode===null){
      const closed=once(server,'exit');
      server.kill();
      await Promise.race([closed,delay(10000,null,{ref:false}).then(()=>{throw new Error('STAGING_SERVER_STOP_TIMEOUT')})]);
    }
  }
});
