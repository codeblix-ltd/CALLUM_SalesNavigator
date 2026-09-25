import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const countPerRun=Number(process.argv[2]||5);
if(!Number.isInteger(countPerRun)||countPerRun<1||countPerRun>25)throw new Error('Count per run must be 1..25');
const db=openDatabase(),control=new ControlPlane(db);
const operatorId=`v2shadow_${randomUUID().slice(0,8)}`;
const started=performance.now();
try{
  await control.seed();
  const before=Number((await db.query('SELECT count(*)::INT8 n FROM public.lead_assignments')).rows[0].n);
  await control.createOperator(operatorId,'dev',1);
  const installations=[];
  for(let n=0;n<2;n++){
    const issued=await control.createInstallation(operatorId,'2.5.0','ed7ada2');
    installations.push(await control.installation(issued.token));
  }
  const runs=[];
  for(const installation of installations){
    const run=await control.createRun({operatorId,mode:'shadow',count:countPerRun,installationId:installation.id});
    assert.ok(run.selected>0,'real catalog supplied at least one valid profile');
    runs.push(run);
  }
  async function work(installation,run){
    let completed=0;
    while(true){
      const claimed=await control.claim(installation);
      if(!claimed.command)break;
      const command=claimed.command;
      assert.equal(command.runId,run.id);
      assert.equal(command.type,'INSPECT_PROFILE');
      const result=await control.acknowledge(installation,{commandId:command.id,status:'observed',facts:{
        profileMatched:true,profileKey:command.targetProfileKey,pageReady:true,connectAvailable:true,diagnosticCode:'OK'}});
      assert.equal(result.stage,'completed');
      completed++;
      assert.ok(completed<=run.selected,'no command is redelivered');
    }
    assert.equal(completed,run.selected);
    return completed;
  }
  const completed=await Promise.all(runs.map((run,index)=>work(installations[index],run)));
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
  const seconds=(performance.now()-started)/1000;
  console.log(JSON.stringify({operatorId,runIds:runs.map(run=>run.id),countPerRun,selected:runs.map(run=>run.selected),
    completed,counts,v1AssignmentCountBefore:before,v1AssignmentCountAfter:after,
    elapsedSeconds:Math.round(seconds*10)/10,throughputLeadsPerSecond:Math.round(completed.reduce((a,b)=>a+b,0)/seconds*10)/10,
    rssMb:Math.round(process.memoryUsage().rss/1024/1024)}));
}finally{await db.close();}
