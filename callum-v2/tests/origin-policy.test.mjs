import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginPolicy} from '../apps/control-plane/origin-policy.mjs';

const extension='chrome-extension://blkkihmcpjhihcfihfoijkgnmfpeigbd';
const other='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const web='https://lead-v2.careeraccelerator.net';

test('staging requires an exact web and extension origin',()=>{
  const policy=createOriginPolicy({environment:'staging',webOrigin:web,extensionOrigin:extension,bindHost:'0.0.0.0',port:8788});
  assert.equal(policy.allows(web),true);
  assert.equal(policy.allows(extension),true);
  for(const origin of [other,`${extension}/popup.html`,'http://localhost:8788','https://lead.careeraccelerator.net','null']){
    assert.equal(policy.allows(origin),false,origin);
  }
  assert.throws(()=>createOriginPolicy({environment:'staging',webOrigin:web,extensionOrigin:'',bindHost:'0.0.0.0',port:8788}),/V2_EXTENSION_ORIGIN_REQUIRED/);
  assert.throws(()=>createOriginPolicy({environment:'staging',webOrigin:'http://lead-v2.careeraccelerator.net',extensionOrigin:extension,bindHost:'0.0.0.0',port:8788}),/V2_WEB_ORIGIN_INVALID/);
  assert.throws(()=>createOriginPolicy({environment:'staging',webOrigin:`${web}/`,extensionOrigin:extension,bindHost:'0.0.0.0',port:8788}),/V2_WEB_ORIGIN_INVALID/);
});

test('local API stays loopback-bound and accepts isolated extension origins',()=>{
  const policy=createOriginPolicy({environment:'local',webOrigin:'http://localhost:8788',extensionOrigin:'',bindHost:'127.0.0.1',port:8788});
  assert.equal(policy.allows(extension),true);
  assert.equal(policy.allows(other),true);
  assert.equal(policy.allows('https://lead-v2.careeraccelerator.net'),false);
  assert.throws(()=>createOriginPolicy({environment:'local',webOrigin:'http://localhost:8788',extensionOrigin:'',bindHost:'0.0.0.0',port:8788}),/V2_LOCAL_BIND_INVALID/);
  assert.throws(()=>createOriginPolicy({environment:'local',webOrigin:'http://localhost:8788',extensionOrigin:'chrome-extension://invalid',bindHost:'127.0.0.1',port:8788}),/V2_EXTENSION_ORIGIN_INVALID/);
});
