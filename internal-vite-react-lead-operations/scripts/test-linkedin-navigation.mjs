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
const uncertainInvitationMessage='The connection request could not be confirmed. Check LinkedIn Pending before this lead is retried; ask your manager to review it.';

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
await assert.rejects(broken.settle(broken.sandbox.waitForTabComplete(1,{expectedUrl:opaque})),/could not be read/);
assert(broken.requests>0,'complete browser error document must be probed');
assert(broken.now<=18000);assert.equal(broken.listeners.size,0);assert.equal(broken.timers.size,0);

const healthy=harness({status:'loading',heartbeat:t=>({url:t.url})});
await healthy.settle(healthy.sandbox.waitForTabComplete(1,{expectedUrl:opaque}));
assert.equal(healthy.now,0,'content ready need not wait for slow secondary resources');
assert.equal(healthy.timers.size,0);

const old=harness({heartbeat:()=>({url:'https://www.linkedin.com/in/someone-else'})});
await assert.rejects(old.settle(old.sandbox.waitForTabComplete(1,{expectedUrl:opaque,timeoutMs:10000})),/could not be read/);
const pending=harness({heartbeat:t=>({url:t.url})});
pending.tab.pendingUrl=canonical;
await assert.rejects(pending.settle(pending.sandbox.waitForTabComplete(1,{expectedUrl:canonical,timeoutMs:10000})),/could not be read/);

const hanging=harness({heartbeat:()=> 'never'});
await assert.rejects(hanging.settle(hanging.sandbox.waitForTabComplete(1,{expectedUrl:opaque,timeoutMs:10000})),/could not be read/);
await hanging.settle(new Promise(resolve=>hanging.sandbox.setTimeout(resolve,3000)));
assert.equal(hanging.timers.size,0,'late heartbeat timeout must release timers');
for (const heartbeat of [()=>null, ()=>'never', ()=>({url:canonical})]) {
  const recovery=harness({heartbeat});
  await assert.rejects(recovery.settle(recovery.sandbox.waitForContentScript(1,5000)),/could not be read/);
  assert(recovery.now<=8250,'content recovery must also be bounded');
  assert.equal(recovery.timers.size,0);
}
const recovered=harness({heartbeat:t=>({url:t.url})});
assert.equal((await recovered.settle(recovered.sandbox.waitForContentScript(1))).url,opaque);
for(const path of ['checkpoint/challenge','login']) {
  const login=harness({url:'https://www.linkedin.com/'+path});
  await assert.rejects(login.settle(login.sandbox.waitForTabComplete(1,{expectedUrl:opaque})),/security check|sign-in/);
  assert.equal(login.requests,0);
}

// Jen regression: only actual auth paths on the current document indicate a
// sign-in interruption. Text in a profile slug/query/fragment is not a login.
for(const url of [canonical+'-login',canonical+'?next=login',canonical+'#login','https://example.com/login']) {
  const normal=harness({url,heartbeat:t=>({url:t.url})});
  assert.equal(normal.sandbox.linkedInAccessInterruptionKind(url),null);
}
const sent='https://www.linkedin.com/mynetwork/invitation-manager/sent/';
for(const method of ['waitForTabComplete','waitForContentScript']) {
  const staleLogin=harness({url:sent,heartbeat:(t,_m,now)=>({url:now===0?'https://www.linkedin.com/login':t.url})});
  const pending=method==='waitForTabComplete'?staleLogin.sandbox[method](1,{expectedUrl:sent}):staleLogin.sandbox[method](1);
  await staleLogin.settle(pending);
  assert(staleLogin.requests>=2,'stale login reply must be ignored before ready');
  assert.equal(staleLogin.timers.size,0);
}
const realLogin=harness({url:'https://www.linkedin.com/login?session=SECRET#TOKEN'});
await assert.rejects(realLogin.settle(realLogin.sandbox.waitForTabComplete(1,{expectedUrl:sent,stage:'Sent invitations'})),error=>{
  assert.equal(error.kind,'login');assert.equal(error.pageUrl,'https://www.linkedin.com/login');
  assert.equal(error.expectedUrl,sent);assert.equal(error.stage,'Sent invitations');
  return true;
});
let changed;
changed=harness({url:sent,heartbeat:t=>{changed.tab.url='https://www.linkedin.com/authwall';return {url:t.url};}});
await assert.rejects(changed.settle(changed.sandbox.waitForTabComplete(1,{expectedUrl:sent})),/sign-in/);

const resolver=harness({heartbeat:(t,m)=>({url:t.url,resolvedProfileUrl:m.expectedProfileName==='Benedict Koh'?canonical:null})});
assert.equal(await resolver.settle(resolver.sandbox.waitForResolvedLinkedInProfileUrl(1,opaque,30000,'Benedict Koh')),canonical);
assert.deepEqual(resolver.updates,[canonical]);
assert(resolver.requests>=2,'verify fresh document after navigating');
for(const destination of ['checkpoint/challenge','authwall']) {
  let interrupted;
  interrupted=harness({heartbeat:t=>{interrupted.tab.url='https://www.linkedin.com/'+destination;return {url:t.url,resolvedProfileUrl:canonical};}});
  await assert.rejects(interrupted.settle(interrupted.sandbox.waitForResolvedLinkedInProfileUrl(1,opaque,30000,'Benedict Koh')),/security check|sign-in/);
  assert.equal(interrupted.updates.length,0,'must never navigate away from a real access check using an old profile response');
}
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

// The profile shell is present before its About section. The extractor must
// wait for readable text without hanging indefinitely on sparse profiles.
const profileWait=between(content,'  async function waitForProfileText','  function extractProfileSectionText');
const firstMain={name:'shell'},hydratedMain={name:'hydrated'};
let currentMain=firstMain,waitChecks=0;
const profileWaitEnv={PROFILE_TEXT_SETTLE_TIMEOUT_MS:3500,
  document:{querySelector:()=>currentMain},
  findProfileSection:main=>main===hydratedMain?{}:null,
  extractProfileSectionText:section=>section?'This English About section has enough readable prose to classify the profile.':null,
  waitForMatch:async(find,timeout)=>{assert.equal(timeout,3500);assert.equal(find(),null);waitChecks++;currentMain=hydratedMain;assert.equal(find(),hydratedMain);return hydratedMain;},
};
vm.runInNewContext(profileWait,profileWaitEnv);
assert.equal(await profileWaitEnv.waitForProfileText(firstMain),hydratedMain,'extract from the latest hydrated main, not a detached shell');
assert.equal(waitChecks,1);
profileWaitEnv.waitForMatch=async(_find,timeout)=>{assert.equal(timeout,3500);return null;};
assert.equal(await profileWaitEnv.waitForProfileText(firstMain),hydratedMain,'sparse profiles still use the current main after a bounded wait');
assert.match(content,/if \(!main\) throw new Error\("LinkedIn did not finish loading this profile\."\);[\s\S]{0,400}main = await waitForProfileText\(main\)/);

// Ila regression: an empty connection-review plan must not open LinkedIn's
// connections page. If a needed scan finds no readable cards, defer only that
// review and continue the run without recording a false successful scan.
const reviewSource=between(background,'async function reviewAcceptedConnections','async function readConnectionReviewLookbackDays');
const scanAccessHelpers=between(background,'function sameLinkedInDocument','async function readLinkedInPageInfo')+
  between(background,'function linkedInAccessInterruptionKind','function shouldReportEngagementProblem');
function connectionReviewHarness({shouldReview,scanResponse,scanThrows=false,tabUrl='https://www.linkedin.com/mynetwork/invite-connect/connections/'}={}) {
  const calls=[];
  const review={reviewed:false,acceptedMatched:0,contactsChecked:0,emailsCollected:0,connectionsScanned:0};
  const env={Error,Number,Array,Set,Date,URL,
    CONNECTIONS_URL:'https://www.linkedin.com/mynetwork/invite-connect/connections/',
    emptyConnectionReview:()=>({...review}),throwIfWorkflowControlled(){},
    isWorkflowControlError:()=>false,cleanError:error=>error.message||String(error),
    isClosedMessageChannelError:error=>/message (?:channel|port).*closed.*before.*response/i.test(String(error||'')),
    readConnectionReviewLookbackDays:async()=>30,
    createAutomationTab:async()=>{calls.push('open connections');return {id:7};},
    waitForTabComplete:async()=>{},waitForAutomationContentScript:async()=>{},
    sendAutomationMessageToTab:async()=>{if(scanThrows)throw Error('The message port closed before a response was received.');return scanResponse;},
    clearActiveWorkflowTab:()=>{},
    chrome:{tabs:{get:async()=>({url:tabUrl}),remove:async()=>{calls.push('close connections');}}},
    ScoutApi:{authenticatedAction:async path=>{
      calls.push(path);
      if(path==='scouts:getConnectionReviewPlan')return {shouldReview,pendingLeads:[],contactLeads:[]};
      throw Error('Unexpected action '+path);
    }},
  };
  vm.runInNewContext(errorSource+scanAccessHelpers+reviewSource,env);
  return {env,calls};
}
const noConnectionsToCheck=connectionReviewHarness({shouldReview:false});
const noReview=await noConnectionsToCheck.env.reviewAcceptedConnections({},{});
assert.equal(noReview.notNeeded,true);
assert(!noConnectionsToCheck.calls.includes('open connections'),'do not open an unnecessary connections tab');
const unreadableConnections=connectionReviewHarness({shouldReview:true,scanResponse:{ok:false,errorCode:'CONNECTION_CARDS_UNAVAILABLE',error:'No readable list'}});
const deferredReview=await unreadableConnections.env.reviewAcceptedConnections({}, {}, {allowDeferredScan:true});
assert.equal(deferredReview.deferred,true);
assert.equal(deferredReview.reviewed,false,'an unreadable list is not a completed review');
assert(!unreadableConnections.calls.includes('scouts:recordConnectionReview'),'do not record a false empty review');
assert(unreadableConnections.calls.includes('close connections'),'close the failed scan tab');
for(const redirectedUrl of ['https://www.linkedin.com/login','https://www.linkedin.com/checkpoint/challenge']) {
  for(const scanResponse of [{ok:false,errorCode:'CONNECTION_CARDS_UNAVAILABLE',error:'No readable list'},{ok:false,error:'The message port closed before a response was received.'}]) {
    const redirected=connectionReviewHarness({shouldReview:true,scanResponse,tabUrl:redirectedUrl});
    await assert.rejects(redirected.env.reviewAcceptedConnections({}, {}, {allowDeferredScan:true}),/sign-in|security check/);
    assert(redirected.calls.includes('close connections'),'close the redirected scan tab');
    assert(!redirected.calls.includes('scouts:recordConnectionReview'));
  }
}
const thrownChannel=connectionReviewHarness({shouldReview:true,scanThrows:true});
assert.equal((await thrownChannel.env.reviewAcceptedConnections({}, {}, {allowDeferredScan:true})).deferred,true,'a closed channel on the same connections page is deferred');
const thrownLogin=connectionReviewHarness({shouldReview:true,scanThrows:true,tabUrl:'https://www.linkedin.com/login'});
await assert.rejects(thrownLogin.env.reviewAcceptedConnections({}, {}, {allowDeferredScan:true}),/sign-in/);
const unexpectedScan=connectionReviewHarness({shouldReview:true,scanResponse:{ok:false,error:'Unexpected parser error'}});
await assert.rejects(unexpectedScan.env.reviewAcceptedConnections({}, {}, {allowDeferredScan:true}),/Unexpected parser error/);
const manualConnections=connectionReviewHarness({shouldReview:false,scanResponse:{ok:false,errorCode:'CONNECTION_CARDS_UNAVAILABLE',error:'No readable list'}});
await assert.rejects(manualConnections.env.reviewAcceptedConnections({}, {}, {forceReview:true}),/No readable list/);
assert(manualConnections.calls.includes('open connections'),'an explicit manual check still attempts the scan');
assert.match(content,/error\.code = "CONNECTION_CARDS_UNAVAILABLE"/);
assert.match(content,/errorCode: error\?\.code \|\| null/);

function dailyConnectionReviewHarness(shouldReview) {
  const calls=[],messages=[];
  const review={reviewed:false,acceptedMatched:0,contactsChecked:0,emailsCollected:0,connectionsScanned:0};
  const progress={autoWithdrawComplete:true,reviewComplete:false,review:{},targetRequests:null,requestsSent:0,processedLeads:0,timedLeads:0,results:[],failedLeads:[]};
  const env={Set,Date,Boolean,Math,Error,URL,
    CONNECTIONS_URL:'https://www.linkedin.com/mynetwork/invite-connect/connections/',
    emptyConnectionReview:()=>({...review}),throwIfWorkflowControlled(){},
    isWorkflowControlError:()=>false,cleanError:error=>error.message||String(error),
    isClosedMessageChannelError:error=>/message (?:channel|port).*closed.*before.*response/i.test(String(error||'')),
    updateRunProgress:async()=>{},checkpointRun:async(_c,_p,patch)=>messages.push(patch.message),
    updateBadge:async()=>{},collectLocallyConfirmedConnectionRequests:()=>[],
    ScoutApi:{authenticatedAction:async path=>{
      calls.push(path);
      if(path==='scouts:getDashboard')return {settings:{onboardingCompleted:true},usage:{requestRemaining:1}};
      if(path==='scouts:getConnectionReviewPlan')return {shouldReview,pendingLeads:[],contactLeads:[]};
      if(path==='scouts:claimNextLead')return null;
      throw Error('Unexpected action '+path);
    }},
    chrome:{storage:{local:{set:async()=>{}}},tabs:{get:async()=>({url:'https://www.linkedin.com/mynetwork/invite-connect/connections/'}),remove:async()=>{}}},
    readConnectionReviewLookbackDays:async()=>30,
    createAutomationTab:async()=>{calls.push('open connections');return {id:7};},
    waitForTabComplete:async()=>{},waitForAutomationContentScript:async()=>{},
    sendAutomationMessageToTab:async()=>({ok:false,errorCode:'CONNECTION_CARDS_UNAVAILABLE',error:'No readable list'}),
    clearActiveWorkflowTab:()=>{},
  };
  vm.runInNewContext(errorSource+scanAccessHelpers+reviewSource+between(background,'async function runDailyWorkflow','function ensureAutoLeadRunState'),env);
  return {env,progress,calls,messages};
}
const ilaRun=dailyConnectionReviewHarness(false);
await ilaRun.env.runDailyWorkflow(null,{resume:false,progress:ilaRun.progress});
assert.equal(ilaRun.progress.reviewComplete,true);
assert.equal(ilaRun.progress.review.notNeeded,true);
assert(!ilaRun.calls.includes('open connections'));
assert(ilaRun.calls.includes('scouts:claimNextLead'),'normal run reaches lead selection');
const neededButUnreadable=dailyConnectionReviewHarness(true);
await neededButUnreadable.env.runDailyWorkflow(null,{resume:false,progress:neededButUnreadable.progress});
assert.equal(neededButUnreadable.progress.review.deferred,true);
assert(neededButUnreadable.calls.includes('scouts:claimNextLead'),'deferred scan does not block lead work');
assert(neededButUnreadable.messages.some(message=>/Connections check postponed/.test(message)));

// Login/checkpoint interruptions are global: do not advance or consume leads.
const daily=between(background,'async function runDailyWorkflow','function ensureAutoLeadRunState');
const actions=[],checkpoints=[];
const progress={autoWithdrawComplete:true,reviewComplete:true,review:{},targetRequests:1,requestsSent:0,processedLeads:0,timedLeads:0,results:[],failedLeads:[]};
const runEnv={Set,Date,Boolean,Math,Error,URL,
  throwIfWorkflowControlled(){},updateRunProgress:async()=>{},checkpointRun:async(_c,_p,patch)=>checkpoints.push(patch),
  collectLocallyConfirmedConnectionRequests:()=>[],isWorkflowControlError:()=>false,
  ScoutApi:{authenticatedAction:async(path)=>{actions.push(path);if(path==='scouts:getDashboard')return {settings:{onboardingCompleted:true},usage:{requestRemaining:1}};if(path==='scouts:claimNextLead')return {id:'lead',fullName:'Benedict Koh',linkedinUrl:opaque};throw Error('Unexpected API mutation '+path);}},
};
vm.runInNewContext(errorSource+daily+`\nasync function runLeadWorkflow(){throw new LinkedInAccessInterruptionError('login');}`,runEnv);
await assert.rejects(runEnv.runDailyWorkflow(null,{resume:true,progress}),/sign-in/);
assert.equal(actions.filter(x=>x==='scouts:claimNextLead').length,1);
assert.equal(progress.processedLeads,0);assert.equal(progress.requestsSent,0);assert.equal(progress.failedLeads.length,0);
assert.equal(checkpoints.at(-1).currentLead.id,'lead');
assert(!actions.includes('scouts:updateLeadStatus'));
assert.match(background,/autoWithdraw = await autoWithdrawOldRequests[\s\S]{0,170}isLinkedInAccessInterruptionError/);
assert.match(background,/collectAcceptedContact\(lead, runContext\)\.catch[\s\S]{0,145}isLinkedInAccessInterruptionError/);

// A one-off unreadable lead is saved for the Retry failed leads flow and the
// next lead proceeds. Repeated unreadable pages indicate a wider outage and
// pause after two leads instead of exhausting the whole queue.
function leadRecoveryHarness(failingIds,uncertainRequest=false,failureMode='page') {
  const leads=[{id:'first',fullName:'First Lead',linkedinUrl:opaque},{id:'second',fullName:'Second Lead',linkedinUrl:canonical},{id:'third',fullName:'Third Lead',linkedinUrl:opaque}];
  const calls=[],states=[],checkpoints=[];
  const progress={autoWithdrawComplete:true,reviewComplete:true,review:{},targetRequests:1,requestsSent:0,processedLeads:0,timedLeads:0,results:[],failedLeads:[]};
  let claimIndex=0;
  const env={Set,Date,Boolean,Math,Error,URL,
    UNCERTAIN_INVITATION_ERROR:uncertainInvitationMessage,
    cleanError:e=>e.message||String(e),throwIfWorkflowControlled(){},
    isWorkflowControlError:()=>false,isRecoverableServiceError:()=>false,
    collectLocallyConfirmedConnectionRequests:()=>[],
    updateRunProgress:async()=>{},updateActiveRunState:async(_c,patch)=>states.push(patch),
    checkpointRun:async(_c,_p,patch)=>checkpoints.push(patch),
    recordCompletedLeadTiming(){},updateBadge:async()=>{},
    ScoutApi:{authenticatedAction:async(path,args)=>{
      calls.push({path,args});
      if(path==='scouts:getDashboard')return {settings:{onboardingCompleted:true},usage:{requestRemaining:1}};
      if(path==='scouts:claimNextLead')return leads[claimIndex++]||null;
      if(path==='scouts:updateLeadStatus')return null;
      throw Error('Unexpected API mutation '+path);
    }},
  };
  vm.runInNewContext(errorSource+daily+'\nthis.makePageError=(details)=>new LinkedInAccessInterruptionError("page_unavailable",details);',env);
  env.runLeadWorkflow=async lead=>{
    if(failingIds.includes(lead.id)){
      const error=failureMode==='connection_state'
        ? Object.assign(new Error('The connection state could not be confirmed. Nothing was sent for this lead.'),{code:'CONNECTION_STATE_UNCONFIRMED'})
        : env.makePageError({stage:`${lead.fullName} recent activity`,pageUrl:`${lead.linkedinUrl}/recent-activity/all/`});
      error.requestOutcomeUncertain=uncertainRequest;
      throw error;
    }
    return {leadId:lead.id,status:'connection_requested'};
  };
  return {env,progress,calls,states,checkpoints,get claimed(){return claimIndex;}};
}
const oneFailure=leadRecoveryHarness(['first']);
const oneOutcome=await oneFailure.env.runDailyWorkflow(null,{resume:false,progress:oneFailure.progress});
assert.equal(oneOutcome.summary.requestsSent,1);
assert.equal(oneFailure.progress.failedLeads.length,1);
assert.equal(oneFailure.progress.failedLeads[0].leadId,'first');
assert.equal(oneFailure.progress.processedLeads,2);
assert.equal(oneFailure.calls.filter(call=>call.path==='scouts:updateLeadStatus').length,1);
assert.equal(oneFailure.states.at(-1).lastLeadIssue.leadName,'First Lead');
assert.match(oneFailure.checkpoints.find(item=>/saved for later/.test(item.message)).message,/trying the next one/);
const wideFailure=leadRecoveryHarness(['first','second','third']);
await assert.rejects(wideFailure.env.runDailyWorkflow(null,{resume:false,progress:wideFailure.progress}),/two leads in a row/);
assert.equal(wideFailure.progress.failedLeads.length,2);
assert.equal(wideFailure.progress.processedLeads,2);
assert.equal(wideFailure.claimed,2,'do not consume a third lead when LinkedIn may be broadly unavailable');
const missingConnectionActions=leadRecoveryHarness(['first','second','third'],false,'connection_state');
await assert.rejects(missingConnectionActions.env.runDailyWorkflow(null,{resume:false,progress:missingConnectionActions.progress}),/two profiles/i);
assert.equal(missingConnectionActions.progress.processedLeads,2);
assert.equal(missingConnectionActions.claimed,2,'do not burn a third lead when profile actions fail across the account');
const uncertainRequest=leadRecoveryHarness(['first'],true);
await uncertainRequest.env.runDailyWorkflow(null,{resume:false,progress:uncertainRequest.progress});
assert.equal(uncertainRequest.calls.filter(call=>call.path==='scouts:updateLeadStatus').length,1);
assert.match(uncertainRequest.calls.find(call=>call.path==='scouts:updateLeadStatus').args.error,/Check LinkedIn Pending/);
assert.equal(uncertainRequest.states.at(-1).lastLeadIssue.kind,'invitation_unconfirmed');

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
const inspectionCalls=[];
const inspectionEnv={...leadEnv,
  chrome:{storage:{local:{get:async()=>({})}},runtime:{getManifest:()=>({version:'0.10.47'})},tabs:{remove:async()=>{}}},
  getRequestedWorkflowControl:()=>null,sendAutomationMessageToTab:async()=>({ok:true}),
  ScoutApi:{getAuth:async()=>({username:'rymaelie'}),authenticatedAction:async(path,args)=>{inspectionCalls.push({path,args});}},
  inspectConnectionStatus:async()=>({ok:true,result:{checked:true,connectAvailable:false,connectionState:'unavailable',diagnostics:{mainPresent:true,targetHeadingVisible:true,visibleActionCount:0,invitationLinkPresent:false,moreActionPresent:false,pendingActionPresent:false,uiLanguage:'en'}}}),
};
vm.runInNewContext(errorSource+between(background,'async function runLeadWorkflow','function uniqueLeads'),inspectionEnv);
await assert.rejects(inspectionEnv.runLeadWorkflow({...lead,status:'engaged'},{includeNote:false,linkedinPremium:false},{engagementRemaining:0},{},progress),error=>{
  assert.equal(error.code,'CONNECTION_STATE_UNCONFIRMED','workflow error wrapping must keep the circuit-breaker code');
  return true;
});
assert(inspectionCalls.some(call=>call.path==='scouts:recordConnectionInspectionFailure'&&call.args.diagnostics.visibleActionCount===0));
assert(!inspectionCalls.some(call=>call.path==='scouts:reserveConnectionRequest'),'no invitation may be attempted without confirmed Connect');
const attemptedActions=[];
const attemptedEnv={...leadEnv,
  UNCERTAIN_INVITATION_ERROR:uncertainInvitationMessage,
  chrome:{storage:{local:{get:async()=>({})}},tabs:{update:async()=>{},remove:async()=>{}}},
  getRequestedWorkflowControl:()=>null,
  checkpointRun:async()=>{},updateRunProgress:async()=>{},
  ScoutApi:{getAuth:async()=>({username:'jen'}),authenticatedAction:async path=>{attemptedActions.push(path);}},
  createPersonalizedConnectionNoteWithRetry:async()=>'',
  executeConnectionRequestWithRecovery:async()=>{throw fallbackEnv.interruption;},
};
vm.runInNewContext(errorSource+between(background,'async function runLeadWorkflow','function uniqueLeads'),attemptedEnv);
fallbackEnv.interruption.requestOutcomeUncertain=false;
await assert.rejects(attemptedEnv.runLeadWorkflow({...lead,status:'engaged'},{includeNote:false,linkedinPremium:false},{engagementRemaining:0},{},progress),error=>{
  assert.equal(error.requestOutcomeUncertain,true,`a lost page after starting an invitation must never be queued for retry: ${error.message}; actions=${attemptedActions.join(',')}`);
  return true;
});
assert(!attemptedActions.includes('scouts:releaseConnectionRequest'),'retain quota reservation while invitation outcome is uncertain');
const postClickActions=[];
const postClickEnv={...attemptedEnv,
  ScoutApi:{getAuth:async()=>({username:'jen'}),authenticatedAction:async path=>{postClickActions.push(path);}},
  executeConnectionRequestWithRecovery:async()=>({response:{ok:false,error:'LinkedIn lost the response after Send',requestAttempted:true},pendingResult:null}),
};
vm.runInNewContext(errorSource+between(background,'async function runLeadWorkflow','function uniqueLeads'),postClickEnv);
await assert.rejects(postClickEnv.runLeadWorkflow({...lead,status:'engaged'},{includeNote:false,linkedinPremium:false},{engagementRemaining:0},{},progress),error=>{
  assert.equal(error.requestOutcomeUncertain,true,'ordinary post-click errors must be held, not retried');
  return true;
});
assert(!postClickActions.includes('scouts:releaseConnectionRequest'));

const connectionRecovery=between(background,'async function executeConnectionRequestWithRecovery','async function createPersonalizedConnectionNoteWithRetry');
let requestMessages=0;
const connectionEnv={
  UNCERTAIN_INVITATION_ERROR:'Check LinkedIn Pending',
  sendAutomationMessageToTab:async()=>{requestMessages++;return {ok:false,error:'message channel closed'};},
  isClosedMessageChannelError:error=>/message channel closed/.test(error||''),
  updateRunProgress:async()=>{},waitForAutomationContentScript:async()=>{},
  inspectConnectionStatus:async()=>({ok:true,result:{checked:true,connectAvailable:true,connectionState:'not_connected'}}),
};
vm.runInNewContext(connectionRecovery,connectionEnv);
const lostResponse=await connectionEnv.executeConnectionRequestWithRecovery({},1,lead,canonical,{},progress,0);
assert.equal(lostResponse.response.requestOutcomeUncertain,true);
assert.equal(requestMessages,1,'a stale Connect button must never trigger a second Send after a lost response');
assert.match(content,/requestAttempted = true;\s*clickElement\(sendBtn\)/);
assert.match(content,/requestAttempted: error\?\.requestAttempted === true/);

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
  requestWorkflowControl:async(control,{reason,pauseDetails})=>{runEnv.workflowControlRequest={control,reason};saved.pauseDetails=pauseDetails;},
  checkpointRun:async(_c,_p,patch)=>{saved={...saved,...patch};},
});
const start=between(background,'async function startDailyWorkflow','async function resumeDailyWorkflow');
const finalize=between(background,'async function finalizeControlledRun','function defaultAutoLeadRunState');
vm.runInNewContext(start+finalize,runEnv);
await runEnv.startDailyWorkflow(null,{resume:true});
if(runEnv.workflowPromise)await runEnv.workflowPromise;
assert.equal(saved.status,'paused');assert.equal(saved.phase,'paused');
assert.equal(saved.currentLead.id,'lead');assert.equal(saved.progress.processedLeads,0);
assert.match(saved.message,/sign-in/);
assert.equal(saved.pauseDetails.kind,'login');
assert.equal(saved.pauseDetails.stage,'engaging');
assert.equal(typeof saved.pauseDetails.occurredAt,'number');
console.log('LinkedIn navigation tests passed: bounded page checks, profile text settling, one-lead recovery, outage circuit breaker, safe invitation uncertainty, and global access pauses.');
