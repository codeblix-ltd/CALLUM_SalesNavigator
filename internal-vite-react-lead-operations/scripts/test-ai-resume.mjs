import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../chrome-extension/convex-client.js',import.meta.url),'utf8');
let now=0,attempts=0,oldPolls=0,newPolls=0;
const paths=[];
class Clock extends Date {static now(){return now;}}
const env={Date:Clock,AbortController,LEADS_EXTENSION_CONFIG:{CONVEX_URL:'https://example.convex.cloud'},chrome:{storage:{local:{get:async()=>({callumScoutAuth:{username:'test',token:'t',refreshToken:'r'}})}}},
  setTimeout:(cb,ms)=>{if(ms<45000){now+=ms;queueMicrotask(cb);}return 1;},clearTimeout(){},
  fetch:async(_url,opts)=>{const body=JSON.parse(opts.body);paths.push(body.path);let value;
    if(body.path==='scoutAi:classifyLanguages'){
      if(++attempts===1)return{ok:true,status:200,json:async()=>({status:'error',errorMessage:'An AI check is already running for this scout. Wait for it to finish before retrying.'})};
      value={jobId:'new-language',generation:'new'};
    }else if(body.path==='scoutAiJobs:active')value={jobId:'old-comment',generation:'old'};
    else if(body.path==='scoutAiJobs:get'&&body.args[0].jobId==='old-comment')value=++oldPolls===1?{status:'pending',expiresAt:10000}:{status:'complete',result:'{"draft":"WRONG STAGE"}'};
    else{newPolls++;value={status:'complete',result:'{"results":[{"status":"english"}]}'};}
    return{ok:true,status:200,json:async()=>({status:'success',value})};
  }};
vm.runInNewContext(source,env);
const result=await env.ScoutApi.authenticatedAction('scouts:classifyLanguages',{leadId:'lead',context:'profile',samples:[]});
assert.equal(result.results[0].status,'english');assert.equal(result.draft,undefined);
assert.equal(attempts,2);assert.equal(oldPolls,2);assert.equal(newPolls,1);
assert.equal(paths.filter(x=>x==='scoutAi:draftComment').length,0,'must not launch another comment');
assert(now<120000);
console.log('AI resume: waits for earlier stage, no conflicting worker, no wrong-stage result, bounded time.');

// The outer watchdog also covers a stalled fetch or authentication recovery,
// not only the polling loop's own clock checks.
let watchdog;
let watchdogCleared = false;
const stalled = {
  ...env, Date,
  fetch: () => new Promise(() => {}),
  setTimeout: (callback, ms) => {
    if (ms === 120000) watchdog = callback;
    return ms;
  },
  clearTimeout: id => { if (id === 120000) watchdogCleared = true; },
};
vm.runInNewContext(source, stalled);
const pending = stalled.ScoutApi.authenticatedAction('scouts:draftComment', { leadId: 'lead' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(typeof watchdog, 'function');
const timedOut = assert.rejects(pending, /writing service is taking longer/);
watchdog();
await timedOut;
assert.equal(watchdogCleared, true);

let publicSaveCalls = 0;
const identity = {
  ...env,
  fetch: async () => { publicSaveCalls++; throw new Error('Must not save as another scout'); },
};
vm.runInNewContext(source, identity);
await assert.rejects(identity.ScoutApi.authenticatedAction('scouts:recordPostActivity', {}, { expectedUsername: 'someone-else' }), /session changed/);
assert.equal(publicSaveCalls, 0);
console.log('AI watchdog and receipt-save account isolation passed.');
