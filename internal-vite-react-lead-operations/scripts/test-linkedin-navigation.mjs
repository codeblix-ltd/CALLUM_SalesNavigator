import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const background=readFileSync(new URL('../chrome-extension/background.js',import.meta.url),'utf8');
const content=readFileSync(new URL('../chrome-extension/content.js',import.meta.url),'utf8');
const between=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const errorSource=between(background,'class LinkedInAccessInterruptionError','async function requestWorkflowControl');
const navigation=between(background,'function sendMessageToTab','function clampInteger');
const opaque='https://www.linkedin.com/in/ACwAAGHmBW4BBJ1iz-LC1V1wiuNVUhRzBdLTHWs';
const canonical='https://www.linkedin.com/in/benedict-koh-43a08439a';

function harness({url=opaque,status='complete',heartbeat=()=>null}={}) {
  let now=0,sequence=0,requests=0;
  const timers=new Map(),listeners=new Set(),updates=[];
  const tab={url,status};
  class Clock extends Date {static now(){return now;}}
  const sandbox={Date:Clock,URL,Error,Set,Math,LINKEDIN_TAB_LOAD_TIMEOUT_MS:90000,LINKEDIN_TAB_READY_PROBE_MS:1000,
    cleanError:e=>e.message||String(e),
    setTimeout:(callback,delay)=>{const id=++sequence;timers.set(id,{at:now+delay,callback});return id;},
    clearTimeout:id=>timers.delete(id),
    chrome:{runtime:{},tabs:{
      get:async()=>({...tab}),
      update:async(id,change)=>{updates.push(change.url);tab.url=change.url;return {...tab};},
      sendMessage:(_id,message,callback)=>{requests++;const result=heartbeat({...tab},message,now);if(result!=='never')callback(result);},
      onUpdated:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},
    }},
  };
  sandbox.sleep=ms=>new Promise(resolve=>sandbox.setTimeout(resolve,ms));
  vm.runInNewContext(errorSource+navigation,sandbox);
  async function settle(promise) {
    let done=false,result,error;
    promise.then(r=>{done=true;result=r;},e=>{done=true;error=e;});
    for(let i=0;i<500&&!done;i++) {
      await new Promise(resolve=>setImmediate(resolve));
      if(done)break;
      const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
      assert(next,'unsettled operation without a timer');
      now=next[1].at;timers.delete(next[0]);next[1].callback();
    }
    assert(done,'operation must be bounded');
    if(error)throw error;
    return result;
  }
  return {sandbox,tab,timers,listeners,updates,settle,get now(){return now;},get requests(){return requests;}};
}

const broken=harness();
await assert.rejects(broken.settle(broken.sandbox.waitForTabComplete(1,{expectedUrl:opaque})),/paused without skipping/);
assert(broken.requests>0,'complete browser error document must be probed');
assert(broken.now<=18000);assert.equal(broken.listeners.size,0);assert.equal(broken.timers.size,0);

const healthy=harness({status:'loading',heartbeat:t=>({url:t.url})});
await healthy.settle(healthy.sandbox.waitForTabComplete(1,{expectedUrl:opaque}));
assert.equal(healthy.now,0,'content ready need not wait for slow secondary resources');
assert.equal(healthy.timers.size,0);

const old=harness({heartbeat:()=>({url:'https://www.linkedin.com/in/someone-else'})});
await assert.rejects(old.settle(old.sandbox.waitForTabComplete(1,{expectedUrl:opaque,timeoutMs:10000})),/paused/);
const pending=harness({heartbeat:t=>({url:t.url})});
pending.tab.pendingUrl=canonical;
await assert.rejects(pending.settle(pending.sandbox.waitForTabComplete(1,{expectedUrl:canonical,timeoutMs:10000})),/paused/);

const hanging=harness({heartbeat:()=> 'never'});
await assert.rejects(hanging.settle(hanging.sandbox.waitForTabComplete(1,{expectedUrl:opaque,timeoutMs:10000})),/paused/);
await hanging.settle(new Promise(resolve=>hanging.sandbox.setTimeout(resolve,3000)));
assert.equal(hanging.timers.size,0,'late heartbeat timeout must release timers');
for (const heartbeat of [()=>null, ()=>'never', ()=>({url:canonical})]) {
  const recovery=harness({heartbeat});
  await assert.rejects(recovery.settle(recovery.sandbox.waitForContentScript(1,5000)),/paused without skipping/);
  assert(recovery.now<=8250,'content recovery must also be bounded');
  assert.equal(recovery.timers.size,0);
}
const recovered=harness({heartbeat:t=>({url:t.url})});
assert.equal((await recovered.settle(recovered.sandbox.waitForContentScript(1))).url,opaque);
for(const path of ['checkpoint/challenge','login']) {
  const login=harness({url:'https://www.linkedin.com/'+path});
  await assert.rejects(login.settle(login.sandbox.waitForTabComplete(1,{expectedUrl:opaque})),/security check|signed out/);
  assert.equal(login.requests,0);
}

const resolver=harness({heartbeat:(t,m)=>({url:t.url,resolvedProfileUrl:m.expectedProfileName==='Benedict Koh'?canonical:null})});
assert.equal(await resolver.settle(resolver.sandbox.waitForResolvedLinkedInProfileUrl(1,opaque,30000,'Benedict Koh')),canonical);
assert.deepEqual(resolver.updates,[canonical]);
assert(resolver.requests>=2,'verify fresh document after navigating');
const unknown=harness({heartbeat:t=>({url:t.url})});
await assert.rejects(unknown.settle(unknown.sandbox.waitForResolvedLinkedInProfileUrl(1,opaque,5000,'Benedict Koh')),/verified profile link/);
assert.equal(unknown.updates.length,0);

const helper=between(content,'  function getVerifiedProfileLink','  function getCurrentProfileName');
function linkFixture({name='Benedict Koh',links=[canonical+'/overlay/contact-info/'],sidebar=false,ambiguous=false}={}) {
  const heading={textContent:name,closest:()=>null};
  const linkNodes=links.map(href=>({href,closest:()=>sidebar?{}:null}));
  const main={querySelectorAll:()=>[heading]};
  const scope={parentElement:main,querySelectorAll:s=>s==='a[href]'?linkNodes:ambiguous?[heading,{textContent:'Someone else'}]:[heading]};
  heading.parentElement=scope;
  const env={URL,Set,window:{location:{pathname:new URL(opaque).pathname,origin:'https://www.linkedin.com'}},document:{querySelector:()=>main},
    isElementVisible:()=>true,personNamesMatch:(a,b)=>a.trim().toLowerCase()===b.trim().toLowerCase()};
  vm.runInNewContext(helper,env);
  return env.getVerifiedProfileLink('Benedict Koh');
}
assert.equal(linkFixture(),canonical);
assert.equal(linkFixture({name:'Someone else'}),null);
assert.equal(linkFixture({sidebar:true}),null);
assert.equal(linkFixture({ambiguous:true}),null);
assert.equal(linkFixture({links:[canonical+'/overlay/contact-info/','https://www.linkedin.com/in/different/overlay/contact-info/']}),null);
assert.equal(linkFixture({links:['https://linkedin.com.evil.test/in/benedict/overlay/contact-info/']}),null);
assert.equal(linkFixture({links:[opaque+'/overlay/contact-info/']}),null);

// Integration: a typed page interruption leaves the lead resumable, never
// writes a failed status, advances the queue, or counts a public action.
const daily=between(background,'async function runDailyWorkflow','function ensureAutoLeadRunState');
const actions=[],checkpoints=[];
const progress={autoWithdrawComplete:true,reviewComplete:true,review:{},targetRequests:1,requestsSent:0,processedLeads:0,timedLeads:0,results:[],failedLeads:[]};
const runEnv={Set,Date,Boolean,Math,Error,
  throwIfWorkflowControlled(){},updateRunProgress:async()=>{},checkpointRun:async(_c,_p,patch)=>checkpoints.push(patch),
  collectLocallyConfirmedConnectionRequests:()=>[],isWorkflowControlError:()=>false,
  ScoutApi:{authenticatedAction:async(path)=>{actions.push(path);if(path==='scouts:getDashboard')return {settings:{onboardingCompleted:true},usage:{requestRemaining:1}};if(path==='scouts:claimNextLead')return {id:'lead',fullName:'Benedict Koh',linkedinUrl:opaque};throw Error('Unexpected API mutation '+path);}},
};
vm.runInNewContext(errorSource+daily+`\nasync function runLeadWorkflow(){throw new LinkedInAccessInterruptionError('page_unavailable');}`,runEnv);
await assert.rejects(runEnv.runDailyWorkflow(null,{resume:true,progress}),/paused/);
assert.equal(actions.filter(x=>x==='scouts:claimNextLead').length,1);
assert.equal(progress.processedLeads,0);assert.equal(progress.requestsSent,0);assert.equal(progress.failedLeads.length,0);
assert.equal(checkpoints.at(-1).currentLead.id,'lead');
assert(!actions.includes('scouts:updateLeadStatus'));
assert.match(background,/autoWithdraw = await autoWithdrawOldRequests[\s\S]{0,170}isLinkedInAccessInterruptionError/);
assert.match(background,/collectAcceptedContact\(lead, runContext\)\.catch[\s\S]{0,145}isLinkedInAccessInterruptionError/);

// Optional language/note fallback must never hide a navigation interruption.
const noteAndLanguage=between(background,'async function createPersonalizedConnectionNoteWithRetry','async function recordRecentPostLanguageDecision');
const lead={id:'lead',fullName:'Benedict Koh',linkedinUrl:opaque};
let extractionCalls=0;
const fallbackEnv={Error,Boolean,String,Number,CONNECTION_NOTE_MAX_ATTEMPTS:2,
  throwIfWorkflowControlled(){},isWorkflowControlError:()=>false,isRecoverableServiceError:()=>false,
  sendAutomationMessageToTab:async(_c,_t,message)=>{
    if(message.type==='EXTRACT_CONNECTION_NOTE_PROFILE') {extractionCalls++;throw fallbackEnv.interruption;}
    return {ok:true};
  },
};
vm.runInNewContext(errorSource+noteAndLanguage+'\nthis.interruption=new LinkedInAccessInterruptionError("page_unavailable");',fallbackEnv);
for(const fn of ['checkLeadProfileLanguage','createPersonalizedConnectionNoteWithRetry']) {
  extractionCalls=0;
  await assert.rejects(fallbackEnv[fn]({},1,lead,canonical),error=>error===fallbackEnv.interruption);
  assert.equal(extractionCalls,1,'must not retry a page interruption as a note failure');
}
const leadCalls=[];
const leadEnv={...fallbackEnv,Math,cleanError:e=>e.message,encodeURIComponent,
  chrome:{storage:{local:{get:async()=>({})}},tabs:{remove:async()=>{}}},
  normalizeLinkedInProfileUrl:()=>canonical,clampInteger:n=>n,
  ScoutApi:{getAuth:async()=>({username:'apple'}),authenticatedAction:async path=>{leadCalls.push(path);}},
  createAutomationTab:async()=>({id:1}),waitForTabComplete:async()=>{},
  waitForResolvedLinkedInProfileUrl:async()=>canonical,waitForAutomationContentScript:async()=>{},
  checkLeadProfileLanguage:async()=>({status:'english'}),
  inspectConnectionStatus:async()=>({ok:true,result:{checked:true,connectAvailable:true}}),
  createPersonalizedConnectionNoteWithRetry:async()=>{throw fallbackEnv.interruption;},
  clearActiveWorkflowTab(){},
};
vm.runInNewContext(errorSource+between(background,'async function runLeadWorkflow','function uniqueLeads'),leadEnv);
await assert.rejects(leadEnv.runLeadWorkflow(lead,{includeNote:true,linkedinPremium:true},{}, {},progress),error=>error===fallbackEnv.interruption);
assert.deepEqual(leadCalls,['scouts:recordProfileVisit','scouts:reportError'],'outer note catch must not continue to send a request');

// Exercise the actual outer run catch and finalizer, not just the lead loop.
let saved={runId:'run',status:'paused',progress,currentLead:null};
Object.assign(runEnv,{
  manualConnectionReviewPromise:null,workflowPromise:null,workflowControlRequest:null,
  ensureAutoLeadRunState:async()=>{},readAutoLeadRunState:async()=>saved,
  writeAutoLeadRunState:async state=>(saved=state),
  reconcileLocallyConfirmedConnectionRequests:async state=>state,
  normalizeRunProgress:p=>p,prepareAutomationWindow:async()=>({automationWindowId:1}),
  requestAutomationKeepAwake(){},releaseAutomationKeepAwake(){},
  cleanError:e=>e.message,isRecoverableServiceError:()=>false,
  getRequestedWorkflowControl:()=>null,
  requestWorkflowControl:async(control,{reason})=>{runEnv.workflowControlRequest={control,reason};},
  checkpointRun:async(_c,_p,patch)=>{saved={...saved,...patch};},
});
const start=between(background,'async function startDailyWorkflow','async function resumeDailyWorkflow');
const finalize=between(background,'async function finalizeControlledRun','function defaultAutoLeadRunState');
vm.runInNewContext(start+finalize,runEnv);
await runEnv.startDailyWorkflow(null,{resume:true});
if(runEnv.workflowPromise)await runEnv.workflowPromise;
assert.equal(saved.status,'paused');assert.equal(saved.phase,'paused');
assert.equal(saved.currentLead.id,'lead');assert.equal(saved.progress.processedLeads,0);
assert.match(saved.message,/paused without skipping/);
console.log('LinkedIn navigation tests passed: error document, bounded recovery, verified identity, language/note interruption propagation, and final paused state without consuming leads.');
