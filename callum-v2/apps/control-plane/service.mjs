import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { assertCommand, linkedInPostUrl, profileKeyFromUrl, PROTOCOL_VERSION, sanitizeResult } from '../../packages/protocol/index.mjs';
import { decideObservation, commandAfterLeaseExpiry, isPayable } from '../../packages/domain/state.mjs';
import { DEFAULT_CONFIG, validateConfig } from '../../packages/linkedin-config/index.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
const SENT_INVITATIONS_URL = 'https://www.linkedin.com/mynetwork/invitation-manager/sent/';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const versionAtLeast = (actual, minimum) => {
  const a = String(actual).split('.').map(Number), b = String(minimum).split('.').map(Number);
  for (let i=0;i<3;i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
};

export class ControlPlane {
  constructor(db) { this.db = db; }

  async seed() {
    const config = validateConfig(DEFAULT_CONFIG);
    await this.db.tx(async q => {
      await q.query(`INSERT INTO callum_v2.remote_configs(version,status,min_extension_version,rollout_percent,config,checksum,activated_at)
        VALUES (1,'stable','2.0.0',100,$1,$2,now()) ON CONFLICT (version) DO NOTHING`, [config, hash(JSON.stringify(config))]);
      for (const channel of ['dev', 'canary', 'stable']) await q.query(`INSERT INTO callum_v2.release_channels(channel,min_extension_version,active_config_version)
        VALUES ($1,'2.0.0',1) ON CONFLICT (channel) DO NOTHING`, [channel]);
    });
  }

  async createOperator(id, cohort = 'dev', dailyLimit = 1) {
    if (!/^[a-z][a-z0-9_-]{1,50}$/.test(id) || !['dev', 'canary', 'stable'].includes(cohort) || !Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 40) throw new Error('OPERATOR_INVALID');
    const { rows } = await this.db.query(`INSERT INTO callum_v2.operators(id,cohort,daily_connection_limit) VALUES ($1,$2,$3)
      ON CONFLICT (id) DO UPDATE SET cohort=excluded.cohort, daily_connection_limit=excluded.daily_connection_limit RETURNING id,enabled,cohort,daily_connection_limit`, [id, cohort, dailyLimit]);
    return rows[0];
  }

  async createInstallation(operatorId, extensionVersion, buildSha) {
    if (!/^2\.\d+\.\d+/.test(extensionVersion) || !/^[a-f0-9]{7,40}$/i.test(buildSha)) throw new Error('INSTALLATION_INVALID');
    const token = randomBytes(32).toString('base64url');
    const { rows } = await this.db.query(`INSERT INTO callum_v2.installations(operator_id,token_hash,extension_version,build_sha,protocol_version)
      VALUES ($1,$2,$3,$4,$5) RETURNING id,operator_id`, [operatorId, hash(token), extensionVersion, buildSha, PROTOCOL_VERSION]);
    return { ...rows[0], token };
  }

  async installation(token) {
    if (typeof token !== 'string' || token.length < 30) throw new Error('UNAUTHORIZED');
    const { rows } = await this.db.query(`SELECT i.id,i.operator_id,i.extension_version,i.build_sha,i.protocol_version,i.disabled,
      o.enabled,o.cohort,o.daily_connection_limit FROM callum_v2.installations i
      JOIN callum_v2.operators o ON o.id=i.operator_id WHERE i.token_hash=$1`, [hash(token)]);
    const item = rows[0];
    if (!item || item.disabled || !item.enabled || item.protocol_version !== PROTOCOL_VERSION) throw new Error('UNAUTHORIZED');
    return item;
  }

  async activeConfig(q, installation) {
    const channel = installation?.cohort || 'dev';
    let { rows } = await q.query(`SELECT c.version,c.config,c.min_extension_version,c.checksum,c.status,c.rollout_percent
      FROM callum_v2.release_channels r JOIN callum_v2.remote_configs c ON c.version=r.active_config_version
      WHERE r.channel=$1 AND c.status IN ('stable','canary')`, [channel]);
    let config = rows[0];
    if (installation?.id && channel !== 'stable' && config && Number(config.rollout_percent) < 100) {
      const bucket = parseInt(hash(installation.id).slice(0,8),16) % 100;
      if (bucket >= Number(config.rollout_percent)) {
        rows = (await q.query(`SELECT c.version,c.config,c.min_extension_version,c.checksum,c.status,c.rollout_percent
          FROM callum_v2.release_channels r JOIN callum_v2.remote_configs c ON c.version=r.active_config_version
          WHERE r.channel='stable' AND c.status='stable'`)).rows;
        config = rows[0];
      }
    }
    if (!config) throw new Error('CONFIG_UNAVAILABLE');
    if (installation && !versionAtLeast(installation.extension_version, config.min_extension_version)) throw new Error('CONFIG_INCOMPATIBLE');
    validateConfig(config.config);
    return config;
  }

  async flagDisabled(q, installation, type, configVersion) {
    const scope = type === 'EXECUTE_CONNECT' ? 'connection' : type === 'EXTRACT_CONTACT_INFO' ? 'contact' : type === 'INSPECT_PENDING_INVITATION' ? 'withdrawal' : null;
    const keys = ['all', `operator:${installation.operator_id}`, `cohort:${installation.cohort}`, `extension:${installation.extension_version}`, `config:${configVersion}`];
    if (scope) keys.push(scope);
    const { rows } = await q.query(`SELECT flag_key FROM callum_v2.feature_flags WHERE flag_key = ANY($1) AND disabled=true`, [keys]);
    return rows.map(x => x.flag_key);
  }

  async createRun({ operatorId, mode = 'shadow', count = 1, niche = null, leadId = null, installationId = null }) {
    if (!['synthetic', 'shadow', 'live_canary'].includes(mode) || !Number.isInteger(count) || count < 1 || count > 1000) throw new Error('RUN_INVALID');
    return this.db.tx(async q => {
      const op = (await q.query('SELECT * FROM callum_v2.operators WHERE id=$1 AND enabled=true', [operatorId])).rows[0];
      if (!op) throw new Error('OPERATOR_DISABLED');
      if (mode === 'live_canary' && (!leadId || count !== 1 || !process.env.V2_QA_PROFILE_KEY)) throw new Error('QA_RECIPIENT_REQUIRED');
      const catalog = await q.query(`SELECT l.id,l.profile_key,l.linkedin_url,l.full_name,
        (SELECT min(ln.niche) FROM public.lead_niches ln WHERE ln.lead_id=l.id) AS niche
        FROM public.leads l WHERE ($1::UUID IS NULL OR l.id=$1::UUID)
        AND ($2::STRING IS NULL OR EXISTS (SELECT 1 FROM public.lead_niches ln WHERE ln.lead_id=l.id AND ln.niche=$2))
        AND l.linkedin_url LIKE 'https://%linkedin.com/in/%' ORDER BY l.id LIMIT $3`, [leadId, niche, count]);
      if (catalog.rows.length === 0) throw new Error('LEADS_NOT_FOUND');
      if (mode === 'live_canary' && profileKeyFromUrl(catalog.rows[0].linkedin_url) !== process.env.V2_QA_PROFILE_KEY.toLowerCase()) throw new Error('QA_RECIPIENT_REQUIRED');
      if (mode === 'live_canary' && !catalog.rows[0].full_name?.trim()) throw new Error('QA_RECIPIENT_NAME_REQUIRED');
      const config = await this.activeConfig(q, { cohort: op.cohort, extension_version: '2.2.0' });
      const run = (await q.query(`INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version)
        VALUES ($1,$2,$3,$4) RETURNING id,operator_id,mode,status,config_version`, [operatorId, installationId, mode, config.version])).rows[0];
      let selected = 0;
      for (const lead of catalog.rows) {
        const targetKey = profileKeyFromUrl(lead.linkedin_url);
        if (!targetKey) continue;
        lead.profile_key = targetKey;
        lead.linkedin_url = `https://www.linkedin.com/in/${encodeURIComponent(targetKey)}/`;
        await q.query(`INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url,full_name,niche)
          VALUES ($1,$2,$3,$4,$5,$6)`, [run.id, lead.id, lead.profile_key, lead.linkedin_url, lead.full_name, lead.niche]);
        selected++;
        await this.enqueue(q, run, lead, 'INSPECT_PROFILE', `initial:${run.id}:${lead.id}`, null, { expectedName: lead.full_name });
      }
      await this.event(q, { event_key: `run:${run.id}:started`, event_type: 'run_started', operator_id: operatorId, run_id: run.id, config_version: Number(config.version), details: { mode } });
      return { ...run, selected };
    });
  }

  async queueInspection({ runId, leadId, type, postUrl = null }) {
    if (!uuid.test(runId || '') || !uuid.test(leadId || '') || !['INSPECT_COMMENT_STATE', 'EXTRACT_CONTACT_INFO', 'INSPECT_PENDING_INVITATION'].includes(type)) throw new Error('INSPECTION_INVALID');
    if (type !== 'INSPECT_COMMENT_STATE' && postUrl !== null) throw new Error('INSPECTION_TARGET_INVALID');
    if (postUrl !== null && typeof postUrl !== 'string') throw new Error('INSPECTION_TARGET_INVALID');
    const targetPost = postUrl === null ? null : linkedInPostUrl(postUrl);
    if (postUrl !== null && !targetPost) throw new Error('INSPECTION_TARGET_INVALID');
    return this.db.tx(async q => {
      const { rows } = await q.query(`SELECT r.*,l.profile_key,l.linkedin_url,l.full_name,o.cohort
        FROM callum_v2.runs r JOIN callum_v2.run_leads l ON l.run_id=r.id AND l.lead_id=$2
        JOIN callum_v2.operators o ON o.id=r.operator_id AND o.enabled=true
        WHERE r.id=$1 AND r.status='running' FOR UPDATE OF r`, [runId,leadId]);
      const run=rows[0];
      if (!run) throw new Error('RUN_NOT_FOUND');
      if (type === 'EXTRACT_CONTACT_INFO' && (run.mode !== 'live_canary' || !process.env.V2_QA_PROFILE_KEY || run.profile_key !== process.env.V2_QA_PROFILE_KEY.toLowerCase())) throw new Error('QA_RECIPIENT_REQUIRED');
      const config=await this.activeConfig(q,{cohort:run.cohort,extension_version:'2.2.0'});
      const required=type === 'EXTRACT_CONTACT_INFO' ? ['contactLink','contactDialog','contactEmail'] : type === 'INSPECT_PENDING_INVITATION' ? ['invitationPage','invitationCard','invitationProfile','invitationAge','invitationWithdraw'] : ['postScope','postLink','commentButton'];
      if (required.some(key=>!config.config[key]?.length) || (type === 'EXTRACT_CONTACT_INFO' && !config.config.labels.contactInfo?.length)) throw new Error('CONFIG_INCOMPATIBLE');
      if (type === 'INSPECT_PENDING_INVITATION' && (!config.config.labels.invitationWithdraw?.length || !config.config.labels.invitationSent?.length)) throw new Error('CONFIG_INCOMPATIBLE');
      const lead={id:leadId,profile_key:run.profile_key,linkedin_url:type === 'INSPECT_PENDING_INVITATION' ? SENT_INVITATIONS_URL : run.linkedin_url};
      const payload={expectedName:run.full_name,postUrl:targetPost};
      const command=await this.enqueue(q,{...run,config_version:config.version},lead,type,
        `inspect:${type}:${runId}:${leadId}:${config.version}:${hash(targetPost||'').slice(0,12)}`,null,payload);
      await this.event(q,{event_key:`command:${command.id}:requested`,event_type:'observation_requested',
        operator_id:run.operator_id,run_id:runId,lead_id:leadId,command_id:command.id,config_version:Number(config.version)});
      return { id:command.id,type,status:command.status,configVersion:Number(config.version) };
    });
  }

  async enqueue(q, run, lead, type, key, actionIntentId = null, payload = {}) {
    const id = randomUUID();
    const expires = new Date(Date.now() + (type === 'EXECUTE_CONNECT' ? 5 : 30) * 60_000);
    const { rows } = await q.query(`INSERT INTO callum_v2.commands
      (id,run_id,operator_id,lead_id,action_intent_id,type,idempotency_key,target_profile_key,target_url,config_version,protocol_version,payload,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING *`,
      [id, run.run_id || run.id, run.operator_id, lead.id || lead.lead_id, actionIntentId, type, key, lead.profile_key, lead.linkedin_url, run.config_version, PROTOCOL_VERSION, payload, expires]);
    return rows[0];
  }

  async event(q, x) {
    const { rows } = await q.query(`INSERT INTO callum_v2.events
      (event_key,event_type,operator_id,installation_id,run_id,lead_id,command_id,action_intent_id,extension_version,build_sha,protocol_version,config_version,diagnostic_code,details)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (event_key) DO UPDATE SET event_key=excluded.event_key RETURNING id`,
      [x.event_key,x.event_type,x.operator_id||null,x.installation_id||null,x.run_id||null,x.lead_id||null,x.command_id||null,x.action_intent_id||null,x.extension_version||null,x.build_sha||null,x.protocol_version||null,x.config_version||null,x.diagnostic_code||null,x.details||{}]);
    return rows[0].id;
  }

  async recoverExpired(q, operatorId) {
    const { rows } = await q.query(`SELECT c.*,r.mode,r.status AS run_status,l.linkedin_url,l.profile_key FROM callum_v2.commands c
      JOIN callum_v2.runs r ON r.id=c.run_id JOIN callum_v2.run_leads l ON l.run_id=c.run_id AND l.lead_id=c.lead_id
      WHERE c.operator_id=$1 AND ((c.status='leased' AND c.lease_expires_at < now()) OR (c.status='pending' AND c.expires_at < now()))
      FOR UPDATE OF c`, [operatorId]);
    for (const c of rows) {
      if (commandAfterLeaseExpiry(c.type) === 'reconcile_required') {
        await q.query("UPDATE callum_v2.commands SET status='uncertain',updated_at=now() WHERE id=$1", [c.id]);
        await q.query("UPDATE callum_v2.action_intents SET state='reconcile_required',updated_at=now() WHERE id=$1 AND state NOT IN ('confirmed','cancelled')", [c.action_intent_id]);
        await q.query("UPDATE callum_v2.run_leads SET stage='reconcile_required',updated_at=now() WHERE run_id=$1 AND lead_id=$2", [c.run_id,c.lead_id]);
        await this.enqueue(q, c, { id: c.lead_id, profile_key: c.profile_key, linkedin_url: c.linkedin_url }, 'INSPECT_PROFILE', `reconcile:${c.action_intent_id}`, c.action_intent_id, { reconcile: true, expectedName: c.payload?.expectedName || null });
        await this.event(q, { event_key: `intent:${c.action_intent_id}:uncertain`, event_type: 'connection_uncertain', operator_id: c.operator_id, run_id: c.run_id, lead_id: c.lead_id, command_id: c.id, action_intent_id: c.action_intent_id, config_version: Number(c.config_version), diagnostic_code: 'POSTCONDITION_UNKNOWN' });
      } else {
        await q.query("UPDATE callum_v2.commands SET status='pending',expires_at=now()+INTERVAL '30 minutes',lease_expires_at=NULL,updated_at=now() WHERE id=$1", [c.id]);
      }
    }
  }

  async claim(installation) {
    return this.db.tx(async q => {
      await this.recoverExpired(q, installation.operator_id);
      const config = await this.activeConfig(q, installation);
      const { rows } = await q.query(`SELECT c.* FROM callum_v2.commands c JOIN callum_v2.runs r ON r.id=c.run_id
        WHERE c.operator_id=$1 AND c.status='pending' AND c.expires_at>now() AND r.status='running'
        AND (r.installation_id IS NULL OR r.installation_id=$2) ORDER BY c.created_at,c.id LIMIT 1 FOR UPDATE OF c`, [installation.operator_id, installation.id]);
      const c = rows[0];
      if (!c) return { command: null, config: { version: Number(config.version), value: config.config, checksum: config.checksum } };
      if (Number(c.config_version) !== Number(config.version)) {
        await q.query('UPDATE callum_v2.runs SET config_version=$2,updated_at=now() WHERE id=$1', [c.run_id,config.version]);
        if (c.type === 'EXECUTE_CONNECT') {
          await q.query("UPDATE callum_v2.commands SET status='cancelled',updated_at=now() WHERE id=$1", [c.id]);
          await q.query("UPDATE callum_v2.action_intents SET state='reconcile_required',updated_at=now() WHERE id=$1 AND state='reserved'", [c.action_intent_id]);
          await this.enqueue(q, { ...c, config_version: config.version }, { id:c.lead_id,profile_key:c.target_profile_key,linkedin_url:c.target_url },
            'INSPECT_PROFILE', `reconcile:${c.action_intent_id}`, c.action_intent_id, { reconcile:true, expectedName:c.payload?.expectedName || null });
          return { command:null, config:{ version:Number(config.version),value:config.config,checksum:config.checksum } };
        }
        await q.query('UPDATE callum_v2.commands SET config_version=$2,updated_at=now() WHERE id=$1', [c.id,config.version]);
        c.config_version=config.version;
      }
      const disabled = await this.flagDisabled(q, installation, c.type, c.config_version);
      if (disabled.length) {
        // Leave unclaimed work queued. Clearing the flag may resume it after a
        // fresh authorization check; expiry still takes the safe recovery path.
        return { command: null, config: { version: Number(config.version), value: config.config, checksum: config.checksum } };
      }
      const attempt = (await q.query('SELECT count(*)::INT4 AS n FROM callum_v2.command_attempts WHERE command_id=$1', [c.id])).rows[0].n + 1;
      await q.query("UPDATE callum_v2.commands SET status='leased',installation_id=$2,lease_expires_at=now()+INTERVAL '90 seconds',updated_at=now() WHERE id=$1", [c.id, installation.id]);
      await q.query('INSERT INTO callum_v2.command_attempts(command_id,installation_id,attempt_number) VALUES ($1,$2,$3)', [c.id, installation.id, attempt]);
      await q.query('UPDATE callum_v2.installations SET last_seen_at=now() WHERE id=$1', [installation.id]);
      const command = { id: c.id, runId: c.run_id, leadId: c.lead_id, operatorId: c.operator_id, traceId: c.trace_id,
        type: c.type, targetProfileKey: c.target_profile_key, targetUrl: c.target_url, configVersion: Number(c.config_version),
        protocolVersion: c.protocol_version, idempotencyKey: c.idempotency_key, actionIntentId: c.action_intent_id,
        expiresAt: c.expires_at.toISOString(), payload: c.payload };
      assertCommand(command);
      return { command, config: { version: Number(config.version), value: config.config, checksum: config.checksum } };
    });
  }

  async authorizeAction(installation, commandId) {
    return this.db.tx(async q => {
      const { rows } = await q.query(`SELECT c.*,i.state AS intent_state,r.status AS run_status FROM callum_v2.commands c
        JOIN callum_v2.action_intents i ON i.id=c.action_intent_id JOIN callum_v2.runs r ON r.id=c.run_id
        WHERE c.id=$1 AND c.operator_id=$2 FOR UPDATE OF c`, [commandId, installation.operator_id]);
      const c = rows[0];
      if (!c || c.type !== 'EXECUTE_CONNECT' || c.installation_id !== installation.id || c.status !== 'leased' || c.intent_state !== 'reserved' || c.run_status !== 'running' || c.expires_at <= new Date() || c.lease_expires_at <= new Date()) throw new Error('ACTION_NOT_AUTHORIZED');
      const config = await this.activeConfig(q, installation);
      if (Number(config.version) !== Number(c.config_version) || (await this.flagDisabled(q, installation, c.type, c.config_version)).length) throw new Error('ACTION_NOT_AUTHORIZED');
      await q.query("UPDATE callum_v2.action_intents SET state='submitted',updated_at=now() WHERE id=$1 AND state='reserved'", [c.action_intent_id]);
      await this.event(q, { event_key:`intent:${c.action_intent_id}:authorized`, event_type:'connection_authorized',
        operator_id:c.operator_id,installation_id:installation.id,run_id:c.run_id,lead_id:c.lead_id,
        command_id:c.id,action_intent_id:c.action_intent_id,extension_version:installation.extension_version,
        build_sha:installation.build_sha,protocol_version:PROTOCOL_VERSION,config_version:Number(c.config_version) });
      return { authorized: true, commandId: c.id, expiresAt: c.expires_at };
    });
  }

  async acknowledge(installation, raw) {
    const result = sanitizeResult(raw);
    return this.db.tx(async q => {
      const { rows } = await q.query(`SELECT c.*,r.mode,l.stage FROM callum_v2.commands c
        JOIN callum_v2.runs r ON r.id=c.run_id JOIN callum_v2.run_leads l ON l.run_id=c.run_id AND l.lead_id=c.lead_id
        WHERE c.id=$1 AND c.operator_id=$2 FOR UPDATE OF c`, [result.commandId, installation.operator_id]);
      const c = rows[0];
      if (!c || c.installation_id !== installation.id) throw new Error('COMMAND_NOT_OWNED');
      if (c.status === 'completed') return { duplicate: true, state: c.status };
      if (!['leased', 'uncertain'].includes(c.status)) throw new Error('COMMAND_NOT_ACTIVE');
      const facts = result.facts;
      if (facts.profileKey !== c.target_profile_key.toLowerCase()) facts.profileMatched = false;
      if (c.type !== 'EXTRACT_CONTACT_INFO' || c.mode !== 'live_canary' || result.status !== 'observed' ||
        !process.env.V2_QA_PROFILE_KEY || c.target_profile_key !== process.env.V2_QA_PROFILE_KEY.toLowerCase() ||
        !facts.profileMatched || !facts.pageReady || !facts.contactInfoOpened) facts.contactEmail = null;
      if (c.type !== 'INSPECT_COMMENT_STATE' || result.status !== 'observed' || !facts.profileMatched || !facts.pageReady) {
        facts.postUrls=[];facts.targetPostPresent=false;facts.commentBoxAvailable=false;
      } else {
        const targetPost=linkedInPostUrl(c.payload?.postUrl);
        facts.targetPostPresent=!!targetPost && facts.postUrls.includes(targetPost);
        if (!facts.postUrls.length || (targetPost && !facts.targetPostPresent)) facts.commentBoxAvailable=false;
      }
      if (c.type !== 'INSPECT_PENDING_INVITATION' || result.status !== 'observed' || !facts.profileMatched || !facts.pageReady || !facts.invitationNameMatched) {
        facts.invitationFound=false;facts.invitationNameMatched=false;facts.invitationWithdrawAvailable=false;facts.invitationAgeDays=null;
      }
      facts.invitationEligible=c.type === 'INSPECT_PENDING_INVITATION' && facts.invitationFound && facts.invitationNameMatched && facts.invitationWithdrawAvailable && facts.invitationAgeDays >= 30;
      await q.query('INSERT INTO callum_v2.observations(command_id,run_id,lead_id,facts,diagnostic_code) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (command_id) DO NOTHING', [c.id,c.run_id,c.lead_id,facts,facts.diagnosticCode]);
      await q.query("UPDATE callum_v2.command_attempts SET finished_at=now(),outcome=$2 WHERE command_id=$1 AND finished_at IS NULL", [c.id,result.status]);
      await q.query("UPDATE callum_v2.commands SET status='completed',result=$2,updated_at=now() WHERE id=$1", [c.id,result]);
      await this.event(q, { event_key: `command:${c.id}:result`, event_type: 'observation_completed', operator_id: c.operator_id,
        installation_id: installation.id, run_id: c.run_id, lead_id: c.lead_id, command_id: c.id, action_intent_id: c.action_intent_id,
        extension_version: installation.extension_version, build_sha: installation.build_sha, protocol_version: PROTOCOL_VERSION,
        config_version: Number(c.config_version), diagnostic_code: facts.diagnosticCode });
      if (c.type === 'EXECUTE_CONNECT') return this.finishAction(q, installation, c, result);
      if (c.type === 'INSPECT_COMMENT_STATE' || c.type === 'EXTRACT_CONTACT_INFO' || c.type === 'INSPECT_PENDING_INVITATION') {
        await this.event(q,{event_key:`command:${c.id}:inspection`,event_type:c.type === 'INSPECT_COMMENT_STATE' ? 'comment_state_observed' : c.type === 'INSPECT_PENDING_INVITATION' ? 'pending_invitation_observed' : facts.contactEmail ? 'contact_info_confirmed' : 'contact_info_observed',
          operator_id:c.operator_id,installation_id:installation.id,run_id:c.run_id,lead_id:c.lead_id,command_id:c.id,
          extension_version:installation.extension_version,build_sha:installation.build_sha,protocol_version:PROTOCOL_VERSION,
          config_version:Number(c.config_version),diagnostic_code:facts.diagnosticCode});
        if (!facts.profileMatched || !facts.pageReady) await this.diagnostic(q,installation,c,'inspection',facts.diagnosticCode);
        return { duplicate:false,stage:c.stage };
      }
      if (c.payload?.reconcile === true && c.action_intent_id) {
        const intent = (await q.query('SELECT state FROM callum_v2.action_intents WHERE id=$1', [c.action_intent_id])).rows[0];
        if (intent?.state === 'confirmed' || intent?.state === 'cancelled') return { duplicate: false, stage: c.stage };
      }
      const choice = decideObservation(c.mode, facts, c.payload?.reconcile === true);
      await q.query('UPDATE callum_v2.run_leads SET stage=$3,updated_at=now() WHERE run_id=$1 AND lead_id=$2', [c.run_id,c.lead_id,choice.stage]);
      if (c.payload?.reconcile === true && c.action_intent_id && choice.event === 'connection_reconciled') {
        await q.query("UPDATE callum_v2.action_intents SET state='confirmed',updated_at=now() WHERE id=$1 AND state='reconcile_required'", [c.action_intent_id]);
      }
      await this.event(q, { event_key: `command:${c.id}:${choice.event}`, event_type: choice.event, operator_id: c.operator_id,
        installation_id: installation.id, run_id: c.run_id, lead_id: c.lead_id, command_id: c.id, action_intent_id: c.action_intent_id,
        extension_version: installation.extension_version, build_sha: installation.build_sha, protocol_version: PROTOCOL_VERSION,
        config_version: Number(c.config_version), diagnostic_code: facts.diagnosticCode });
      if (choice.event === 'connection_reconciled' && c.action_intent_id) {
        const confirmedEventId = await this.event(q, { event_key: `intent:${c.action_intent_id}:confirmed`, event_type: 'connection_confirmed',
          operator_id: c.operator_id, installation_id: installation.id, run_id: c.run_id, lead_id: c.lead_id,
          command_id: c.id, action_intent_id: c.action_intent_id, extension_version: installation.extension_version,
          build_sha: installation.build_sha, protocol_version: PROTOCOL_VERSION, config_version: Number(c.config_version), diagnostic_code: facts.diagnosticCode });
        await this.applyPay(q, c, confirmedEventId, 'connection_confirmed');
      }
      if (choice.stage === 'awaiting_action') await this.reserveConnect(q, c);
      if (choice.stage === 'paused') await this.diagnostic(q, installation, c, 'observation', facts.diagnosticCode);
      return { duplicate: false, stage: choice.stage };
    });
  }

  async reserveConnect(q, c) {
    const op = (await q.query('SELECT daily_connection_limit FROM callum_v2.operators WHERE id=$1', [c.operator_id])).rows[0];
    const used = (await q.query(`SELECT count(*)::INT4 AS n FROM callum_v2.action_intents
      WHERE operator_id=$1 AND action_type='connect' AND created_at >= date_trunc('day',now()) AND state IN ('reserved','submitted','reconcile_required','confirmed')`, [c.operator_id])).rows[0].n;
    if (used >= op.daily_connection_limit) {
      await q.query("UPDATE callum_v2.run_leads SET stage='paused' WHERE run_id=$1 AND lead_id=$2", [c.run_id,c.lead_id]);
      return;
    }
    const { rows } = await q.query(`INSERT INTO callum_v2.action_intents(run_id,operator_id,lead_id,action_type,target_key,state)
      VALUES ($1,$2,$3,'connect',$4,'reserved') ON CONFLICT (operator_id,lead_id,action_type,target_key)
      DO UPDATE SET updated_at=callum_v2.action_intents.updated_at RETURNING id,state,run_id`, [c.run_id,c.operator_id,c.lead_id,c.target_profile_key]);
    const intent = rows[0];
    if (intent.state !== 'reserved' || intent.run_id !== c.run_id) {
      await q.query("UPDATE callum_v2.run_leads SET stage='paused' WHERE run_id=$1 AND lead_id=$2", [c.run_id,c.lead_id]);
      return;
    }
    await this.enqueue(q, c, { id: c.lead_id, profile_key: c.target_profile_key, linkedin_url: c.target_url },
      'EXECUTE_CONNECT', `connect:${intent.id}`, intent.id, { expectedName: c.payload?.expectedName || null });
    await this.event(q, { event_key: `intent:${intent.id}:reserved`, event_type: 'connection_reserved', operator_id: c.operator_id,
      run_id: c.run_id, lead_id: c.lead_id, action_intent_id: intent.id, config_version: Number(c.config_version) });
  }

  async finishAction(q, installation, c, result) {
    const authorization = (await q.query("SELECT id FROM callum_v2.events WHERE action_intent_id=$1 AND event_type='connection_authorized' LIMIT 1", [c.action_intent_id])).rows[0];
    if (result.status === 'not_submitted') {
      const observedExisting = result.facts.profileMatched && result.facts.pageReady && (result.facts.pendingVisible || result.facts.connectedVisible);
      const stage = observedExisting ? 'completed' : 'paused';
      await q.query("UPDATE callum_v2.action_intents SET state='cancelled',updated_at=now() WHERE id=$1 AND state IN ('reserved','submitted')", [c.action_intent_id]);
      await q.query("UPDATE callum_v2.commands SET status='cancelled',updated_at=now() WHERE idempotency_key=$1 AND status='pending'", [`reconcile:${c.action_intent_id}`]);
      await q.query('UPDATE callum_v2.run_leads SET stage=$3,updated_at=now() WHERE run_id=$1 AND lead_id=$2', [c.run_id,c.lead_id,stage]);
      await this.event(q, { event_key: `intent:${c.action_intent_id}:not_submitted`, event_type: observedExisting ? 'already_pending' : 'connection_not_submitted',
        operator_id: c.operator_id, installation_id: installation.id, run_id: c.run_id, lead_id: c.lead_id,
        command_id: c.id, action_intent_id: c.action_intent_id, config_version: Number(c.config_version), diagnostic_code: result.facts.diagnosticCode });
      return { duplicate: false, stage };
    }
    const confirmed = !!authorization && result.status === 'confirmed' && result.facts.profileMatched && result.facts.pageReady && result.facts.pendingVisible;
    if (confirmed) {
      await q.query("UPDATE callum_v2.action_intents SET state='confirmed',updated_at=now() WHERE id=$1 AND state IN ('reserved','submitted','reconcile_required')", [c.action_intent_id]);
      await q.query("UPDATE callum_v2.commands SET status='cancelled',updated_at=now() WHERE idempotency_key=$1 AND status='pending'", [`reconcile:${c.action_intent_id}`]);
      await q.query("UPDATE callum_v2.run_leads SET stage='completed',updated_at=now() WHERE run_id=$1 AND lead_id=$2", [c.run_id,c.lead_id]);
      const eventId = await this.event(q, { event_key: `intent:${c.action_intent_id}:confirmed`, event_type: 'connection_confirmed', operator_id: c.operator_id,
        installation_id: installation.id, run_id: c.run_id, lead_id: c.lead_id, command_id: c.id, action_intent_id: c.action_intent_id,
        extension_version: installation.extension_version, build_sha: installation.build_sha, protocol_version: PROTOCOL_VERSION, config_version: Number(c.config_version), diagnostic_code: 'OK' });
      await this.applyPay(q, c, eventId, 'connection_confirmed');
      return { duplicate: false, stage: 'completed' };
    }
    await q.query("UPDATE callum_v2.action_intents SET state='reconcile_required',updated_at=now() WHERE id=$1 AND state NOT IN ('confirmed','cancelled')", [c.action_intent_id]);
    await q.query("UPDATE callum_v2.run_leads SET stage='reconcile_required',updated_at=now() WHERE run_id=$1 AND lead_id=$2", [c.run_id,c.lead_id]);
    await this.enqueue(q, c, { id: c.lead_id, profile_key: c.target_profile_key, linkedin_url: c.target_url },
      'INSPECT_PROFILE', `reconcile:${c.action_intent_id}`, c.action_intent_id, { reconcile: true, expectedName: c.payload?.expectedName || null });
    await this.event(q, { event_key: `intent:${c.action_intent_id}:uncertain`, event_type: 'connection_uncertain', operator_id: c.operator_id,
      installation_id: installation.id, run_id: c.run_id, lead_id: c.lead_id, command_id: c.id, action_intent_id: c.action_intent_id,
      config_version: Number(c.config_version), diagnostic_code: result.facts.diagnosticCode });
    return { duplicate: false, stage: 'reconcile_required' };
  }

  async applyPay(q, c, eventId, eventType) {
    const intent = (await q.query('SELECT * FROM callum_v2.action_intents WHERE id=$1', [c.action_intent_id])).rows[0];
    const authorization = (await q.query("SELECT id FROM callum_v2.events WHERE action_intent_id=$1 AND event_type='connection_authorized' LIMIT 1", [c.action_intent_id])).rows[0];
    if (!authorization) return;
    const rule = (await q.query('SELECT * FROM callum_v2.pay_rules WHERE enabled=true AND event_type=$1 ORDER BY version DESC LIMIT 1', [eventType])).rows[0];
    if (!isPayable(intent?.state, eventType, rule)) return;
    await q.query(`INSERT INTO callum_v2.pay_ledger(action_intent_id,operator_id,run_id,lead_id,source_event_id,pay_rule_version,amount_minor,currency)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (action_intent_id) DO NOTHING`,
      [intent.id,c.operator_id,c.run_id,c.lead_id,eventId,rule.version,rule.amount_minor,rule.currency]);
  }

  async diagnostic(q, installation, c, stage, code) {
    await q.query(`INSERT INTO callum_v2.support_diagnostics(operator_id,installation_id,run_id,lead_id,command_id,action_intent_id,stage,code)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [installation.operator_id,installation.id,c.run_id,c.lead_id,c.id,c.action_intent_id,stage,code]);
  }

  async pauseRun(id) { await this.db.query("UPDATE callum_v2.runs SET status='paused',updated_at=now() WHERE id=$1", [id]); }
  async resumeRun(id) { await this.db.query("UPDATE callum_v2.runs SET status='running',updated_at=now() WHERE id=$1 AND status='paused'", [id]); }
  async disableOperator(id, disabled) {
    await this.db.query('UPDATE callum_v2.operators SET enabled=$2 WHERE id=$1', [id, disabled !== true]);
  }
  async revokeInstallation(id) {
    await this.db.query('UPDATE callum_v2.installations SET disabled=true WHERE id=$1', [id]);
  }

  async setFlag(flagKey, disabled) {
    if (!/^(all|connection|comment|withdrawal|contact|operator:[a-z0-9_-]+|cohort:(dev|canary|stable)|config:\d+|extension:[a-z0-9.-]+)$/.test(flagKey)) throw new Error('FLAG_INVALID');
    await this.db.query(`INSERT INTO callum_v2.feature_flags(flag_key,disabled) VALUES ($1,$2)
      ON CONFLICT (flag_key) DO UPDATE SET disabled=excluded.disabled,updated_at=now()`, [flagKey, disabled === true]);
  }

  async createConfig(config, minVersion = '2.2.0') {
    const clean = validateConfig(config);
    if (!/^2\.\d+\.\d+$/.test(minVersion)) throw new Error('CONFIG_INVALID');
    const { rows } = await this.db.query(`INSERT INTO callum_v2.remote_configs(version,status,min_extension_version,rollout_percent,config,checksum)
      SELECT coalesce(max(version),0)+1,'draft',$1,0,$2,$3 FROM callum_v2.remote_configs RETURNING version,checksum`,
      [minVersion,clean,hash(JSON.stringify(clean))]);
    return rows[0];
  }

  async activateConfig(version, channel = 'canary', rolloutPercent = 100) {
    if (!['dev','canary','stable'].includes(channel) || !Number.isInteger(version) || !Number.isInteger(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) throw new Error('CONFIG_INVALID');
    return this.db.tx(async q => {
      const config = (await q.query('SELECT * FROM callum_v2.remote_configs WHERE version=$1', [version])).rows[0];
      if (!config) throw new Error('CONFIG_NOT_FOUND');
      validateConfig(config.config);
      await q.query('UPDATE callum_v2.release_channels SET active_config_version=$2,updated_at=now() WHERE channel=$1', [channel,version]);
      const usedByStable=(await q.query("SELECT 1 FROM callum_v2.release_channels WHERE channel='stable' AND active_config_version=$1",[version])).rows.length>0;
      const state=usedByStable?'stable':'canary';
      await q.query('UPDATE callum_v2.remote_configs SET status=$2,rollout_percent=$3,activated_at=now() WHERE version=$1', [version,state,usedByStable?100:rolloutPercent]);
      await q.query(`UPDATE callum_v2.remote_configs SET status='disabled' WHERE version<>$1 AND status IN ('canary','stable')
        AND NOT EXISTS (SELECT 1 FROM callum_v2.release_channels WHERE active_config_version=callum_v2.remote_configs.version)`, [version]);
      return { version, channel, status: state, rolloutPercent: channel==='stable'?100:rolloutPercent };
    });
  }

  async overview() {
    const queries = {
      operators: 'SELECT id,enabled,cohort,daily_connection_limit FROM callum_v2.operators ORDER BY id LIMIT 100',
      installations: 'SELECT id,operator_id,extension_version,build_sha,disabled,last_seen_at FROM callum_v2.installations ORDER BY created_at DESC LIMIT 100',
      runs: 'SELECT id,operator_id,mode,status,config_version,created_at FROM callum_v2.runs ORDER BY created_at DESC LIMIT 100',
      assignments: 'SELECT run_id,lead_id,full_name,niche,stage FROM callum_v2.run_leads ORDER BY created_at DESC LIMIT 100',
      intents: 'SELECT id,run_id,operator_id,lead_id,action_type,state,updated_at FROM callum_v2.action_intents ORDER BY updated_at DESC LIMIT 100',
      events: 'SELECT id,event_type,operator_id,run_id,lead_id,command_id,action_intent_id,config_version,diagnostic_code,created_at FROM callum_v2.events ORDER BY created_at DESC LIMIT 100',
      diagnostics: 'SELECT operator_id,installation_id,run_id,lead_id,command_id,action_intent_id,stage,code,created_at FROM callum_v2.support_diagnostics ORDER BY created_at DESC LIMIT 100',
      observations: `SELECT o.run_id,o.lead_id,o.command_id,c.type,o.diagnostic_code,
        o.facts->>'profileMatched' AS profile_matched,
        o.facts->>'contactInfoOpened' AS contact_info_opened,
        (o.facts->>'contactEmail') IS NOT NULL AS contact_email_present,
        o.facts->>'invitationFound' AS invitation_found,
        o.facts->>'invitationAgeDays' AS invitation_age_days,
        o.facts->>'invitationEligible' AS invitation_eligible,
        o.created_at FROM callum_v2.observations o JOIN callum_v2.commands c ON c.id=o.command_id
        ORDER BY o.created_at DESC LIMIT 100`,
      configs: 'SELECT version,status,min_extension_version,rollout_percent,checksum,created_at FROM callum_v2.remote_configs ORDER BY version DESC LIMIT 30',
      flags: 'SELECT flag_key,disabled,updated_at FROM callum_v2.feature_flags ORDER BY flag_key',
      pay: 'SELECT operator_id,run_id,lead_id,source_event_id,pay_rule_version,amount_minor,currency,status,created_at FROM callum_v2.pay_ledger ORDER BY created_at DESC LIMIT 100'
    };
    const result = {};
    for (const [key, sql] of Object.entries(queries)) result[key] = (await this.db.query(sql)).rows;
    return result;
  }
}
