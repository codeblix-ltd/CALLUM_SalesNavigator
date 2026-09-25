import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module = {exports:{}};
vm.runInNewContext(compile(readFileSync(new URL('../convex/lib/profileLinkReview.ts',import.meta.url),'utf8')), {module,exports:module.exports});
const rules = module.exports;
const source = readFileSync(new URL('../convex/scouts.ts',import.meta.url),'utf8');
const claimSource = source.slice(source.indexOf('export const claimNextLead ='),source.indexOf('export const recordProfileVisit ='));
const dashboardSource = source.slice(source.indexOf('export const getDashboard ='), source.indexOf('export const getLeadProgress ='));
assert.match(dashboardSource,/a\.status = 'failed'[\s\S]{0,100}AND NOT \(\$\{leadNeedsReviewSql\(\)\}\)/,'retry count must exclude held leads');
assert.match(dashboardSource,/retryable_failed[\s\S]{0,100}FROM lead_assignments AS a/,'retry count must use the actual assignment queue');
assert.match(source,/\$\{leadNeedsReviewSql\(\)\} AS needs_review/,'lead details must expose whether retry is safe');
const opaque = 'https://linkedin.com/in/ACwAAChbAucBI-585IxTOOxRyicxUoSvBFj438w';
const id = '0a9673c9-13a7-4b66-9846-ed3077bd3b09';
const nextId = '0a9673c9-13a7-4b66-9846-ed3077bd3b10';
const base = {id,full_name:'Fixture lead',linkedin_url:opaque,status:'viewed',last_error:rules.UNVERIFIED_PROFILE_LINK_ERROR};
const next = {...base,id:nextId,linkedin_url:'https://www.linkedin.com/in/verified-fixture',last_error:null};
const repeatedUnreadable={...base,linkedin_url:'https://www.linkedin.com/in/ameera-ashraf-9880',last_error:rules.UNREADABLE_LINKEDIN_PAGE_ERROR,pause_count:2};
// Execute the actual handler. These doubles verify query wiring and side
// effects; Cockroach predicate semantics are checked separately with --live.
function harness(rows) {
 const sql=[],writes=[];
 const held = row => (row.last_error===rules.UNVERIFIED_PROFILE_LINK_ERROR && /\/in\/AC[ow][A-Za-z0-9_-]{15,}\/?([?#].*)?$/.test(row.linkedin_url)) || (row.last_error===rules.UNREADABLE_LINKEDIN_PAGE_ERROR && row.pause_count>=2) || row.last_error===rules.UNCERTAIN_INVITATION_ERROR;
 const query = async (text,args=[]) => {
  sql.push(text);
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text))return {rows:[]};
  if (/^\s*(UPDATE|INSERT)/.test(text)) {writes.push(text);return {rows:[]};}
  if (text.includes('WHERE l.id = $1')) {
   assert.equal(args[1],'erin');return {rows:rows.filter(r=>r.id===args[0])};
  }
  assert.equal(args[0],'erin','queue query must be bound to authenticated scout');
  if (text.includes('FROM lead_assignment_events') && text.includes('ORDER BY created_at DESC')) {
   return {rows:[]}; // No global connection-action outage in these queue fixtures.
  }
  if (text.includes('AS lead_needs_review'))return {rows:rows.filter(r=>r.id===args[1]).map(r=>({...r,lead_needs_review:held(r)}))};
  assert(text.includes(rules.leadNeedsReviewSql()),'every automatic selection uses the same guard');
  assert(text.includes('VEBlEN_GUARD'),'existing exclusions must stay in place');
  const excluded=new Set(args.slice(1));
  const eligible=rows.filter(r=>!excluded.has(r.id) && (text.includes("a.status = 'failed'") ? r.status==='failed' : ['viewed','engaged','assigned'].includes(r.status)));
  if (text.includes('ORDER BY')) return {rows:eligible.filter(r=>!held(r)).slice(0,1).map(r=>({...r,lead_id:r.id}))};
  return {rows:eligible.filter(held).slice(0,1)};
 };
 const database={query,connect:async()=>({query,release(){}})};
 const env={...rules,module:{exports:{}},v:new Proxy(()=>({}),{get:()=>()=>({})}),action:d=>d,leadValidator:{},
  internal:{scoutIdentity:{requireScout:'identity'}},getPool:()=>database,veblenMatchExistsSql:()=> 'VEBlEN_GUARD',
  mapLead:r=>r,insertEvent:async()=>writes.push('event'),Set,String,Error};
 env.exports=env.module.exports;
 vm.runInNewContext(compile(claimSource),env);
 return {run:args=>env.module.exports.claimNextLead.handler({runQuery:async()=>({operatorId:'erin'})},args),sql,writes};
}
const resumed=harness([base,next]);
assert.equal((await resumed.run({resumeExisting:true})).id,nextId);
assert.equal(resumed.writes.length,0,'held assignment and counters must not change');
for (const args of [{},{failedOnly:true}]) {
 const heldOnly=harness([{...base,status:args.failedOnly?'failed':'viewed'}]);
 await assert.rejects(heldOnly.run(args),/remaining leads need attention/);
 assert(heldOnly.sql.includes('ROLLBACK'));
 assert.equal(heldOnly.writes.length,0);
}
for(const args of [{},{failedOnly:true}]) {
 const queue=harness([base,{...next,status:args.failedOnly?'failed':'viewed'}]);
 assert.equal((await queue.run(args)).id,nextId,'normal and failed-only runs choose another lead');
 assert.equal(queue.writes.length,0,'a viewed or failed next lead needs no status reset');
}
const selected=harness([base]);
await assert.rejects(selected.run({leadId:id}),/start a normal run/);
assert.equal(selected.writes.length,0);
for(const args of [{},{resumeExisting:true}]) {
 const queue=harness([repeatedUnreadable,next]);
 assert.equal((await queue.run(args)).id,nextId,'repeated unreadable page must not block other leads');
 assert.equal(queue.writes.length,0,'holding a repeated pause must not skip or mutate the lead');
}
await assert.rejects(harness([repeatedUnreadable]).run({leadId:id}),/start a normal run/);
assert.equal((await harness([{...repeatedUnreadable,pause_count:1}]).run({resumeExisting:true})).id,id,'one transient unreadable page remains retryable');
assert.equal((await harness([{...repeatedUnreadable,last_error:null}]).run({resumeExisting:true})).id,id,'clearing the diagnosed error releases the held lead');
const uncertainInvitation={...next,id,status:'failed',last_error:rules.UNCERTAIN_INVITATION_ERROR};
await assert.rejects(harness([uncertainInvitation]).run({failedOnly:true}),/remaining leads need attention/);
await assert.rejects(harness([uncertainInvitation]).run({leadId:id}),/start a normal run/);
assert.equal((await harness([{...uncertainInvitation,last_error:null}]).run({failedOnly:true})).id,id,'reviewed uncertain invitations can be retried after the hold is cleared');
const repaired=harness([{...base,linkedin_url:next.linkedin_url}]);
assert.equal((await repaired.run({resumeExisting:true})).id,id,'verified repair re-enters queue');
const pristine=harness([{...base,last_error:null}]);
assert.equal((await pristine.run({resumeExisting:true})).id,id,'opaque alone is not a reason to hold');
for(const message of ['LinkedIn needs a sign-in check.','The writing service is temporarily unavailable.','LinkedIn page could not be opened.']) {
 assert.equal((await harness([{...base,last_error:message}]).run({resumeExisting:true})).id,id,'unrelated pauses are not silently skipped');
}
assert.equal(await harness([]).run({}),null);
assert.equal(await harness([]).run({leadId:id}),null);
const excluded=harness([base,next]);
await assert.rejects(excluded.run({resumeExisting:true,excludeLeadIds:[nextId]}),/remaining leads/);
assert.match(source.slice(source.indexOf('export const getDashboard'),source.indexOf('export const claimNextLead')),/AND NOT \(\$\{leadNeedsReviewSql\(\)\}\)/);
assert.match(source,/stage === "needs_attention"[\s\S]{0,230}OR \(\$\{leadNeedsReviewSql\(\)\}\)/);
assert.match(source,/stage === "automation_ready"[\s\S]{0,350}AND NOT \(\$\{leadNeedsReviewSql\(\)\}\)/);
const oldBackground=readFileSync(new URL('../chrome-extension/background.js',import.meta.url),'utf8');
assert(oldBackground.includes(rules.UNCERTAIN_INVITATION_ERROR),'extension and backend must agree on the durable invitation hold');
const errors={Error,String};
vm.runInNewContext(oldBackground.slice(oldBackground.indexOf('function cleanError('),oldBackground.indexOf('function sleep(ms)')),errors);
assert.equal(errors.friendlyWorkflowError(new Error(rules.PROFILE_LINK_REVIEW_MESSAGE)),rules.PROFILE_LINK_REVIEW_MESSAGE);
assert.equal(errors.isRecoverableServiceError(rules.ONLY_PROFILE_LINK_REVIEWS_MESSAGE),false,'manual link review must not be mislabelled as temporary AI failure');

if(process.argv.includes('--live')) {
 const {default:pg}=await import('pg');
 const c=new pg.Client({connectionString:process.env.COCKROACH_DATABASE_URL,ssl:{rejectUnauthorized:false},options:'--default_transaction_read_only=on --statement_timeout=15000'});
 await c.connect();
 try {
  const error=rules.UNVERIFIED_PROFILE_LINK_ERROR;
  const fixtures=[
   [error,null,opaque,true], [null,null,opaque,false], ['Other error',null,opaque,false],
   [error,next.linkedin_url,opaque,false], [error,opaque,next.linkedin_url,true],
   [error,null,next.linkedin_url,false], [error,null,opaque+'/?trk=fixture',true],
   [error,null,null,false], [error,null,'https://www.linkedin.com/in/ordinary-person',false],
  ];
  for(const [lastError,resolved,imported,expected] of fixtures) {
   const result=await c.query(`SELECT ${rules.profileLinkNeedsReviewSql()} AS held FROM (SELECT $1::STRING AS last_error,$2::STRING AS resolved_linkedin_url) AS a CROSS JOIN (SELECT $3::STRING AS linkedin_url) AS l`,[lastError,resolved,imported]);
   assert.equal(result.rows[0].held,expected,'real Cockroach null/URL/error predicate');
  }
  const dashboardCount=await c.query(`SELECT count(*) FILTER (WHERE a.status='failed' AND NOT (${rules.leadNeedsReviewSql()}))::FLOAT8 AS retryable_failed FROM lead_assignments AS a JOIN leads AS l ON l.id=a.lead_id WHERE a.operator_id=$1`,['jen']);
  assert(Number.isFinite(Number(dashboardCount.rows[0].retryable_failed)),'dashboard retry count executes on Cockroach');
  const progressReview=await c.query(`SELECT ${rules.leadNeedsReviewSql()} AS needs_review FROM lead_assignments AS a JOIN leads AS l ON l.id=a.lead_id WHERE a.operator_id=$1 LIMIT 1`,['jen']);
  assert.equal(typeof progressReview.rows[0]?.needs_review,'boolean','progress review flag executes on Cockroach');
  if(process.argv.includes('--audit-jen')) {
   const jen=await c.query(`SELECT ${rules.leadNeedsReviewSql()} AS held, a.status FROM lead_assignments a JOIN leads l ON l.id=a.lead_id WHERE a.operator_id=$1 AND a.lead_id=$2::UUID`,['jen','10c419d9-e45a-4bca-92b3-149940cb7df0']);
   assert.equal(jen.rows.length,1,'Jen lead exists');
   assert.equal(jen.rows[0].held,true,'Jen repeated unreadable-page lead must be held by the actual SQL predicate');
   assert.equal(jen.rows[0].status,'viewed','holding must not change assignment status');
   const jenNext=await c.query(`SELECT l.id FROM lead_assignments AS a JOIN leads AS l ON l.id=a.lead_id WHERE a.operator_id=$1 AND (a.status IN ('viewed','engaged') OR (a.status='assigned' AND a.qualification_status <> 'not_qualified')) AND NOT (${rules.leadNeedsReviewSql()}) ORDER BY a.assigned_at DESC, CASE WHEN a.qualification_status='qualified' THEN 0 ELSE 1 END, a.lead_id LIMIT 1`,['jen']);
   assert.equal(jenNext.rows.length,1,'Jen must have another eligible lead for a normal run');
   assert.notEqual(jenNext.rows[0].id,'10c419d9-e45a-4bca-92b3-149940cb7df0','Jen normal run must move past the repeatedly failing lead');
   console.log('PASS: Jen live queue selection');
  }
  console.log('PASS: 9 read-only Cockroach predicate cases');
 }finally{await c.end();}
}
console.log('PASS: profile-link review resume, repair, exact selection, exhausted queue, exclusions and unrelated-pause regressions');
