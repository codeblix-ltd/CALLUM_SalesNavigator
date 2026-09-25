import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const extensionPath=resolve(process.argv[2] || 'dist/extension');
const child=spawn('pnpm.cmd',['dlx','chrome-devtools-mcp@latest','--categoryExtensions','--headless','--isolated','--workspace=.'],{
  stdio:['pipe','pipe','pipe'],windowsHide:true,shell:true
});
let buffer='',nextId=0;const pending=new Map();
child.stdout.on('data',chunk=>{buffer+=chunk.toString();let pos;while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos).trim();buffer=buffer.slice(pos+1);if(!line.startsWith('{'))continue;try{const x=JSON.parse(line);if(x.id&&pending.has(x.id)){const p=pending.get(x.id);pending.delete(x.id);x.error?p.reject(new Error(x.error.message)):p.resolve(x.result);}}catch{}}});
child.stderr.on('data',()=>{});
function call(method,params={}){const id=++nextId;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error(`${method} timeout`));}},120000).unref();});}
const tool=(name,args={})=>call('tools/call',{name,arguments:args});
function content(result){return result?.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')||JSON.stringify(result);}
try{
  await call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'callum-v2-lifecycle',version:'1.0.0'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const listing=await call('tools/list');
  for(const name of ['install_extension','list_extensions','reload_extension','trigger_extension_action','uninstall_extension'])if(!listing.tools.some(x=>x.name===name))throw new Error(`${name} unavailable`);
  const before=content(await tool('list_extensions'));
  console.log('BEFORE',before.slice(0,1400));
  const installed=content(await tool('install_extension',{path:extensionPath}));
  console.log('INSTALL',installed.slice(0,1800));
  const after=content(await tool('list_extensions'));
  console.log('AFTER',after.slice(0,2500));
  const matches=after.match(/Callum Scout V2[\s\S]{0,350}/);
  const nearby=matches?.[0]||after;
  const id=installed.match(/\b[a-p]{32}\b/)?.[0]||nearby.match(/\b[a-p]{32}\b/)?.[0];
  if(!id)throw new Error('Installed extension ID not found in MCP result');
  console.log('RELOAD',content(await tool('reload_extension',{id})).slice(0,1000));
  console.log('TRIGGER',content(await tool('trigger_extension_action',{id})).slice(0,1000));
  console.log('POPUP',content(await tool('navigate_page',{pageId:1,type:'url',url:`chrome-extension://${id}/popup.html`})).slice(0,1000));
  console.log('WORKER',content(await tool('evaluate_script',{pageId:1,function:"async () => await chrome.runtime.sendMessage({kind:'V2_STATUS'})"})).slice(0,1000));
  console.log('CONSOLE',content(await tool('list_console_messages',{pageId:1,types:['error']})).slice(0,1000));
  console.log('PAGES',content(await tool('list_pages')).slice(0,2500));
  console.log('UNINSTALL',content(await tool('uninstall_extension',{id})).slice(0,1000));
  console.log(JSON.stringify({extensionId:id,path:extensionPath,lifecycle:'completed'}));
} finally {child.kill();}
