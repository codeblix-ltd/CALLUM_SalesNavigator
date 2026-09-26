import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { openDatabase } from '../apps/control-plane/db.mjs';
import { ControlPlane } from '../apps/control-plane/service.mjs';
import { decideObservation } from '../packages/domain/state.mjs';
import { profileKeyFromUrl } from '../packages/protocol/index.mjs';

const requested=Number(process.argv[2] || 1000);
if (!Number.isInteger(requested) || requested < 1 || requested > 10000) throw new Error('Count must be 1..10000');
const db=openDatabase(), control=new ControlPlane(db);
const clock=performance.now(), samples={};
try {
  await control.seed();await control.createOperator('antish','dev',1);
  const before=(await db.query('SELECT count(*)::INT8 AS n FROM public.lead_assignments')).rows[0].n;
  const readAt=performance.now();
  const {rows}=await db.query(`SELECT l.id,l.profile_key,l.linkedin_url,l.full_name,
    (SELECT min(niche) FROM public.lead_niches WHERE lead_id=l.id) AS niche
    FROM public.leads l WHERE l.linkedin_url LIKE 'https://%linkedin.com/in/%' ORDER BY l.id LIMIT $1`,[requested]);
  samples.catalogReadMs=Math.round(performance.now()-readAt);
  const leads=rows.map(x=>({id:x.id,sourceKey:x.profile_key,key:profileKeyFromUrl(x.linkedin_url),url:x.linkedin_url,name:x.full_name,niche:x.niche})).filter(x=>x.key);
  const cohort=`shadow-${requested}-baseline-68f5971`;
  const run=(await db.query(`INSERT INTO callum_v2.runs(operator_id,mode,config_version) VALUES ('antish','shadow',1) RETURNING id`)).rows[0];
  const writeAt=performance.now();
  for(let offset=0;offset<leads.length;offset+=250){
    const chunk=leads.slice(offset,offset+250),values=[],args=[];
    for(const x of chunk){const i=args.length;values.push(`($${i+1},$${i+2},$${i+3},$${i+4},$${i+5},$${i+6})`);args.push(cohort,x.id,x.sourceKey,x.url,x.name,x.niche);}
    await db.query(`INSERT INTO callum_v2.test_lead_snapshots(cohort,lead_id,profile_key,linkedin_url,full_name,niche)
      VALUES ${values.join(',')} ON CONFLICT (cohort,lead_id) DO NOTHING`,args);
    const runValues=[],runArgs=[];
    for(const x of chunk){const i=runArgs.length;runValues.push(`($${i+1},$${i+2},$${i+3},$${i+4},$${i+5},$${i+6})`);runArgs.push(run.id,x.id,x.key,`https://www.linkedin.com/in/${encodeURIComponent(x.key)}/`,x.name,x.niche);}
    await db.query(`INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url,full_name,niche)
      VALUES ${runValues.join(',')}`,runArgs);
  }
  samples.snapshotAndAssignmentMs=Math.round(performance.now()-writeAt);
  const commandsAt=performance.now();
  await db.query(`INSERT INTO callum_v2.commands(run_id,operator_id,lead_id,type,status,idempotency_key,target_profile_key,target_url,config_version,protocol_version,payload,expires_at,result)
    SELECT run_id,'antish',lead_id,'INSPECT_PROFILE','completed',concat('shadow:',run_id::STRING,':',lead_id::STRING),
      profile_key,linkedin_url,1,1,'{}'::JSONB,now()+INTERVAL '30 minutes','{"simulated":true}'::JSONB
    FROM callum_v2.run_leads WHERE run_id=$1`,[run.id]);
  samples.commandInsertMs=Math.round(performance.now()-commandsAt);
  const decisionAt=performance.now();let wouldConnect=0,invariants=0;
  for(const lead of leads){const d=decideObservation('shadow',{profileMatched:true,pageReady:true,connectAvailable:true,pendingVisible:false,connectedVisible:false});
    if(d.event==='shadow_would_connect'&&d.stage==='completed')wouldConnect++;else invariants++;}
  samples.decisionMs=Math.round(performance.now()-decisionAt);
  const eventAt=performance.now();
  await db.query(`INSERT INTO callum_v2.events(event_key,event_type,operator_id,run_id,lead_id,config_version,details)
    SELECT concat('shadow:',run_id::STRING,':',lead_id::STRING), 'shadow_would_connect','antish',run_id,lead_id,1,'{"simulated":true}'::JSONB
    FROM callum_v2.run_leads WHERE run_id=$1`,[run.id]);
  await db.query("UPDATE callum_v2.run_leads SET stage='completed',updated_at=now() WHERE run_id=$1",[run.id]);
  await db.query("UPDATE callum_v2.runs SET status='completed',updated_at=now() WHERE id=$1",[run.id]);
  samples.eventAndCompleteMs=Math.round(performance.now()-eventAt);
  const counts=(await db.query(`SELECT
    (SELECT count(*)::INT8 FROM callum_v2.run_leads WHERE run_id=$1) AS leads,
    (SELECT count(*)::INT8 FROM callum_v2.commands WHERE run_id=$1) AS commands,
    (SELECT count(*)::INT8 FROM callum_v2.events WHERE run_id=$1) AS events,
    (SELECT count(*)::INT8 FROM callum_v2.action_intents WHERE run_id=$1) AS intents`,[run.id])).rows[0];
  const after=(await db.query('SELECT count(*)::INT8 AS n FROM public.lead_assignments')).rows[0].n;
  const totalMs=Math.round(performance.now()-clock);
  console.log(JSON.stringify({runId:run.id,mode:'shadow',operator:'antish',requested,validLeads:leads.length,
    decisionsWouldConnect:wouldConnect,counts:Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,Number(v)])),
    invariantFailures:invariants,v1AssignmentCountBefore:Number(before),v1AssignmentCountAfter:Number(after),
    timingsMs:samples,totalMs,throughputLeadsPerSecond:Math.round(leads.length/(totalMs/1000)),rssMb:Math.round(process.memoryUsage().rss/1024/1024)}));
} finally { await db.close(); }
