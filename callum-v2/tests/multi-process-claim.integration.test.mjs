import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {openDatabase} from '../apps/control-plane/db.mjs';
import {ControlPlane} from '../apps/control-plane/service.mjs';

const enabled=process.env.V2_TEST_DB==='1'&&!!process.env.COCKROACH_DATABASE_URL;

test('independent backend processes claim and authorize one V2 action once',
  {skip:!enabled,timeout:240000},async()=>{
    const db=openDatabase(),control=new ControlPlane(db);
    const operatorId=`v2process_${randomUUID().slice(0,8)}`;
    const actorKey=`qa-actor-${randomUUID().slice(0,8)}`;
    const leadId=randomUUID(),profileKey=`qa-process-${leadId.slice(0,8)}`;
    const basePort=20000+Math.floor(Math.random()*10000);
    const origins=[`http://127.0.0.1:${basePort}`,`http://127.0.0.1:${basePort+1}`];
    const servers=[];
    let runId=null,installationId=null;
    async function start(origin){
      const child=spawn(process.execPath,['apps/control-plane/server.mjs'],{
        cwd:fileURLToPath(new URL('../',import.meta.url)),
        env:{...process.env,V2_PORT:new URL(origin).port,V2_BIND_HOST:'127.0.0.1',V2_WEB_ORIGIN:origin,
          V2_ADMIN_TOKEN:randomBytes(32).toString('hex'),V2_QA_PROFILE_KEY:profileKey},
        stdio:'ignore',windowsHide:true
      });
      servers.push(child);
      for(let i=0;i<80;i++){
        if(child.exitCode!==null||child.signalCode!==null)throw new Error('BACKEND_START_FAILED');
        try{if((await fetch(`${origin}/api/health`)).ok)return;}catch{}
        await delay(250);
      }
      throw new Error('BACKEND_START_TIMEOUT');
    }
    async function stop(child){
      if(child.exitCode!==null||child.signalCode!==null)return;
      const closed=once(child,'exit');child.kill();
      const exited=await Promise.race([closed.then(()=>true),delay(10000,false,{ref:false})]);
      if(exited||child.exitCode!==null||child.signalCode!==null)return;
      const forced=once(child,'exit');child.kill('SIGKILL');
      const stopped=await Promise.race([forced.then(()=>true),delay(5000,false,{ref:false})]);
      if(!stopped&&child.exitCode===null&&child.signalCode===null)throw new Error('BACKEND_STOP_TIMEOUT');
    }
    let token;
    const post=async(origin,path,payload={})=>{
      const response=await fetch(`${origin}${path}`,{method:'POST',
        headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
        body:JSON.stringify(payload),cache:'no-store'});
      return {status:response.status,data:await response.json()};
    };
    try{
      await control.seed();
      await control.createOperator(operatorId,'dev',1);
      const issued=await control.createInstallation(operatorId,'2.5.1','e439fb3',
        `https://www.linkedin.com/in/${actorKey}/`);
      token=issued.token;installationId=issued.id;
      const installation=await control.installation(token);
      const configVersion=Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'"))
        .rows[0].active_config_version);
      const lead={id:leadId,profile_key:profileKey,linkedin_url:`https://www.linkedin.com/in/${profileKey}/`};
      const run=(await db.query(`INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version)
        VALUES ($1,$2,'live_canary',$3) RETURNING id`,[operatorId,installation.id,configVersion])).rows[0];
      runId=run.id;
      await db.query('INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url) VALUES ($1,$2,$3,$4)',
        [runId,leadId,profileKey,lead.linkedin_url]);
      await db.tx(q=>control.enqueue(q,{id:runId,operator_id:operatorId,config_version:configVersion},lead,
        'INSPECT_PROFILE',`multi-process:${runId}`,null,{actorProfileKey:actorKey}));

      await start(origins[0]);await start(origins[1]);
      assert.notEqual(servers[0].pid,servers[1].pid);
      const inspectionClaims=await Promise.all(origins.map(origin=>post(origin,'/api/commands/claim')));
      assert.ok(inspectionClaims.every(x=>x.status===200));
      const inspections=inspectionClaims.map(x=>x.data.command).filter(Boolean);
      assert.equal(inspections.length,1);
      assert.equal(inspections[0].type,'INSPECT_PROFILE');
      const ack=await post(origins[0],`/api/commands/${inspections[0].id}/ack`,{
        commandId:inspections[0].id,status:'observed',facts:{profileMatched:true,profileKey,
          pageReady:true,viewerMatched:true,connectAvailable:true,diagnosticCode:'OK'}
      });
      assert.equal(ack.status,200);
      assert.equal(ack.data.stage,'awaiting_action');

      const pendingAction=(await db.query(`SELECT id FROM callum_v2.commands
        WHERE run_id=$1 AND type='EXECUTE_CONNECT' AND status='pending'`,[runId])).rows[0];
      assert.ok(pendingAction);
      let releaseLock,lockedResolve,lockedReject;
      const gate=new Promise(resolve=>{releaseLock=resolve;});
      const locked=new Promise((resolve,reject)=>{lockedResolve=resolve;lockedReject=reject;});
      const holder=db.tx(async q=>{
        await q.query('SELECT id FROM callum_v2.commands WHERE id=$1 FOR UPDATE',[pendingAction.id]);
        lockedResolve();
        await gate;
      }).then(()=>null,error=>{lockedReject(error);return error;});
      let actionRequests,overlap=0,observedKinds=[];
      try{
        await locked;
        actionRequests=origins.map(origin=>post(origin,'/api/commands/claim'));
        for(let i=0;i<30;i++){
          const active=(await db.query(`SELECT query FROM [SHOW QUERIES]
            WHERE query LIKE '%callum_v2.commands%' AND query NOT LIKE '%SHOW QUERIES%'`)).rows;
          observedKinds=active.map(({query})=>query.includes('FOR UPDATE OF c')?'row_lock':
            query.includes("status='pending'")?'pending_discovery':
            query.includes('lease_expires_at')?'expiry_discovery':'other_command_query');
          overlap=active.length;
          if(overlap>=2)break;
          await delay(250);
        }
      }finally{
        releaseLock();
        const holdError=await holder;
        if(holdError)throw holdError;
      }
      const actionClaims=await Promise.all(actionRequests);
      assert.ok(overlap>=2,`held lock overlapped ${overlap} command queries: ${observedKinds.join(',')}`);
      assert.ok(actionClaims.every(x=>x.status===200));
      const actions=actionClaims.map(x=>x.data.command).filter(Boolean);
      assert.equal(actions.length,1);
      assert.equal(actions[0].type,'EXECUTE_CONNECT');
      const authorizations=await Promise.all(origins.map(origin=>post(origin,
        `/api/commands/${actions[0].id}/authorize`)));
      assert.equal(authorizations.filter(x=>x.status===200&&x.data.authorized===true).length,1);
      assert.equal(authorizations.filter(x=>x.status===400&&x.data.error==='ACTION_NOT_AUTHORIZED').length,1);
      assert.equal((await db.query(`SELECT count(*)::INT4 AS n FROM callum_v2.events
        WHERE run_id=$1 AND event_type='connection_authorized'`,[runId])).rows[0].n,1);

      await db.query("UPDATE callum_v2.commands SET lease_expires_at=now()-INTERVAL '1 second' WHERE id=$1",
        [actions[0].id]);
      const recoveryClaims=await Promise.all(origins.map(origin=>post(origin,'/api/commands/claim')));
      assert.ok(recoveryClaims.every(x=>x.status===200));
      const recovery=recoveryClaims.map(x=>x.data.command).filter(Boolean);
      assert.equal(recovery.length,1);
      assert.equal(recovery[0].type,'INSPECT_PROFILE');
      assert.equal(recovery[0].payload.reconcile,true);
      assert.equal((await db.query(`SELECT count(*)::INT4 AS n FROM callum_v2.commands
        WHERE run_id=$1 AND type='EXECUTE_CONNECT'`,[runId])).rows[0].n,1);
      assert.equal((await db.query('SELECT count(*)::INT4 AS n FROM callum_v2.command_attempts WHERE command_id=$1',
        [actions[0].id])).rows[0].n,1);
      assert.equal((await db.query('SELECT count(*)::INT4 AS n FROM callum_v2.pay_ledger WHERE run_id=$1',
        [runId])).rows[0].n,0);
    }finally{
      let stopError=null;
      for(const child of servers){try{await stop(child);}catch(error){stopError??=error;}}
      if(runId)await control.pauseRun(runId).catch(()=>{});
      if(installationId)await control.revokeInstallation(installationId).catch(()=>{});
      await control.disableOperator(operatorId,true).catch(()=>{});
      await db.close();
      if(stopError)throw stopError;
    }
  });
