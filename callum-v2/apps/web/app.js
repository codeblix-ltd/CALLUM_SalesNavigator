const $ = id => document.getElementById(id);
const apiOrigin = location.hostname === 'lead-v2.careeraccelerator.net' ? 'https://api-v2.careeraccelerator.net' : location.origin;
let token = '';
async function api(path, payload) {
  const res = await fetch(apiOrigin + path, { method: payload === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { 'content-type':'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload), cache:'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error === 'PAY_POLICY_NOT_APPROVED'
    ? 'Positive pay rates are disabled while the compensation policy is pending.'
    : data.error || 'Request failed');
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
  table('installations',x.installations,['id','operator_id','extension_version','build_sha','actor_profile_key','disabled','last_seen_at']);
  table('runs',x.runs,['id','operator_id','mode','status','config_version','created_at']);
  table('assignments',x.assignments,['run_id','lead_id','full_name','niche','stage']);
  table('intents',x.intents,['id','operator_id','lead_id','action_type','state','updated_at']);
  table('drafts',x.drafts,['id','run_id','lead_id','post_url','body','status','reviewer','action_intent_id','created_at']);
  table('diagnostics',x.diagnostics,['operator_id','stage','code','run_id','run_status','lead_id','command_id','trace_id','installation_id',
    'command_type','command_status','lead_stage','action_intent_id','intent_state','reconciliation_command_id',
    'reconciliation_status','attempt_count','extension_version','build_sha','config_version','profile_matched',
    'page_ready','pending_visible','connected_visible','target_post_present','viewer_matched','invitation_found',
    'contact_info_opened','contact_email_present','created_at']);
  table('observations',x.observations,['run_id','lead_id','command_id','type','diagnostic_code','profile_matched','target_post_present','target_post_authored_by_lead','viewer_matched','own_comment_present','invitation_found','invitation_age_days','invitation_eligible','contact_info_opened','contact_email_present','created_at']);
  table('events',x.events,['event_type','operator_id','installation_id','extension_version','build_sha','run_id','lead_id','command_id','action_intent_id','config_version','failure_stage','flag_key','flag_disabled','pay_rule_version','pay_rule_enabled','diagnostic_code','reported_occurred_at','created_at']);
  table('configs',x.configs,['version','status','min_extension_version','rollout_percent','checksum','created_at']);
  table('flags',x.flags,['flag_key','disabled','updated_at']);
  table('payRules',x.payRules,['version','event_type','amount_minor','currency','enabled','created_at']);
  table('payRows',x.pay,['operator_id','lead_id','source_event_id','pay_rule_version','amount_minor','currency','status','created_at']);
  $('updated').textContent=`Updated ${new Date().toLocaleTimeString()}`;
}
function bindForm(id, path, convert, onResult) {
  $(id).addEventListener('submit',async e=>{e.preventDefault();$('notice').textContent='';try{const form=new FormData(e.currentTarget);const result=await api(path,convert(form));if(onResult)onResult(result);else $('notice').textContent='Saved.';await refresh();}catch(error){$('notice').textContent=error.message;}});
}
$('connect').addEventListener('click',async()=>{token=$('adminToken').value;try{await refresh();$('adminToken').value='';$('login').hidden=true;$('workspace').hidden=false;}catch(error){token='';$('loginMessage').textContent=error.message;}});
$('refresh').addEventListener('click',()=>refresh().catch(e=>$('notice').textContent=e.message));
for(const button of document.querySelectorAll('nav button'))button.addEventListener('click',()=>{for(const b of document.querySelectorAll('nav button'))b.classList.toggle('active',b===button);for(const v of document.querySelectorAll('.view'))v.hidden=v.id!==button.dataset.view;});
const actorField=document.createElement('input');actorField.name='actorProfileUrl';actorField.placeholder='signed-in LinkedIn profile URL';actorField.type='url';
$('installationForm').insertBefore(actorField,$('installationForm').querySelector('button'));
$('configForm').elements.minVersion.value='2.5.1';
const payEvent=document.createElement('select');payEvent.name='eventType';payEvent.innerHTML='<option value="connection_confirmed">Confirmed connection</option><option value="comment_confirmed">Confirmed comment</option>';
$('payForm').insertBefore(payEvent,$('payForm').querySelector('button'));
bindForm('operatorForm','/api/admin/operators',f=>({id:f.get('id'),cohort:f.get('cohort'),dailyLimit:Number(f.get('dailyLimit'))}));
bindForm('installationForm','/api/admin/installations',f=>({operatorId:f.get('operatorId'),extensionVersion:f.get('extensionVersion'),buildSha:f.get('buildSha'),actorProfileUrl:f.get('actorProfileUrl')||null}),r=>{$('issuedToken').hidden=false;$('issuedToken').textContent=`Installation ${r.id}\nToken (copy now; shown only once): ${r.token}`;});
const rotateForm=document.createElement('form');rotateForm.id='rotateTokenForm';
rotateForm.innerHTML='<h3>Rotate installation token</h3><input name="id" placeholder="installation UUID" required><button>Rotate token</button>';
$('installationForm').after(rotateForm);
bindForm('rotateTokenForm','/api/admin/installations/rotate-token',f=>({id:f.get('id')}),r=>{
  $('issuedToken').hidden=false;
  $('issuedToken').textContent=`Installation ${r.id}\nNew token (copy now; old token is invalid): ${r.token}`;
});
bindForm('runForm','/api/admin/runs',f=>({operatorId:f.get('operatorId'),mode:f.get('mode'),count:Number(f.get('count')),niche:f.get('niche')||null,leadId:f.get('leadId')||null,installationId:f.get('installationId')||null}));
bindForm('inspectionForm','/api/admin/inspections',f=>({runId:f.get('runId'),leadId:f.get('leadId'),type:f.get('type'),postUrl:f.get('postUrl')||null}));
bindForm('withdrawalForm','/api/admin/withdrawals',f=>({runId:f.get('runId'),leadId:f.get('leadId'),inspectionCommandId:f.get('inspectionCommandId')}));
const comments=document.createElement('article');
comments.innerHTML='<h2>Comment drafts and review</h2><p>Only an approved draft for an observed post can become a QA action. Review the exact text before approval. An uncertain submission goes to observation only.</p><div id="drafts"></div><form id="draftForm" class="fullform"><h3>Create draft from observed post</h3><input name="runId" placeholder="run UUID" required><input name="leadId" placeholder="lead UUID" required><input name="inspectionCommandId" placeholder="comment inspection command UUID" required><textarea name="body" maxlength="1250" placeholder="Exact comment text for review" required></textarea><button>Create draft</button></form><form id="reviewForm" class="fullform"><h3>Review a draft</h3><input name="draftId" placeholder="draft UUID" required><input name="reviewer" placeholder="reviewer ID" required><select name="decision"><option value="reject">Reject</option><option value="approve">Approve and queue QA action</option></select><button>Submit review</button></form>';
$('support').append(comments);
bindForm('draftForm','/api/admin/comment-drafts',f=>({runId:f.get('runId'),leadId:f.get('leadId'),inspectionCommandId:f.get('inspectionCommandId'),body:f.get('body')}));
bindForm('reviewForm','/api/admin/comment-drafts/review',f=>({draftId:f.get('draftId'),reviewer:f.get('reviewer'),decision:f.get('decision')}));
bindForm('flagForm','/api/admin/flags',f=>({flagKey:f.get('flagKey'),disabled:f.get('disabled')==='true'}));
bindForm('configForm','/api/admin/configs',f=>({config:JSON.parse(f.get('config')),minVersion:f.get('minVersion')}));
bindForm('activateForm','/api/admin/configs/activate',f=>({version:Number(f.get('version')),channel:f.get('channel'),rolloutPercent:Number(f.get('rolloutPercent'))}));
bindForm('payForm','/api/admin/pay-rules',f=>({version:Number(f.get('version')),eventType:f.get('eventType'),amountMinor:Number(f.get('amountMinor')),currency:String(f.get('currency')).toUpperCase(),enabled:f.get('enabled')==='on'}));
bindForm('payRuleStatusForm','/api/admin/pay-rules/status',f=>({version:Number(f.get('version')),enabled:f.get('enabled')==='true'}));
