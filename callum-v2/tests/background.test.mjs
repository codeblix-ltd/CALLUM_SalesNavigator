import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../packages/linkedin-config/index.mjs';

const files={};for(const name of ['build-info.js','config.js','background.js'])files[name]=await readFile(new URL(`../extension/${name}`,import.meta.url),'utf8');
function worker({storage,fetchImpl,tabQuery=async()=>[],sendMessage=async()=>null}){
  let listener,fetchCount=0,tabCount=0;
  const sandbox={setTimeout,clearTimeout,URL,Date,fetch:async(...args)=>{fetchCount++;return fetchImpl(...args)},
    chrome:{storage:{local:{get:storage}},alarms:{create(){},onAlarm:{addListener(){}}},runtime:{id:'test',getManifest:()=>({version:'2.4.0'}),
      onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(fn){listener=fn}}},tabs:{query:async()=>{tabCount++;return tabQuery()},create:async()=>{tabCount++;return {id:1}},sendMessage,onUpdated:{addListener(){},removeListener(){}},onRemoved:{addListener(){},removeListener(){}}}}};
  sandbox.globalThis=sandbox;vm.createContext(sandbox);
  sandbox.importScripts=(...names)=>{for(const name of names)vm.runInContext(files[name],sandbox)};
  vm.runInContext(files['background.js'],sandbox);
  return {poll:()=>new Promise(resolve=>listener({kind:'V2_POLL'},null,resolve)),counts:()=>({fetchCount,tabCount})};
}
test('local storage failure pauses before backend or browser action',async()=>{
  const x=worker({storage:async()=>{throw new Error('quota exceeded')},fetchImpl:async()=>{throw new Error('should not fetch')}});
  const result=await x.poll();assert.equal(result.error,'STORAGE_UNAVAILABLE');assert.deepEqual(x.counts(),{fetchCount:0,tabCount:0});
});
test('backend outage pauses before opening a tab',async()=>{
  const x=worker({storage:async()=>({v2Token:'a'.repeat(40),v2Environment:'local'}),fetchImpl:async()=>{throw new Error('network down')}});
  const result=await x.poll();assert.equal(result.error,'BACKEND_UNAVAILABLE');assert.deepEqual(x.counts(),{fetchCount:1,tabCount:0});
});
test('navigation failure before content primitive is reported as not submitted',async()=>{
  let ack=null;
  const command={id:'a',type:'EXECUTE_CONNECT',protocolVersion:1,configVersion:1,
    targetUrl:'https://www.linkedin.com/in/qa-test/',expiresAt:new Date(Date.now()+60000).toISOString(),actionIntentId:'intent'};
  const reply=value=>({ok:true,json:async()=>value});
  const x=worker({storage:async()=>({v2Token:'a'.repeat(40),v2Environment:'local'}),
    tabQuery:async()=>{throw new Error('TAB_CLOSED')},
    fetchImpl:async(url,options)=>{
      if(url.endsWith('/api/installation'))return reply({id:'install'});
      if(url.endsWith('/api/commands/claim'))return reply({command,config:{version:1,value:DEFAULT_CONFIG}});
      if(url.endsWith('/ack')){ack=JSON.parse(options.body);return reply({stage:'paused'});}
      throw new Error('unexpected request');
    }});
  const result=await x.poll();
  assert.equal(result.state,'waiting');
  assert.equal(ack.status,'not_submitted');
  assert.equal(x.counts().tabCount,1);
});
test('withdrawal navigation failure cannot reach authorization or a click',async()=>{
  let ack=null,authorizations=0;
  const command={id:'w',type:'EXECUTE_WITHDRAW',protocolVersion:1,configVersion:1,
    targetUrl:'https://www.linkedin.com/mynetwork/invitation-manager/sent/',
    expiresAt:new Date(Date.now()+60000).toISOString(),actionIntentId:'intent'};
  const reply=value=>({ok:true,json:async()=>value});
  const x=worker({storage:async()=>({v2Token:'a'.repeat(40),v2Environment:'local'}),
    tabQuery:async()=>{throw new Error('TAB_CLOSED')},
    fetchImpl:async(url,options)=>{
      if(url.endsWith('/api/installation'))return reply({id:'install'});
      if(url.endsWith('/api/commands/claim'))return reply({command,config:{version:1,value:DEFAULT_CONFIG}});
      if(url.endsWith('/authorize')){authorizations++;return reply({authorized:true});}
      if(url.endsWith('/ack')){ack=JSON.parse(options.body);return reply({stage:'paused'});}
      throw new Error('unexpected request');
    }});
  const result=await x.poll();
  assert.equal(result.state,'waiting');
  assert.equal(ack.status,'not_submitted');
  assert.equal(authorizations,0);
});
test('comment navigation failure cannot reach authorization or a click',async()=>{
  let ack=null,authorizations=0;
  const command={id:'c',type:'EXECUTE_COMMENT',protocolVersion:1,configVersion:1,
    targetUrl:'https://www.linkedin.com/feed/update/urn:li:activity:123',payload:{postUrl:'https://www.linkedin.com/feed/update/urn:li:activity:123'},expiresAt:new Date(Date.now()+60000).toISOString(),actionIntentId:'intent'};
  const reply=value=>({ok:true,json:async()=>value});
  const x=worker({storage:async()=>({v2Token:'a'.repeat(40),v2Environment:'local'}),
    tabQuery:async()=>{throw new Error('TAB_CLOSED')},
    fetchImpl:async(url,options)=>{
      if(url.endsWith('/api/installation'))return reply({id:'install'});
      if(url.endsWith('/api/commands/claim'))return reply({command,config:{version:1,value:DEFAULT_CONFIG}});
      if(url.endsWith('/authorize')){authorizations++;return reply({authorized:true});}
      if(url.endsWith('/ack')){ack=JSON.parse(options.body);return reply({stage:'paused'});}
      throw new Error('unexpected request');
    }});
  assert.equal((await x.poll()).state,'waiting');
  assert.equal(ack.status,'not_submitted');
  assert.equal(authorizations,0);
});
test('service worker restart after an ACK network loss never repeats the action primitive',async()=>{
  const command={id:'lost-ack',type:'EXECUTE_CONNECT',protocolVersion:1,configVersion:1,
    targetUrl:'https://www.linkedin.com/in/qa-test/',expiresAt:new Date(Date.now()+60000).toISOString(),actionIntentId:'intent'};
  const reply=value=>({ok:true,json:async()=>value});
  let claims=0,authorizations=0,clicks=0;
  const fetchImpl=async url=>{
    if(url.endsWith('/api/installation'))return reply({id:'install'});
    if(url.endsWith('/api/commands/claim'))return reply({command:++claims===1?command:null,config:{version:1,value:DEFAULT_CONFIG}});
    if(url.endsWith('/authorize')){authorizations++;return reply({authorized:true});}
    if(url.endsWith('/ack'))throw new Error('network lost after click');
    throw new Error('unexpected request');
  };
  const options={storage:async()=>({v2Token:'a'.repeat(40),v2Environment:'local'}),fetchImpl,
    tabQuery:async()=>[{id:7,url:command.targetUrl,status:'complete'}],
    sendMessage:async(_tabId,message)=>{clicks++;return {commandId:message.command.id,status:'confirmed',facts:{pendingVisible:true}};}};
  const first=worker(options);
  assert.equal((await first.poll()).state,'paused');
  const restarted=worker(options);
  assert.equal((await restarted.poll()).state,'waiting');
  assert.equal(clicks,1);assert.equal(authorizations,1);assert.equal(claims,2);
});
test('authorization network loss before the primitive reports not submitted',async()=>{
  const command={id:'authorize-lost',type:'EXECUTE_COMMENT',protocolVersion:1,configVersion:1,
    targetUrl:'https://www.linkedin.com/feed/update/urn:li:activity:123',payload:{postUrl:'https://www.linkedin.com/feed/update/urn:li:activity:123'},expiresAt:new Date(Date.now()+60000).toISOString(),actionIntentId:'intent'};
  const reply=value=>({ok:true,json:async()=>value});let clicks=0,ack=null;
  const x=worker({storage:async()=>({v2Token:'a'.repeat(40),v2Environment:'local'}),
    tabQuery:async()=>[{id:7,url:command.targetUrl,status:'complete'}],
    sendMessage:async()=>{clicks++;return null;},
    fetchImpl:async(url,options)=>{
      if(url.endsWith('/api/installation'))return reply({id:'install'});
      if(url.endsWith('/api/commands/claim'))return reply({command,config:{version:1,value:DEFAULT_CONFIG}});
      if(url.endsWith('/authorize'))throw new Error('authorization network lost');
      if(url.endsWith('/ack')){ack=JSON.parse(options.body);return reply({stage:'paused'});}
      throw new Error('unexpected request');
    }});
  assert.equal((await x.poll()).state,'waiting');
  assert.equal(ack.status,'not_submitted');assert.equal(clicks,0);
});

for(const interruption of ['tab closes','page refreshes']){
  test(`${interruption} after action dispatch is uncertain and is not dispatched again`,async()=>{
    const command={id:`interrupted-${interruption.replaceAll(' ','-')}`,type:'EXECUTE_CONNECT',protocolVersion:1,configVersion:1,
      targetUrl:'https://www.linkedin.com/in/qa-test/',expiresAt:new Date(Date.now()+60000).toISOString(),actionIntentId:'intent'};
    const reply=value=>({ok:true,json:async()=>value});
    let claims=0,authorizations=0,dispatches=0;
    const acknowledgements=[];
    const x=worker({storage:async()=>({v2Token:'a'.repeat(40),v2Environment:'local'}),
      tabQuery:async()=>[{id:7,url:command.targetUrl,status:'complete'}],
      sendMessage:async()=>{
        dispatches++;
        throw new Error(interruption==='tab closes' ? 'No tab with id: 7' : 'The message port closed before a response was received.');
      },
      fetchImpl:async(url,options)=>{
        if(url.endsWith('/api/installation'))return reply({id:'install'});
        if(url.endsWith('/api/commands/claim'))return reply({command:++claims===1?command:null,config:{version:1,value:DEFAULT_CONFIG}});
        if(url.endsWith('/authorize')){authorizations++;return reply({authorized:true});}
        if(url.endsWith('/ack')){acknowledgements.push(JSON.parse(options.body));return reply({stage:'reconcile_required'});}
        throw new Error('unexpected request');
      }});
    assert.equal((await x.poll()).state,'waiting');
    assert.equal(acknowledgements.length,1);
    assert.equal(acknowledgements[0].commandId,command.id);
    assert.equal(acknowledgements[0].status,'uncertain');
    assert.equal(acknowledgements[0].facts.diagnosticCode,'UNEXPECTED_BROWSER_STATE');
    assert.equal((await x.poll()).state,'waiting');
    assert.equal(dispatches,1);
    assert.equal(authorizations,1);
    assert.equal(acknowledgements.length,1);
  });
}
