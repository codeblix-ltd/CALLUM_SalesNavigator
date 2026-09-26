import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane,CURRENT_EXTENSION_VERSION} from '../apps/control-plane/service.mjs';

const countPerRun=Number(process.argv[2]||5);
if(!Number.isInteger(countPerRun)||countPerRun<1||countPerRun>25)throw new Error('Count per run must be 1..25');
const rawDb=openDatabase();
const profileSql=process.env.V2_SHADOW_PROFILE_SQL==='1';
const sqlPhase=new AsyncLocalStorage();
const sqlStats=new Map();
const transactionStats=new Map();
async function queryWithProfile(query,sql,args){
  if(!profileSql)return query(sql,args);
  const started=performance.now();
  try{return await query(sql,args);}
  finally{
    const key=`${sqlPhase.getStore() || 'setup'}: ${sql.replace(/\s+/g,' ').trim()}`;
    const stat=sqlStats.get(key)||{count:0,totalMs:0,maxMs:0};
    const duration=performance.now()-started;
    stat.count++;
    stat.totalMs+=duration;
    stat.maxMs=Math.max(stat.maxMs,duration);
    sqlStats.set(key,stat);
  }
}
const db={
  query:(sql,args)=>queryWithProfile(rawDb.query,sql,args),
  tx:async fn=>{
    if(!profileSql)return rawDb.tx(fn);
    const phase=sqlPhase.getStore() || 'setup',started=performance.now();
    let queryMs=0;
    try{
      return await rawDb.tx(q=>fn({query:async(sql,args)=>{
        const queryStarted=performance.now();
        try{return await queryWithProfile(q.query.bind(q),sql,args);}
        finally{queryMs+=performance.now()-queryStarted;}
      }}));
    }finally{
      const stat=transactionStats.get(phase)||{count:0,totalMs:0,queryMs:0,maxMs:0};
      const duration=performance.now()-started;
      stat.count++;stat.totalMs+=duration;stat.queryMs+=queryMs;stat.maxMs=Math.max(stat.maxMs,duration);
      transactionStats.set(phase,stat);
    }
  },
  close:()=>rawDb.close()
};
const control=new ControlPlane(db);
const operatorId=`v2shadow_${randomUUID().slice(0,8)}`;
const started=performance.now();
let setupSeconds=null,processingSeconds=null,verificationSeconds=null;
const installationIds=[],runs=[];
let operatorCreated=false;
try{
  await control.seed();
  const before=Number((await db.query('SELECT count(*)::INT8 n FROM public.lead_assignments')).rows[0].n);
  await control.createOperator(operatorId,'dev',1);
  operatorCreated=true;
  const installations=[];
  for(let n=0;n<2;n++){
    const issued=await control.createInstallation(operatorId,CURRENT_EXTENSION_VERSION,'ed7ada2');
    installationIds.push(issued.id);
    installations.push(await control.installation(issued.token));
  }
  for(const installation of installations){
    const run=await control.createRun({operatorId,mode:'shadow',count:countPerRun,installationId:installation.id});
    runs.push(run);
    assert.ok(run.selected>0,'real catalog supplied at least one valid profile');
  }
  const processingStarted=performance.now();
  setupSeconds=(processingStarted-started)/1000;
  async function work(installation,run){
    let completed=0;
    const timing={claims:0,claimMs:0,claimMaxMs:0,acks:0,ackMs:0,ackMaxMs:0};
    while(true){
      const claimStarted=performance.now();
      const claimed=await sqlPhase.run('claim',()=>control.claim(installation));
      const claimMs=performance.now()-claimStarted;
      timing.claims++;
      timing.claimMs+=claimMs;
      timing.claimMaxMs=Math.max(timing.claimMaxMs,claimMs);
      if(!claimed.command)break;
      const command=claimed.command;
      assert.equal(command.runId,run.id);
      assert.equal(command.type,'INSPECT_PROFILE');
      const ackStarted=performance.now();
      const result=await sqlPhase.run('ack',()=>control.acknowledge(installation,{commandId:command.id,status:'observed',facts:{
        profileMatched:true,profileKey:command.targetProfileKey,pageReady:true,connectAvailable:true,diagnosticCode:'OK'}}));
      const ackMs=performance.now()-ackStarted;
      timing.acks++;
      timing.ackMs+=ackMs;
      timing.ackMaxMs=Math.max(timing.ackMaxMs,ackMs);
      assert.equal(result.stage,'completed');
      completed++;
      assert.ok(completed<=run.selected,'no command is redelivered');
    }
    assert.equal(completed,run.selected);
    return {completed,timing};
  }
  const outcomes=await Promise.all(runs.map((run,index)=>work(installations[index],run)));
  processingSeconds=(performance.now()-processingStarted)/1000;
  const completed=outcomes.map(outcome=>outcome.completed);
  const verificationStarted=performance.now();
  const counts=[];
  for(const run of runs){
    const row=(await db.query(`SELECT r.status,
      (SELECT count(*)::INT4 FROM callum_v2.run_leads l WHERE l.run_id=r.id AND l.stage='completed') AS leads,
      (SELECT count(*)::INT4 FROM callum_v2.commands c WHERE c.run_id=r.id AND c.status='completed' AND c.type='INSPECT_PROFILE') AS observations,
      (SELECT count(*)::INT4 FROM callum_v2.commands c WHERE c.run_id=r.id AND c.type LIKE 'EXECUTE_%') AS actions,
      (SELECT count(*)::INT4 FROM callum_v2.action_intents i WHERE i.run_id=r.id) AS intents,
      (SELECT count(*)::INT4 FROM callum_v2.events e WHERE e.run_id=r.id AND e.event_type='run_completed') AS completions,
      (SELECT count(*)::INT4 FROM callum_v2.pay_ledger p WHERE p.run_id=r.id) AS pay
      FROM callum_v2.runs r WHERE r.id=$1`,[run.id])).rows[0];
    assert.equal(row.status,'completed');
    assert.equal(row.leads,run.selected);
    assert.equal(row.observations,run.selected);
    assert.equal(row.actions,0);
    assert.equal(row.intents,0);
    assert.equal(row.completions,1);
    assert.equal(row.pay,0);
    counts.push(row);
  }
  const after=Number((await db.query('SELECT count(*)::INT8 n FROM public.lead_assignments')).rows[0].n);
  assert.equal(after,before,'V1 assignment count is unchanged');
  verificationSeconds=(performance.now()-verificationStarted)/1000;
  const seconds=(performance.now()-started)/1000;
  console.log(JSON.stringify({operatorId,runIds:runs.map(run=>run.id),countPerRun,selected:runs.map(run=>run.selected),
    completed,counts,v1AssignmentCountBefore:before,v1AssignmentCountAfter:after,
    elapsedSeconds:Math.round(seconds*10)/10,setupSeconds:Math.round(setupSeconds*10)/10,
    processingSeconds:Math.round(processingSeconds*10)/10,verificationSeconds:Math.round(verificationSeconds*10)/10,
    throughputLeadsPerSecond:Math.round(completed.reduce((a,b)=>a+b,0)/seconds*100)/100,
    processingLeadsPerSecond:Math.round(completed.reduce((a,b)=>a+b,0)/processingSeconds*100)/100,
    timing:outcomes.map(outcome=>({claims:outcome.timing.claims,acks:outcome.timing.acks,
      claimTotalSeconds:Math.round(outcome.timing.claimMs/100)/10,
      claimMaxSeconds:Math.round(outcome.timing.claimMaxMs/100)/10,
      ackTotalSeconds:Math.round(outcome.timing.ackMs/100)/10,
      ackMaxSeconds:Math.round(outcome.timing.ackMaxMs/100)/10})),
    rssMb:Math.round(process.memoryUsage().rss/1024/1024),
    ...(profileSql?{transactionProfile:[...transactionStats].map(([phase,stat])=>({phase,count:stat.count,
      totalSeconds:Math.round(stat.totalMs/100)/10,querySeconds:Math.round(stat.queryMs/100)/10,
      otherSeconds:Math.round((stat.totalMs-stat.queryMs)/100)/10,
      maxSeconds:Math.round(stat.maxMs/100)/10}))}:{}),
    ...(profileSql?{sqlProfile:[...sqlStats].map(([query,stat])=>({query:query.slice(0,120),count:stat.count,
      totalSeconds:Math.round(stat.totalMs/100)/10,maxSeconds:Math.round(stat.maxMs/100)/10}))
      .sort((a,b)=>b.totalSeconds-a.totalSeconds).slice(0,15)}:{})}));
}finally{
  const cleanupErrors=[];
  for(const run of runs)try{await control.pauseRun(run.id);}catch(error){cleanupErrors.push(error);}
  for(const id of installationIds)try{await control.revokeInstallation(id);}catch(error){cleanupErrors.push(error);}
  if(operatorCreated)try{await control.disableOperator(operatorId,true);}catch(error){cleanupErrors.push(error);}
  await db.close();
  if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'SHADOW_FIXTURE_CLEANUP_FAILED');
}
