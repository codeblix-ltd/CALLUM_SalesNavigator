const $ = id => document.getElementById(id);
const apiOrigin = location.hostname === 'lead-v2.careeraccelerator.net' ? 'https://api-v2.careeraccelerator.net' : location.origin;
let token = '';
async function api(path, payload) {
  const res = await fetch(apiOrigin + path, { method: payload === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { 'content-type':'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload), cache:'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function table(id, rows, fields) {
  const root = $(id); root.replaceChildren();
  if (!rows?.length) { const p=document.createElement('p');p.className='empty';p.textContent='No records yet.';root.append(p);return; }
  const wrap=document.createElement('div'),t=document.createElement('table'),head=document.createElement('tr');wrap.className='tablewrap';
  for (const f of fields) { const th=document.createElement('th');th.textContent=f;head.append(th); }
  const thead=document.createElement('thead');thead.append(head);t.append(thead);
  const body=document.createElement('tbody');
  for (const row of rows) { const tr=document.createElement('tr');for (const f of fields) { const td=document.createElement('td');const v=row[f];td.textContent=v==null?'—':typeof v==='object'?JSON.stringify(v):String(v);td.title=td.textContent;tr.append(td); }body.append(tr); }
  t.append(body);wrap.append(t);root.append(wrap);
}
async function refresh() {
  const health=await fetch(apiOrigin+'/api/health',{cache:'no-store'}).then(r=>r.json());
  $('health').textContent=`${health.environment} backend · ${health.status}`;
  const x=await api('/api/admin/overview');
  table('operators',x.operators,['id','enabled','cohort','daily_connection_limit']);
  table('installations',x.installations,['id','operator_id','extension_version','build_sha','disabled','last_seen_at']);
  table('runs',x.runs,['id','operator_id','mode','status','config_version','created_at']);
  table('assignments',x.assignments,['run_id','lead_id','full_name','niche','stage']);
  table('intents',x.intents,['id','operator_id','lead_id','action_type','state','updated_at']);
  table('diagnostics',x.diagnostics,['operator_id','stage','code','command_id','action_intent_id','created_at']);
  table('observations',x.observations,['run_id','lead_id','command_id','type','diagnostic_code','profile_matched','contact_info_opened','contact_email_present','created_at']);
  table('events',x.events,['event_type','operator_id','run_id','lead_id','command_id','action_intent_id','config_version','diagnostic_code','created_at']);
  table('configs',x.configs,['version','status','min_extension_version','rollout_percent','checksum','created_at']);
  table('flags',x.flags,['flag_key','disabled','updated_at']);
  table('payRows',x.pay,['operator_id','lead_id','source_event_id','pay_rule_version','amount_minor','currency','status','created_at']);
  $('updated').textContent=`Updated ${new Date().toLocaleTimeString()}`;
}
function bindForm(id, path, convert, onResult) {
  $(id).addEventListener('submit',async e=>{e.preventDefault();$('notice').textContent='';try{const form=new FormData(e.currentTarget);const result=await api(path,convert(form));if(onResult)onResult(result);else $('notice').textContent='Saved.';await refresh();}catch(error){$('notice').textContent=error.message;}});
}
$('connect').addEventListener('click',async()=>{token=$('adminToken').value;try{await refresh();$('adminToken').value='';$('login').hidden=true;$('workspace').hidden=false;}catch(error){token='';$('loginMessage').textContent=error.message;}});
$('refresh').addEventListener('click',()=>refresh().catch(e=>$('notice').textContent=e.message));
for(const button of document.querySelectorAll('nav button'))button.addEventListener('click',()=>{for(const b of document.querySelectorAll('nav button'))b.classList.toggle('active',b===button);for(const v of document.querySelectorAll('.view'))v.hidden=v.id!==button.dataset.view;});
bindForm('operatorForm','/api/admin/operators',f=>({id:f.get('id'),cohort:f.get('cohort'),dailyLimit:Number(f.get('dailyLimit'))}));
bindForm('installationForm','/api/admin/installations',f=>({operatorId:f.get('operatorId'),extensionVersion:f.get('extensionVersion'),buildSha:f.get('buildSha')}),r=>{$('issuedToken').hidden=false;$('issuedToken').textContent=`Installation ${r.id}\nToken (copy now; shown only once): ${r.token}`;});
bindForm('runForm','/api/admin/runs',f=>({operatorId:f.get('operatorId'),mode:f.get('mode'),count:Number(f.get('count')),niche:f.get('niche')||null,leadId:f.get('leadId')||null}));
bindForm('inspectionForm','/api/admin/inspections',f=>({runId:f.get('runId'),leadId:f.get('leadId'),type:f.get('type'),postUrl:f.get('postUrl')||null}));
bindForm('flagForm','/api/admin/flags',f=>({flagKey:f.get('flagKey'),disabled:f.get('disabled')==='true'}));
bindForm('configForm','/api/admin/configs',f=>({config:JSON.parse(f.get('config')),minVersion:f.get('minVersion')}));
bindForm('activateForm','/api/admin/configs/activate',f=>({version:Number(f.get('version')),channel:f.get('channel'),rolloutPercent:Number(f.get('rolloutPercent'))}));
bindForm('payForm','/api/admin/pay-rules',f=>({version:Number(f.get('version')),eventType:'connection_confirmed',amountMinor:Number(f.get('amountMinor')),currency:String(f.get('currency')).toUpperCase(),enabled:f.get('enabled')==='on'}));
