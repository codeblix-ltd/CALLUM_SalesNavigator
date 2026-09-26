import { spawn } from 'node:child_process';

const child=spawn('pnpm.cmd',['dlx','chrome-devtools-mcp@latest','--categoryExtensions','--headless','--isolated'],{
  stdio:['pipe','pipe','pipe'],windowsHide:true,shell:true
});
let buffer='',nextId=0;const pending=new Map();
child.stdout.on('data',chunk=>{buffer+=chunk.toString();let pos;while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos).trim();buffer=buffer.slice(pos+1);if(!line.startsWith('{'))continue;try{const x=JSON.parse(line);if(x.id&&pending.has(x.id)){const p=pending.get(x.id);pending.delete(x.id);x.error?p.reject(new Error(x.error.message)):p.resolve(x.result);}}catch{}}});
child.stderr.on('data',()=>{});
function call(method,params={}){const id=++nextId;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error(`${method} timeout`));}},30000).unref();});}
try{
  const initialized=await call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'callum-v2-inventory',version:'1.0.0'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const listed=await call('tools/list');
  console.log(JSON.stringify({protocolVersion:initialized.protocolVersion,extensions:listed.tools.filter(t=>/extension/.test(t.name)).map(t=>t.name),navigation:listed.tools.filter(t=>/^(list_pages|navigate_page|list_console_messages)$/.test(t.name)).map(t=>t.name)}));
  if(process.argv.includes('--workers'))console.log(JSON.stringify(listed.tools.filter(t=>/worker|target|page|console/i.test(t.name)).map(t=>t.name)));
  if(process.argv.includes('--schemas'))console.log(JSON.stringify(listed.tools.filter(t=>/^(install_extension|list_extensions|reload_extension|trigger_extension_action|uninstall_extension|list_pages|navigate_page|list_console_messages|evaluate_script)$/.test(t.name)).map(t=>({name:t.name,inputSchema:t.inputSchema}))));
}finally{child.kill();}
