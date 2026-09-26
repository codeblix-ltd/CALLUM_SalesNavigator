import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('staging server enforces browser origins and authenticates before parsing bodies', {skip:!enabled},async()=>{
  const port=30000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${port}`;
  const adminToken=randomBytes(32).toString('hex');
  const extension='chrome-extension://blkkihmcpjhihcfihfoijkgnmfpeigbd';
  const other='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const web='https://lead-v2.careeraccelerator.net';
  const server=spawn(process.execPath,['apps/control-plane/server.mjs'],{
    cwd:fileURLToPath(new URL('../',import.meta.url)),
    env:{...process.env,V2_PORT:String(port),V2_BIND_HOST:'127.0.0.1',V2_ENVIRONMENT:'staging',
      V2_WEB_ORIGIN:web,V2_EXTENSION_ORIGIN:extension,V2_ADMIN_TOKEN:adminToken},
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
    const page=await fetch(`${base}/`);
    assert.equal(page.status,200);
    const pagePolicy=page.headers.get('content-security-policy');
    assert.match(pagePolicy,/connect-src [^;]*https:\/\/api-v2\.careeraccelerator\.net/);
    assert.match(pagePolicy,/frame-ancestors 'none'/);
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
    const malformed='{';
    const adminWithoutToken=await fetch(`${base}/api/admin/operators`,{
      method:'POST',headers:{'content-type':'application/json'},body:malformed
    });
    assert.equal(adminWithoutToken.status,401,'admin authentication precedes body parsing');
    const installationWithoutToken=await fetch(`${base}/api/commands/claim`,{
      method:'POST',headers:{'content-type':'application/json'},body:malformed
    });
    assert.equal(installationWithoutToken.status,401,'installation authentication precedes body parsing');
    const malformedAdmin=await fetch(`${base}/api/admin/operators`,{
      method:'POST',headers:{authorization:`Bearer ${adminToken}`,'content-type':'application/json'},body:malformed
    });
    assert.equal(malformedAdmin.status,400);
    assert.equal((await malformedAdmin.json()).error,'INVALID_JSON');
    const invalidShape=await fetch(`${base}/api/admin/operators`,{
      method:'POST',headers:{authorization:`Bearer ${adminToken}`,'content-type':'application/json'},body:'null'
    });
    assert.equal(invalidShape.status,400);
    assert.equal((await invalidShape.json()).error,'BODY_INVALID');
    const operatorId=`v2http_${randomUUID().slice(0,8)}`;
    const adminHeaders={authorization:`Bearer ${adminToken}`,'content-type':'application/json'};
    const created=await fetch(`${base}/api/admin/operators`,{
      method:'POST',headers:adminHeaders,body:JSON.stringify({id:operatorId,cohort:'dev',dailyLimit:1})
    });
    assert.equal(created.status,200,'valid authenticated admin JSON still reaches the control plane');
    const diagnosticPath=`${base}/api/admin/diagnostics?operatorId=${operatorId}`;
    assert.equal((await fetch(diagnosticPath)).status,401,'diagnostic history requires admin auth');
    const diagnosticPage=await fetch(diagnosticPath,{headers:adminHeaders});
    assert.equal(diagnosticPage.status,200);
    assert.deepEqual(await diagnosticPage.json(),{items:[],nextCursor:null});
    const excessiveDiagnostics=await fetch(`${diagnosticPath}&limit=101`,{headers:adminHeaders});
    assert.equal(excessiveDiagnostics.status,400);
    assert.equal((await excessiveDiagnostics.json()).error,'DIAGNOSTIC_PAGE_INVALID');
    const issuedResponse=await fetch(`${base}/api/admin/installations`,{
      method:'POST',headers:adminHeaders,
      body:JSON.stringify({operatorId,extensionVersion:'2.5.2',buildSha:'d82031cc'})
    });
    assert.equal(issuedResponse.status,200);
    const issued=await issuedResponse.json();
    const claimed=await fetch(`${base}/api/commands/claim`,{
      method:'POST',headers:{authorization:`Bearer ${issued.token}`,'content-type':'application/json'},body:'{}'
    });
    assert.equal(claimed.status,200,'valid authenticated installation JSON still reaches claim');
    assert.equal((await claimed.json()).command,null);
    const revoked=await fetch(`${base}/api/admin/installations/revoke`,{
      method:'POST',headers:adminHeaders,body:JSON.stringify({id:issued.id})
    });
    assert.equal(revoked.status,200);
    const disabled=await fetch(`${base}/api/admin/operators/disable`,{
      method:'POST',headers:adminHeaders,body:JSON.stringify({id:operatorId,disabled:true})
    });
    assert.equal(disabled.status,200);
  }finally{
    if(server.exitCode===null){
      const closed=once(server,'exit');
      server.kill();
      await Promise.race([closed,delay(10000,null,{ref:false}).then(()=>{throw new Error('STAGING_SERVER_STOP_TIMEOUT')})]);
    }
  }
});
