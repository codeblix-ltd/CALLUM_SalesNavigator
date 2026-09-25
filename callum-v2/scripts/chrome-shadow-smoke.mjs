import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../apps/control-plane/db.mjs';
import { ControlPlane } from '../apps/control-plane/service.mjs';
import { DEFAULT_CONFIG } from '../packages/linkedin-config/index.mjs';

if (!process.env.COCKROACH_DATABASE_URL) throw new Error('DB URL required');
const extensionPath=resolve(process.argv[2] || 'dist/extension');
const manifest=JSON.parse(await readFile(resolve(extensionPath,'manifest.json'),'utf8'));
const buildText=await readFile(resolve(extensionPath,'build-info.js'),'utf8');
const buildSha=/sha:\s*'([a-f0-9]+)'/.exec(buildText)?.[1];
if(!buildSha)throw new Error('Extension build SHA missing');
const db=openDatabase(),control=new ControlPlane(db);
const operatorId=`v2browser_${randomUUID().slice(0,8)}`;
let server,mcp,id,hotfixVersion=null;
let buffer='',nextId=0;const pending=new Map();
function bindMcp(child){child.stdout.on('data',chunk=>{buffer+=chunk.toString();let pos;while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos).trim();buffer=buffer.slice(pos+1);if(!line.startsWith('{'))continue;try{const x=JSON.parse(line);if(x.id&&pending.has(x.id)){const p=pending.get(x.id);pending.delete(x.id);x.error?p.reject(new Error(x.error.message)):p.resolve(x.result);}}catch{}}});child.stderr.on('data',()=>{});}
function call(method,params={}){const requestId=++nextId;return new Promise((resolve,reject)=>{pending.set(requestId,{resolve,reject});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})+'\n');setTimeout(()=>{if(pending.has(requestId)){pending.delete(requestId);reject(new Error(`${method} timeout`));}},120000).unref();});}
const tool=(name,args={})=>call('tools/call',{name,arguments:args});
const content=result=>result?.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')||JSON.stringify(result);
try {
  await control.seed();await control.createOperator(operatorId,'dev',0);
  const lead=(await db.query(`SELECT id FROM public.leads WHERE linkedin_url LIKE 'https://%linkedin.com/in/%' ORDER BY id LIMIT 1`)).rows[0];
  const run=await control.createRun({operatorId,mode:'shadow',count:1,leadId:lead.id});
  const issued=await control.createInstallation(operatorId,manifest.version,buildSha);
  server=spawn(process.execPath,['apps/control-plane/server.mjs'],{env:{...process.env,V2_ADMIN_TOKEN:randomBytes(32).toString('hex')},stdio:'ignore',windowsHide:true});
  let healthy=false;for(let i=0;i<40;i++){try{healthy=(await fetch('http://127.0.0.1:8788/api/health')).ok;if(healthy)break;}catch{}await delay(250);}if(!healthy)throw new Error('local backend did not start');
  mcp=spawn('pnpm.cmd',['dlx','chrome-devtools-mcp@latest','--categoryExtensions','--headless','--isolated','--workspace=.'],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:true});bindMcp(mcp);
  await call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'callum-v2-shadow-smoke',version:'1.0.0'}});
  mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const installed=content(await tool('install_extension',{path:extensionPath}));
  id=installed.match(/\b[a-p]{32}\b/)?.[0];if(!id)throw new Error(installed);
  await tool('navigate_page',{pageId:1,type:'url',url:`chrome-extension://${id}/popup.html`});
  const expression=`async () => { await chrome.storage.local.set({v2Token:${JSON.stringify(issued.token)},v2Environment:'local'}); return await chrome.runtime.sendMessage({kind:'V2_POLL'}); }`;
  const response=content(await tool('evaluate_script',{pageId:1,function:expression}));
  let commentInspection=null;
  if(process.argv.includes('--comment-inspection')){
    const queued=await control.queueInspection({runId:run.id,leadId:lead.id,type:'INSPECT_COMMENT_STATE'});
    await tool('evaluate_script',{pageId:1,function:"async () => await chrome.runtime.sendMessage({kind:'V2_POLL'})"});
    const observed=(await db.query('SELECT status,result FROM callum_v2.commands WHERE id=$1',[queued.id])).rows[0];
    commentInspection={commandId:queued.id,status:observed.status,diagnostic:observed.result?.facts?.diagnosticCode||null};
  }
  let invitationInspection=null;
  if(process.argv.includes('--invitation-inspection')){
    const queued=await control.queueInspection({runId:run.id,leadId:lead.id,type:'INSPECT_PENDING_INVITATION'});
    await tool('evaluate_script',{pageId:1,function:"async () => await chrome.runtime.sendMessage({kind:'V2_POLL'})"});
    const observed=(await db.query('SELECT status,result,target_url FROM callum_v2.commands WHERE id=$1',[queued.id])).rows[0];
    invitationInspection={commandId:queued.id,status:observed.status,targetUrl:observed.target_url,
      diagnostic:observed.result?.facts?.diagnosticCode||null,eligible:observed.result?.facts?.invitationEligible||false};
  }
  let hotfix=null;
  if(process.argv.includes('--hotfix')){
    const draft=await control.createConfig({...DEFAULT_CONFIG,connect:['button[data-callum-v2-hotfix="connect"]']});
    hotfixVersion=Number(draft.version);
    await control.activateConfig(hotfixVersion,'dev');
    const next=await control.createRun({operatorId,mode:'shadow',count:1,leadId:lead.id});
    const secondResponse=content(await tool('evaluate_script',{pageId:1,function:"async () => await chrome.runtime.sendMessage({kind:'V2_POLL'})"}));
    const secondCommand=(await db.query('SELECT config_version,status FROM callum_v2.commands WHERE run_id=$1',[next.id])).rows[0];
    hotfix={version:hotfixVersion,commandConfigVersion:Number(secondCommand.config_version),commandStatus:secondCommand.status,
      popupSawVersion:secondResponse.includes(`\"configVersion\":${hotfixVersion}`),extensionReloaded:false};
  }
  const events=(await db.query('SELECT event_type,diagnostic_code FROM callum_v2.events WHERE run_id=$1 ORDER BY created_at',[run.id])).rows;
  const command=(await db.query('SELECT type,status,result FROM callum_v2.commands WHERE run_id=$1 ORDER BY created_at,id LIMIT 1',[run.id])).rows[0];
  const assignment=(await db.query('SELECT stage FROM callum_v2.run_leads WHERE run_id=$1',[run.id])).rows[0];
  const pages=content(await tool('list_pages'));
  console.log(JSON.stringify({extensionId:id,runId:run.id,commandType:command?.type,commandStatus:command?.status,
    diagnostic:command?.result?.facts?.diagnosticCode||null,profileMatched:command?.result?.facts?.profileMatched||false,
    assignmentStage:assignment?.stage,events:events.map(x=>x.event_type),popupResponse:response.slice(0,800),hotfix,commentInspection,invitationInspection,
    authwallRedirect:pages.includes('/authwall'),serviceWorkerPresent:pages.includes('background.js')}));
} finally {
  if(id&&mcp)await tool('uninstall_extension',{id}).catch(()=>{});
  if(hotfixVersion)await control.activateConfig(1,'dev').catch(()=>{});
  mcp?.kill();server?.kill();await db.close();
}
