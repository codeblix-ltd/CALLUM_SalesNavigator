import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { assertCommand, linkedInPostUrl, profileKeyFromUrl, PROTOCOL_VERSION, sanitizeResult } from '../../packages/protocol/index.mjs';
import { decideObservation, commandAfterLeaseExpiry, isPayable } from '../../packages/domain/state.mjs';
import { DEFAULT_CONFIG, validateConfig } from '../../packages/linkedin-config/index.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
const SENT_INVITATIONS_URL = 'https://www.linkedin.com/mynetwork/invitation-manager/sent/';
export const CURRENT_EXTENSION_VERSION = '2.5.0';
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
        VALUES (1,'stable',$3,100,$1,$2,now()) ON CONFLICT (version) DO NOTHING`, [config, hash(JSON.stringify(config)),CURRENT_EXTENSION_VERSION]);
      for (const channel of ['dev', 'canary', 'stable']) await q.query(`INSERT INTO callum_v2.release_channels(channel,min_extension_version,active_config_version)
        VALUES ($1,$2,1) ON CONFLICT (channel) DO NOTHING`, [channel,CURRENT_EXTENSION_VERSION]);
    });
  }

  async createOperator(id, cohort = 'dev', dailyLimit = 1) {
    if (!/^[a-z][a-z0-9_-]{1,50}$/.test(id) || !['dev', 'canary', 'stable'].includes(cohort) || !Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 40) throw new Error('OPERATOR_INVALID');
    const { rows } = await this.db.query(`INSERT INTO callum_v2.operators(id,cohort,daily_connection_limit) VALUES ($1,$2,$3)
      ON CONFLICT (id) DO UPDATE SET cohort=excluded.cohort, daily_connection_limit=excluded.daily_connection_limit RETURNING id,enabled,cohort,daily_connection_limit`, [id, cohort, dailyLimit]);
    return rows[0];
  }

  async createInstallation(operatorId, extensionVersion, buildSha, actorProfileUrl = null) {
    if (!/^2\.\d+\.\d+/.test(extensionVersion) || !/^[a-f0-9]{7,40}$/i.test(buildSha)) throw new Error('INSTALLATION_INVALID');
    const actorKey=actorProfileUrl===null?null:profileKeyFromUrl(actorProfileUrl);
    if(actorProfileUrl!==null&&!actorKey)throw new Error('INSTALLATION_ACTOR_INVALID');
    const token = randomBytes(32).toString('base64url');
    const { rows } = await this.db.query(`INSERT INTO callum_v2.installations(operator_id,token_hash,extension_version,build_sha,protocol_version,actor_profile_key)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,operator_id,actor_profile_key`, [operatorId, hash(token), extensionVersion, buildSha, PROTOCOL_VERSION, actorKey]);
    return { ...rows[0], token };
  }

  async installation(token) {
    if (typeof token !== 'string' || token.length < 30) throw new Error('UNAUTHORIZED');
    const { rows } = await this.db.query(`SELECT i.id,i.operator_id,i.extension_version,i.build_sha,i.protocol_version,i.disabled,i.actor_profile_key,
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
    const scope = type === 'EXECUTE_CONNECT' ? 'connection' : ['INSPECT_COMMENT_STATE','EXECUTE_COMMENT'].includes(type) ? 'comment' : type === 'EXTRACT_CONTACT_INFO' ? 'contact' : ['INSPECT_PENDING_INVITATION','EXECUTE_WITHDRAW'].includes(type) ? 'withdrawal' : null;
    const keys = ['all', `operator:${installation.operator_id}`, `cohort:${installation.cohort}`, `extension:${installation.extension_version}`, `config:${configVersion}`];
    if (scope) keys.push(scope);
    const { rows } = await q.query(`SELECT flag_key FROM callum_v2.feature_flags WHERE flag_key = ANY($1) AND disabled=true`, [keys]);
    return rows.map(x => x.flag_key);
  }

  async assertNoV1Assignment(q, leadId, errorCode = 'V1_LEAD_ASSIGNED') {
    const { rows } = await q.query('SELECT lead_id FROM public.lead_assignments WHERE lead_id=$1 LIMIT 1', [leadId]);
    if (rows.length) throw new Error(errorCode);
  }

  async createRun({ operatorId, mode = 'shadow', count = 1, niche = null, leadId = null, installationId = null }) {
    if (!['synthetic', 'shadow', 'live_canary'].includes(mode) || !Number.isInteger(count) || count < 1 || count > 1000) throw new Error('RUN_INVALID');
    return this.db.tx(async q => {
      const op = (await q.query('SELECT * FROM callum_v2.operators WHERE id=$1 AND enabled=true', [operatorId])).rows[0];
      if (!op) throw new Error('OPERATOR_DISABLED');
      if (mode === 'live_canary' && (!leadId || count !== 1 || !process.env.V2_QA_PROFILE_KEY)) throw new Error('QA_RECIPIENT_REQUIRED');
      let canaryInstallation = null;
      if (mode === 'live_canary') {
        if (!uuid.test(installationId || '')) throw new Error('CANARY_INSTALLATION_REQUIRED');
        canaryInstallation = (await q.query(`SELECT id,extension_version FROM callum_v2.installations
          WHERE id=$1 AND operator_id=$2 AND disabled=false AND protocol_version=$3`,
          [installationId, operatorId, PROTOCOL_VERSION])).rows[0];
        if (!canaryInstallation) throw new Error('CANARY_INSTALLATION_REQUIRED');
      }
      const catalog = await q.query(`SELECT l.id,l.profile_key,l.linkedin_url,l.full_name,
        (SELECT min(ln.niche) FROM public.lead_niches ln WHERE ln.lead_id=l.id) AS niche
        FROM public.leads l WHERE ($1::UUID IS NULL OR l.id=$1::UUID)
        AND ($2::STRING IS NULL OR EXISTS (SELECT 1 FROM public.lead_niches ln WHERE ln.lead_id=l.id AND ln.niche=$2))
        AND l.linkedin_url LIKE 'https://%linkedin.com/in/%' ORDER BY l.id LIMIT $3`, [leadId, niche, count]);
      if (catalog.rows.length === 0) throw new Error('LEADS_NOT_FOUND');
      if (mode === 'live_canary' && profileKeyFromUrl(catalog.rows[0].linkedin_url) !== process.env.V2_QA_PROFILE_KEY.toLowerCase()) throw new Error('QA_RECIPIENT_REQUIRED');
      if (mode === 'live_canary' && !catalog.rows[0].full_name?.trim()) throw new Error('QA_RECIPIENT_NAME_REQUIRED');
      if (mode === 'live_canary') await this.assertNoV1Assignment(q, catalog.rows[0].id);
      const config = await this.activeConfig(q, { cohort: op.cohort, extension_version: canaryInstallation?.extension_version || CURRENT_EXTENSION_VERSION });
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
      const { rows } = await q.query(`SELECT r.*,l.profile_key,l.linkedin_url,l.full_name,o.cohort,i.actor_profile_key
        FROM callum_v2.runs r JOIN callum_v2.run_leads l ON l.run_id=r.id AND l.lead_id=$2
        JOIN callum_v2.operators o ON o.id=r.operator_id AND o.enabled=true
        LEFT JOIN callum_v2.installations i ON i.id=r.installation_id
        WHERE r.id=$1 AND r.status IN ('running','completed') FOR UPDATE OF r`, [runId,leadId]);
      const run=rows[0];
      if (!run) throw new Error('RUN_NOT_FOUND');
      if (type === 'EXTRACT_CONTACT_INFO' && (run.mode !== 'live_canary' || !process.env.V2_QA_PROFILE_KEY || run.profile_key !== process.env.V2_QA_PROFILE_KEY.toLowerCase())) throw new Error('QA_RECIPIENT_REQUIRED');
      const config=await this.activeConfig(q,{cohort:run.cohort,extension_version:CURRENT_EXTENSION_VERSION});
      const required=type === 'EXTRACT_CONTACT_INFO' ? ['contactLink','contactDialog','contactEmail'] : type === 'INSPECT_PENDING_INVITATION' ? ['invitationPage','invitationCard','invitationProfile','invitationAge','invitationWithdraw'] : ['postScope','postLink','postAuthor','viewerProfile','commentButton','commentItem','commentAuthor','commentText'];
      if (required.some(key=>!config.config[key]?.length) || (type === 'EXTRACT_CONTACT_INFO' && !config.config.labels.contactInfo?.length)) throw new Error('CONFIG_INCOMPATIBLE');
      if (type === 'INSPECT_PENDING_INVITATION' && (!config.config.labels.invitationWithdraw?.length || !config.config.labels.invitationSent?.length)) throw new Error('CONFIG_INCOMPATIBLE');
      const lead={id:leadId,profile_key:run.profile_key,linkedin_url:type === 'INSPECT_PENDING_INVITATION' ? SENT_INVITATIONS_URL : run.linkedin_url};
      const payload={expectedName:run.full_name,postUrl:targetPost,actorProfileKey:type==='INSPECT_COMMENT_STATE'?run.actor_profile_key:null};
      const command=await this.enqueue(q,{...run,config_version:config.version},lead,type,
        `inspect:${type}:${runId}:${leadId}:${randomUUID()}`,null,payload);
      await this.reopenRun(q,run,command);
      await this.event(q,{event_key:`command:${command.id}:requested`,event_type:'observation_requested',
        operator_id:run.operator_id,run_id:runId,lead_id:leadId,command_id:command.id,config_version:Number(config.version)});
      return { id:command.id,type,status:command.status,configVersion:Number(config.version) };
    });
  }

  async queueWithdrawal({ runId, leadId, inspectionCommandId }) {
    if (![runId,leadId,inspectionCommandId].every(x=>uuid.test(x||''))) throw new Error('WITHDRAWAL_INVALID');
    return this.db.tx(async q=>{
      const existing=(await q.query(`SELECT id FROM callum_v2.action_intents WHERE run_id=$1 AND lead_id=$2
        AND action_type='withdraw' LIMIT 1`,[runId,leadId])).rows[0];
      if(existing)throw new Error('WITHDRAWAL_ALREADY_RESERVED');
      const run=(await q.query(`SELECT r.*,l.profile_key,l.linkedin_url,l.full_name,o.cohort FROM callum_v2.runs r
        JOIN callum_v2.run_leads l ON l.run_id=r.id AND l.lead_id=$2
        JOIN callum_v2.operators o ON o.id=r.operator_id AND o.enabled=true
        WHERE r.id=$1 AND r.status IN ('running','completed') FOR UPDATE OF r`,[runId,leadId])).rows[0];
      if (!run || !run.installation_id || run.mode !== 'live_canary' || !process.env.V2_QA_PROFILE_KEY ||
          run.profile_key !== process.env.V2_QA_PROFILE_KEY.toLowerCase() || !run.full_name?.trim()) throw new Error('QA_RECIPIENT_REQUIRED');
      const config=await this.activeConfig(q,{cohort:run.cohort,extension_version:CURRENT_EXTENSION_VERSION});
      if (['invitationPage','invitationCard','invitationProfile','invitationAge','invitationWithdraw','withdrawDialog','withdrawConfirm'].some(key=>!config.config[key]?.length) ||
          !config.config.labels.withdrawDialog?.length || !config.config.labels.withdrawConfirm?.length) throw new Error('CONFIG_INCOMPATIBLE');
      const source=(await q.query(`SELECT c.id,c.config_version,o.facts FROM callum_v2.commands c
        JOIN callum_v2.observations o ON o.command_id=c.id
        WHERE c.id=$1 AND c.run_id=$2 AND c.lead_id=$3 AND c.type='INSPECT_PENDING_INVITATION'
          AND c.status='completed' AND c.result->>'status'='observed' AND c.installation_id=$6
          AND c.target_profile_key=$4 AND c.target_url=$5
          AND o.created_at>now()-INTERVAL '2 minutes'`,
        [inspectionCommandId,runId,leadId,run.profile_key,SENT_INVITATIONS_URL,run.installation_id])).rows[0];
      if (!source || Number(source.config_version)!==Number(config.version) || source.facts.invitationEligible!==true) throw new Error('WITHDRAWAL_PRECONDITION_FAILED');
      const otherIntent=(await q.query(`SELECT id FROM callum_v2.action_intents WHERE lead_id=$1
        AND action_type<>'withdraw' AND state IN ('reserved','submitted','reconcile_required') LIMIT 1`,[leadId])).rows[0];
      if (otherIntent) throw new Error('ACTION_CONFLICT');
      const target=(await q.query(`INSERT INTO callum_v2.action_targets(action_type,target_key)
        VALUES ('withdraw',$1) ON CONFLICT DO NOTHING RETURNING target_key`,[run.profile_key])).rows[0];
      if (!target) throw new Error('WITHDRAWAL_ALREADY_RESERVED');
      const intent=(await q.query(`INSERT INTO callum_v2.action_intents(run_id,operator_id,lead_id,action_type,target_key,state)
        VALUES ($1,$2,$3,'withdraw',$4,'reserved') ON CONFLICT DO NOTHING RETURNING id,state,run_id`,
        [runId,run.operator_id,leadId,run.profile_key])).rows[0];
      if (!intent || intent.state!=='reserved' || intent.run_id!==runId) throw new Error('WITHDRAWAL_ALREADY_RESERVED');
      const lead={id:leadId,profile_key:run.profile_key,linkedin_url:SENT_INVITATIONS_URL};
      const command=await this.enqueue(q,{...run,config_version:config.version},lead,'EXECUTE_WITHDRAW',
        `withdraw:${intent.id}`,intent.id,{expectedName:run.full_name,sourceInspectionId:inspectionCommandId});
      await this.reopenRun(q,run,command);
      await q.query("UPDATE callum_v2.run_leads SET stage='awaiting_action',updated_at=now() WHERE run_id=$1 AND lead_id=$2",[runId,leadId]);
      await this.event(q,{event_key:`intent:${intent.id}:reserved`,event_type:'withdrawal_reserved',
        operator_id:run.operator_id,run_id:runId,lead_id:leadId,command_id:command.id,action_intent_id:intent.id,
        config_version:Number(config.version),details:{sourceInspectionId:inspectionCommandId}});
      return {id:command.id,type:command.type,status:command.status,configVersion:Number(config.version)};
    });
  }

  async createCommentDraft({runId,leadId,inspectionCommandId,body}) {
    if(![runId,leadId,inspectionCommandId].every(x=>uuid.test(x||'')) || typeof body!=='string' || body!==body.trim() || body.length<2 || body.length>1250 || /[\u0000-\u001f\u007f]/.test(body))throw new Error('COMMENT_DRAFT_INVALID');
    return this.db.tx(async q=>{
      const source=(await q.query(`SELECT c.payload,c.status,c.type,c.run_id,c.lead_id,c.result,o.facts FROM callum_v2.commands c
        JOIN callum_v2.observations o ON o.command_id=c.id WHERE c.id=$1`,[inspectionCommandId])).rows[0];
      const post=linkedInPostUrl(source?.payload?.postUrl);
      if(!source||source.run_id!==runId||source.lead_id!==leadId||source.type!=='INSPECT_COMMENT_STATE'||source.status!=='completed'||source.result?.status!=='observed'||!post||
          !source.facts?.profileMatched||!source.facts?.pageReady||!source.facts?.targetPostPresent||!source.facts?.targetPostAuthoredByLead||!source.facts?.commentBoxAvailable)throw new Error('COMMENT_INSPECTION_REQUIRED');
      const row=(await q.query(`INSERT INTO callum_v2.comment_drafts(run_id,lead_id,inspection_command_id,post_url,body,body_sha256)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,status,post_url,body,body_sha256,created_at`,[runId,leadId,inspectionCommandId,post,body,hash(body)])).rows[0];
      await this.event(q,{event_key:`draft:${row.id}:created`,event_type:'comment_draft_created',run_id:runId,lead_id:leadId,details:{postUrl:post,bodySha256:row.body_sha256}});
      return row;
    });
  }

  async reviewCommentDraft({draftId,decision,reviewer}) {
    if(!uuid.test(draftId||'')||!['approve','reject'].includes(decision)||typeof reviewer!=='string'||!/^[a-z][a-z0-9_.-]{1,63}$/i.test(reviewer))throw new Error('COMMENT_REVIEW_INVALID');
    return this.db.tx(async q=>{
      const draft=(await q.query(`SELECT d.*,r.operator_id,r.installation_id,r.mode,r.status AS run_status,l.profile_key,l.linkedin_url,l.full_name,o.cohort,i.actor_profile_key
        FROM callum_v2.comment_drafts d JOIN callum_v2.runs r ON r.id=d.run_id
        JOIN callum_v2.run_leads l ON l.run_id=d.run_id AND l.lead_id=d.lead_id
        JOIN callum_v2.operators o ON o.id=r.operator_id AND o.enabled=true
        LEFT JOIN callum_v2.installations i ON i.id=r.installation_id
        WHERE d.id=$1 FOR UPDATE OF d,r`,[draftId])).rows[0];
      if(!draft||draft.status!=='draft')throw new Error('COMMENT_DRAFT_NOT_OPEN');
      if(decision==='reject'){
        await q.query("UPDATE callum_v2.comment_drafts SET status='rejected',reviewer=$2,reviewed_at=now() WHERE id=$1",[draftId,reviewer]);
        await this.event(q,{event_key:`draft:${draftId}:rejected`,event_type:'comment_draft_rejected',operator_id:draft.operator_id,run_id:draft.run_id,lead_id:draft.lead_id});
        return {id:draftId,status:'rejected'};
      }
      if(!['running','completed'].includes(draft.run_status)||draft.mode!=='live_canary'||!draft.installation_id||!draft.actor_profile_key||
        !process.env.V2_QA_PROFILE_KEY||draft.profile_key!==process.env.V2_QA_PROFILE_KEY.toLowerCase()||!draft.full_name?.trim())throw new Error('QA_RECIPIENT_REQUIRED');
      const config=await this.activeConfig(q,{cohort:draft.cohort,extension_version:CURRENT_EXTENSION_VERSION});
      if(['postScope','postDetailScope','postLink','postAuthor','viewerProfile','viewerMenuTrigger','viewerMenu','viewerMenuProfile',
        'commentButton','commentItem','commentOptionButton','commentAuthor','commentText','commentEditor','commentSubmit'].some(k=>!config.config[k]?.length) ||
        !config.config.labels.commentSubmit?.length)throw new Error('CONFIG_INCOMPATIBLE');
      const source=(await q.query(`SELECT c.config_version,c.installation_id,c.target_profile_key,c.payload,o.facts FROM callum_v2.commands c
        JOIN callum_v2.observations o ON o.command_id=c.id
        WHERE c.id=$1 AND c.run_id=$2 AND c.lead_id=$3 AND c.type='INSPECT_COMMENT_STATE' AND c.status='completed'
          AND c.result->>'status'='observed' AND o.created_at>now()-INTERVAL '2 minutes'`,[draft.inspection_command_id,draft.run_id,draft.lead_id])).rows[0];
      if(!source||source.installation_id!==draft.installation_id||Number(source.config_version)!==Number(config.version)||
        source.target_profile_key!==draft.profile_key||source.payload?.postUrl!==draft.post_url||source.payload?.actorProfileKey!==draft.actor_profile_key||
        !source.facts?.profileMatched||!source.facts?.pageReady||!source.facts?.targetPostPresent||!source.facts?.targetPostAuthoredByLead||
        !source.facts?.viewerMatched||!source.facts?.commentBoxAvailable)throw new Error('COMMENT_PRECONDITION_FAILED');
      const conflict=(await q.query(`SELECT id FROM callum_v2.action_intents WHERE lead_id=$1 AND state IN ('reserved','submitted','reconcile_required') LIMIT 1`,[draft.lead_id])).rows[0];
      if(conflict)throw new Error('ACTION_CONFLICT');
      const target=(await q.query(`INSERT INTO callum_v2.action_targets(action_type,target_key)
        VALUES ('comment',$1) ON CONFLICT DO NOTHING RETURNING target_key`,[draft.post_url])).rows[0];
      if(!target)throw new Error('COMMENT_ALREADY_RESERVED');
      const intent=(await q.query(`INSERT INTO callum_v2.action_intents(run_id,operator_id,lead_id,action_type,target_key,state)
        VALUES ($1,$2,$3,'comment',$4,'reserved') ON CONFLICT DO NOTHING RETURNING id,state,run_id`,[draft.run_id,draft.operator_id,draft.lead_id,draft.post_url])).rows[0];
      if(!intent||intent.state!=='reserved'||intent.run_id!==draft.run_id)throw new Error('COMMENT_ALREADY_RESERVED');
      const command=await this.enqueue(q,{...draft,id:draft.run_id,config_version:config.version},{id:draft.lead_id,profile_key:draft.profile_key,linkedin_url:draft.linkedin_url},
        'EXECUTE_COMMENT',`comment:${intent.id}`,intent.id,{postUrl:draft.post_url,approvedText:draft.body,bodySha256:draft.body_sha256,
          draftId,actorProfileKey:draft.actor_profile_key,sourceInspectionId:draft.inspection_command_id,expectedName:draft.full_name});
      await this.reopenRun(q,{id:draft.run_id,operator_id:draft.operator_id,status:draft.run_status},command);
      await q.query("UPDATE callum_v2.comment_drafts SET status='approved',reviewer=$2,reviewed_at=now(),action_intent_id=$3 WHERE id=$1",[draftId,reviewer,intent.id]);
      await q.query("UPDATE callum_v2.run_leads SET stage='awaiting_action',updated_at=now() WHERE run_id=$1 AND lead_id=$2",[draft.run_id,draft.lead_id]);
      await this.event(q,{event_key:`intent:${intent.id}:reserved`,event_type:'comment_reserved',operator_id:draft.operator_id,run_id:draft.run_id,
        lead_id:draft.lead_id,command_id:command.id,action_intent_id:intent.id,config_version:Number(config.version),details:{draftId,postUrl:draft.post_url,bodySha256:draft.body_sha256,reviewer}});
      return {id:draftId,status:'approved',commandId:command.id,actionIntentId:intent.id};
    });
  }

  async enqueue(q, run, lead, type, key, actionIntentId = null, payload = {}) {
    const id = randomUUID();
    const expires = new Date(Date.now() + (['EXECUTE_CONNECT','EXECUTE_WITHDRAW','EXECUTE_COMMENT'].includes(type) ? 5 : 30) * 60_000);
    const { rows } = await q.query(`INSERT INTO callum_v2.commands
      (id,run_id,operator_id,lead_id,action_intent_id,type,idempotency_key,target_profile_key,target_url,config_version,protocol_version,payload,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING *`,
      [id, run.run_id || run.id, run.operator_id, lead.id || lead.lead_id, actionIntentId, type, key, lead.profile_key,
        type==='EXECUTE_COMMENT' ? payload.postUrl : lead.linkedin_url, run.config_version, PROTOCOL_VERSION, payload, expires]);
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
        const withdraw=c.type==='EXECUTE_WITHDRAW';
        const comment=c.type==='EXECUTE_COMMENT';
        await q.query("UPDATE callum_v2.commands SET status='uncertain',updated_at=now() WHERE id=$1", [c.id]);
        await q.query("UPDATE callum_v2.action_intents SET state='reconcile_required',updated_at=now() WHERE id=$1 AND state NOT IN ('confirmed','cancelled')", [c.action_intent_id]);
        await q.query("UPDATE callum_v2.run_leads SET stage='reconcile_required',updated_at=now() WHERE run_id=$1 AND lead_id=$2", [c.run_id,c.lead_id]);
        await this.enqueue(q, c, { id: c.lead_id, profile_key: c.profile_key, linkedin_url: withdraw ? SENT_INVITATIONS_URL : c.linkedin_url },
          withdraw ? 'INSPECT_PENDING_INVITATION' : comment ? 'INSPECT_COMMENT_STATE' : 'INSPECT_PROFILE', `reconcile:${c.action_intent_id}`, c.action_intent_id,
          { reconcile: true, expectedName: c.payload?.expectedName || null,...(comment?{postUrl:c.payload.postUrl,approvedText:c.payload.approvedText,actorProfileKey:c.payload.actorProfileKey}: {}) });
        await this.event(q, { event_key: `intent:${c.action_intent_id}:uncertain`, event_type: withdraw ? 'withdrawal_uncertain' : comment ? 'comment_uncertain' : 'connection_uncertain', operator_id: c.operator_id, run_id: c.run_id, lead_id: c.lead_id, command_id: c.id, action_intent_id: c.action_intent_id, config_version: Number(c.config_version), diagnostic_code: 'POSTCONDITION_UNKNOWN' });
        await this.diagnostic(q,{id:c.installation_id,operator_id:c.operator_id},c,'action_lease','POSTCONDITION_UNKNOWN');
      } else {
        await q.query("UPDATE callum_v2.commands SET status='pending',expires_at=now()+INTERVAL '30 minutes',lease_expires_at=NULL,updated_at=now() WHERE id=$1", [c.id]);
      }
    }
  }

  async finishCompletedRun(q, operatorId, runId) {
    const { rows } = await q.query(`UPDATE callum_v2.runs r SET status='completed',updated_at=now()
      WHERE r.id=$1 AND r.operator_id=$2 AND r.status='running'
        AND EXISTS (SELECT 1 FROM callum_v2.run_leads l WHERE l.run_id=r.id)
        AND NOT EXISTS (SELECT 1 FROM callum_v2.run_leads l WHERE l.run_id=r.id AND l.stage<>'completed')
        AND NOT EXISTS (SELECT 1 FROM callum_v2.commands c WHERE c.run_id=r.id AND c.status IN ('pending','leased','uncertain'))
        AND NOT EXISTS (SELECT 1 FROM callum_v2.action_intents i WHERE i.run_id=r.id AND i.state IN ('reserved','submitted','reconcile_required'))
      RETURNING r.id,r.config_version`,[runId,operatorId]);
    for(const run of rows){
      const previous=(await q.query("SELECT count(*)::INT4 AS n FROM callum_v2.events WHERE run_id=$1 AND event_type='run_completed'",[run.id])).rows[0].n;
      await this.event(q,{event_key:`run:${run.id}:completed:${previous+1}`,event_type:'run_completed',
        operator_id:operatorId,run_id:run.id,config_version:run.config_version===null?null:Number(run.config_version)});
    }
  }

  async reopenRun(q,run,command){
    await q.query(`UPDATE callum_v2.runs SET status='running',config_version=$2,updated_at=now()
      WHERE id=$1 AND status IN ('running','completed') AND (status='completed' OR config_version IS DISTINCT FROM $2)`,
      [run.id,command.config_version]);
    if(run.status==='completed')await this.event(q,{event_key:`run:${run.id}:reopened:${command.id}`,event_type:'run_reopened',
      operator_id:run.operator_id,run_id:run.id,command_id:command.id,config_version:Number(command.config_version)});
  }

  async claim(installation) {
    return this.db.tx(async q => {
      const enabled=(await q.query(`SELECT i.disabled,o.enabled FROM callum_v2.installations i
        JOIN callum_v2.operators o ON o.id=i.operator_id WHERE i.id=$1 AND i.operator_id=$2`,
        [installation.id,installation.operator_id])).rows[0];
      if(!enabled||enabled.disabled||!enabled.enabled)throw new Error('UNAUTHORIZED');
      await this.recoverExpired(q, installation.operator_id);
      const config = await this.activeConfig(q, installation);
      const { rows } = await q.query(`SELECT c.* FROM callum_v2.commands c JOIN callum_v2.runs r ON r.id=c.run_id
        WHERE c.operator_id=$1 AND c.status='pending' AND c.expires_at>now() AND r.status='running'
        AND (r.installation_id IS NULL OR r.installation_id=$2) ORDER BY c.created_at,c.id LIMIT 1 FOR UPDATE OF c`, [installation.operator_id, installation.id]);
      const c = rows[0];
      if (!c) return { command: null, config: { version: Number(config.version), value: config.config, checksum: config.checksum } };
      if (Number(c.config_version) !== Number(config.version)) {
        await q.query('UPDATE callum_v2.runs SET config_version=$2,updated_at=now() WHERE id=$1', [c.run_id,config.version]);
        if (['EXECUTE_CONNECT','EXECUTE_WITHDRAW','EXECUTE_COMMENT'].includes(c.type)) {
          const withdraw=c.type==='EXECUTE_WITHDRAW';
          const comment=c.type==='EXECUTE_COMMENT';
          await q.query("UPDATE callum_v2.commands SET status='cancelled',updated_at=now() WHERE id=$1", [c.id]);
          await q.query("UPDATE callum_v2.action_intents SET state='reconcile_required',updated_at=now() WHERE id=$1 AND state='reserved'", [c.action_intent_id]);
          await q.query("UPDATE callum_v2.run_leads SET stage='reconcile_required',updated_at=now() WHERE run_id=$1 AND lead_id=$2",[c.run_id,c.lead_id]);
          await this.enqueue(q, { ...c, config_version: config.version }, { id:c.lead_id,profile_key:c.target_profile_key,linkedin_url:c.target_url },
            withdraw ? 'INSPECT_PENDING_INVITATION' : comment ? 'INSPECT_COMMENT_STATE' : 'INSPECT_PROFILE', `reconcile:${c.action_intent_id}`, c.action_intent_id,
            { reconcile:true, expectedName:c.payload?.expectedName || null,...(comment?{postUrl:c.payload.postUrl,approvedText:c.payload.approvedText,actorProfileKey:c.payload.actorProfileKey}: {}) });
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
      const { rows } = await q.query(`SELECT c.*,i.state AS intent_state,i.action_type AS intent_type,r.status AS run_status,r.mode AS run_mode,r.installation_id AS run_installation_id,
        installation.disabled AS installation_disabled,op.enabled AS operator_enabled FROM callum_v2.commands c
        JOIN callum_v2.action_intents i ON i.id=c.action_intent_id JOIN callum_v2.runs r ON r.id=c.run_id
        JOIN callum_v2.installations installation ON installation.id=c.installation_id
        JOIN callum_v2.operators op ON op.id=c.operator_id
        WHERE c.id=$1 AND c.operator_id=$2 FOR UPDATE OF c`, [commandId, installation.operator_id]);
      const c = rows[0];
      const withdraw=c?.type==='EXECUTE_WITHDRAW';
      const comment=c?.type==='EXECUTE_COMMENT';
      if (!c || c.installation_disabled || !c.operator_enabled || !['EXECUTE_CONNECT','EXECUTE_WITHDRAW','EXECUTE_COMMENT'].includes(c.type) || c.intent_type !== (withdraw?'withdraw':comment?'comment':'connect') ||
          c.installation_id !== installation.id || c.status !== 'leased' || c.intent_state !== 'reserved' ||
          c.run_status !== 'running' || c.expires_at <= new Date() || c.lease_expires_at <= new Date()) throw new Error('ACTION_NOT_AUTHORIZED');
      if (c.run_mode!=='live_canary' || c.run_installation_id!==installation.id || !process.env.V2_QA_PROFILE_KEY ||
          c.target_profile_key!==process.env.V2_QA_PROFILE_KEY.toLowerCase()) throw new Error('ACTION_NOT_AUTHORIZED');
      await this.assertNoV1Assignment(q, c.lead_id, 'ACTION_NOT_AUTHORIZED');
      if (withdraw) {
        const source=(await q.query(`SELECT o.facts FROM callum_v2.observations o JOIN callum_v2.commands source ON source.id=o.command_id
          WHERE source.id=$1 AND source.run_id=$2 AND source.lead_id=$3 AND source.type='INSPECT_PENDING_INVITATION'
            AND source.status='completed' AND source.config_version=$4 AND o.created_at>now()-INTERVAL '5 minutes'`,
          [c.payload?.sourceInspectionId,c.run_id,c.lead_id,c.config_version])).rows[0];
        if (source?.facts?.invitationEligible!==true) throw new Error('ACTION_NOT_AUTHORIZED');
      }
      if(comment){
        if(!installation.actor_profile_key||
          c.payload?.actorProfileKey!==installation.actor_profile_key)throw new Error('ACTION_NOT_AUTHORIZED');
        const draft=(await q.query(`SELECT status,body,body_sha256,post_url,inspection_command_id FROM callum_v2.comment_drafts
          WHERE id=$1 AND action_intent_id=$2`,[c.payload?.draftId,c.action_intent_id])).rows[0];
        const source=(await q.query(`SELECT source.config_version,source.installation_id,source.payload,o.facts FROM callum_v2.commands source
          JOIN callum_v2.observations o ON o.command_id=source.id WHERE source.id=$1 AND source.run_id=$2 AND source.lead_id=$3
            AND source.type='INSPECT_COMMENT_STATE' AND source.status='completed' AND o.created_at>now()-INTERVAL '5 minutes'`,
          [c.payload?.sourceInspectionId,c.run_id,c.lead_id])).rows[0];
        if(draft?.status!=='approved'||draft.body!==c.payload?.approvedText||draft.body_sha256!==hash(draft.body)||
          draft.post_url!==c.payload?.postUrl||draft.inspection_command_id!==c.payload?.sourceInspectionId||
          !source||source.installation_id!==installation.id||Number(source.config_version)!==Number(c.config_version)||
          source.payload?.postUrl!==draft.post_url||source.payload?.actorProfileKey!==installation.actor_profile_key||
          !source.facts?.profileMatched||!source.facts?.targetPostAuthoredByLead||!source.facts?.viewerMatched||!source.facts?.commentBoxAvailable)
          throw new Error('ACTION_NOT_AUTHORIZED');
      }
      const config = await this.activeConfig(q, installation);
      if (Number(config.version) !== Number(c.config_version) || (await this.flagDisabled(q, installation, c.type, c.config_version)).length) throw new Error('ACTION_NOT_AUTHORIZED');
      await q.query("UPDATE callum_v2.action_intents SET state='submitted',updated_at=now() WHERE id=$1 AND state='reserved'", [c.action_intent_id]);
      await this.event(q, { event_key:`intent:${c.action_intent_id}:authorized`, event_type:withdraw?'withdrawal_authorized':comment?'comment_authorized':'connection_authorized',
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
      const finish=async outcome=>{
        await this.finishCompletedRun(q,installation.operator_id,c.run_id);
        return outcome;
      };
      if (!c || c.installation_id !== installation.id) throw new Error('COMMAND_NOT_OWNED');
      if (c.status === 'completed') return finish({ duplicate: true, state: c.status });
      if (!['leased', 'uncertain'].includes(c.status)) throw new Error('COMMAND_NOT_ACTIVE');
      const facts = result.facts;
      const finishActionOutcome=async outcome=>{
        if(['paused','reconcile_required'].includes(outcome.stage))await this.diagnostic(q,installation,c,'action',
          facts.diagnosticCode==='OK' ? result.status==='not_submitted' ? 'UNEXPECTED_BROWSER_STATE' : 'POSTCONDITION_UNKNOWN' : facts.diagnosticCode);
        return finish(outcome);
      };
      if (facts.profileKey !== c.target_profile_key.toLowerCase()) facts.profileMatched = false;
      if (c.type !== 'EXTRACT_CONTACT_INFO' || c.mode !== 'live_canary' || result.status !== 'observed' ||
        !process.env.V2_QA_PROFILE_KEY || c.target_profile_key !== process.env.V2_QA_PROFILE_KEY.toLowerCase() ||
        !facts.profileMatched || !facts.pageReady || !facts.contactInfoOpened) facts.contactEmail = null;
      const commentObservation=c.type==='INSPECT_COMMENT_STATE';
      const commentAction=c.type==='EXECUTE_COMMENT';
      if (!(commentObservation||commentAction) || (commentObservation&&result.status!=='observed') || !facts.profileMatched || !facts.pageReady) {
        facts.postUrls=[];facts.targetPostPresent=false;facts.commentBoxAvailable=false;facts.targetPostAuthoredByLead=false;
        facts.viewerMatched=false;facts.ownCommentPresent=false;
      } else {
        const targetPost=linkedInPostUrl(c.payload?.postUrl);
        facts.targetPostPresent=!!targetPost && facts.postUrls.includes(targetPost);
        if (!facts.targetPostPresent){facts.commentBoxAvailable=false;facts.targetPostAuthoredByLead=false;}
        facts.viewerMatched=facts.viewerMatched && !!installation.actor_profile_key && c.payload?.actorProfileKey===installation.actor_profile_key;
        facts.ownCommentPresent=facts.ownCommentPresent && facts.targetPostPresent && facts.targetPostAuthoredByLead && facts.viewerMatched &&
          typeof c.payload?.approvedText==='string' && c.payload.approvedText.length>0;
      }
      facts.commentTargetVerified=commentAction && facts.commentTargetVerified && facts.targetPostPresent && facts.targetPostAuthoredByLead && facts.viewerMatched;
      facts.commentEditorVerified=commentAction && facts.commentTargetVerified && facts.commentEditorVerified;
      facts.commentPostcondition=commentAction && result.status==='confirmed' && facts.commentEditorVerified && facts.ownCommentPresent && facts.commentPostcondition;
      const invitationObservation=c.type==='INSPECT_PENDING_INVITATION' && result.status==='observed';
      const withdrawalAction=c.type==='EXECUTE_WITHDRAW';
      if (!(invitationObservation || withdrawalAction) || !facts.profileMatched || !facts.pageReady || !facts.invitationNameMatched) {
        facts.invitationFound=false;facts.invitationNameMatched=false;facts.invitationWithdrawAvailable=false;facts.invitationAgeDays=null;
      }
      facts.invitationEligible=invitationObservation && facts.invitationFound && facts.invitationNameMatched && facts.invitationWithdrawAvailable && facts.invitationAgeDays >= 30;
      facts.withdrawalTargetVerified=withdrawalAction && facts.withdrawalTargetVerified && facts.profileMatched && facts.invitationNameMatched && facts.invitationAgeDays >= 30;
      facts.withdrawalConfirmationOpened=withdrawalAction && facts.withdrawalTargetVerified && facts.withdrawalConfirmationOpened;
      facts.withdrawalPostcondition=withdrawalAction && result.status==='confirmed' && facts.withdrawalTargetVerified && facts.withdrawalConfirmationOpened &&
        facts.withdrawalPostcondition && facts.pageReady && !facts.invitationFound;
      await q.query('INSERT INTO callum_v2.observations(command_id,run_id,lead_id,facts,diagnostic_code) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (command_id) DO NOTHING', [c.id,c.run_id,c.lead_id,facts,facts.diagnosticCode]);
      await q.query("UPDATE callum_v2.command_attempts SET finished_at=now(),outcome=$2 WHERE command_id=$1 AND finished_at IS NULL", [c.id,result.status]);
      await q.query("UPDATE callum_v2.commands SET status='completed',result=$2,updated_at=now() WHERE id=$1", [c.id,result]);
      await this.event(q, { event_key: `command:${c.id}:result`, event_type: 'observation_completed', operator_id: c.operator_id,
        installation_id: installation.id, run_id: c.run_id, lead_id: c.lead_id, command_id: c.id, action_intent_id: c.action_intent_id,
        extension_version: installation.extension_version, build_sha: installation.build_sha, protocol_version: PROTOCOL_VERSION,
        config_version: Number(c.config_version), diagnostic_code: facts.diagnosticCode });
      if (c.type === 'EXECUTE_CONNECT') return finishActionOutcome(await this.finishAction(q, installation, c, result));
      if (c.type === 'EXECUTE_WITHDRAW') return finishActionOutcome(await this.finishWithdraw(q, installation, c, result));
      if (c.type === 'EXECUTE_COMMENT') return finishActionOutcome(await this.finishComment(q, installation, c, result));
      if (c.type === 'INSPECT_COMMENT_STATE' || c.type === 'EXTRACT_CONTACT_INFO' || c.type === 'INSPECT_PENDING_INVITATION') {
        await this.event(q,{event_key:`command:${c.id}:inspection`,event_type:c.type === 'INSPECT_COMMENT_STATE' ? 'comment_state_observed' : c.type === 'INSPECT_PENDING_INVITATION' ? 'pending_invitation_observed' : facts.contactEmail ? 'contact_info_confirmed' : 'contact_info_observed',
          operator_id:c.operator_id,installation_id:installation.id,run_id:c.run_id,lead_id:c.lead_id,command_id:c.id,
          extension_version:installation.extension_version,build_sha:installation.build_sha,protocol_version:PROTOCOL_VERSION,
          config_version:Number(c.config_version),diagnostic_code:facts.diagnosticCode});
        if (!facts.profileMatched || !facts.pageReady) await this.diagnostic(q,installation,c,'inspection',facts.diagnosticCode);
        if(c.type==='INSPECT_COMMENT_STATE' && c.payload?.reconcile===true && c.action_intent_id){
          const intent=(await q.query('SELECT state FROM callum_v2.action_intents WHERE id=$1',[c.action_intent_id])).rows[0];
          if(intent?.state==='confirmed'||intent?.state==='cancelled')return finish({duplicate:false,stage:c.stage});
          const authorized=(await q.query("SELECT id FROM callum_v2.events WHERE action_intent_id=$1 AND event_type='comment_authorized' LIMIT 1",[c.action_intent_id])).rows[0];
          const confirmed=!!authorized&&facts.ownCommentPresent&&facts.targetPostAuthoredByLead&&facts.viewerMatched;
          const stage=confirmed?'completed':'paused';
          if(confirmed)await q.query("UPDATE callum_v2.action_intents SET state='confirmed',updated_at=now() WHERE id=$1 AND state='reconcile_required'",[c.action_intent_id]);
          await q.query('UPDATE callum_v2.run_leads SET stage=$3,updated_at=now() WHERE run_id=$1 AND lead_id=$2',[c.run_id,c.lead_id,stage]);
          const eventId=await this.event(q,{event_key:`intent:${c.action_intent_id}:reconciled`,event_type:confirmed?'comment_confirmed':'comment_not_observed',
            operator_id:c.operator_id,installation_id:installation.id,run_id:c.run_id,lead_id:c.lead_id,command_id:c.id,
            action_intent_id:c.action_intent_id,config_version:Number(c.config_version),diagnostic_code:facts.diagnosticCode});
          if(confirmed)await this.applyPay(q,c,eventId,'comment_confirmed');
          if(!confirmed)await this.diagnostic(q,installation,c,'reconciliation',facts.diagnosticCode==='OK'?'POSTCONDITION_UNKNOWN':facts.diagnosticCode);
          return finish({duplicate:false,stage});
        }
        if (c.type==='INSPECT_PENDING_INVITATION' && c.payload?.reconcile===true && c.action_intent_id) {
          const intent=(await q.query('SELECT state FROM callum_v2.action_intents WHERE id=$1',[c.action_intent_id])).rows[0];
          if (intent?.state==='confirmed' || intent?.state==='cancelled') return finish({duplicate:false,stage:c.stage});
          await q.query("UPDATE callum_v2.run_leads SET stage='paused',updated_at=now() WHERE run_id=$1 AND lead_id=$2",[c.run_id,c.lead_id]);
          await this.event(q,{event_key:`intent:${c.action_intent_id}:reconciled_observation`,event_type:'withdrawal_reconciliation_observed',
            operator_id:c.operator_id,installation_id:installation.id,run_id:c.run_id,lead_id:c.lead_id,command_id:c.id,
            action_intent_id:c.action_intent_id,config_version:Number(c.config_version),diagnostic_code:facts.diagnosticCode,
            details:{invitationFound:facts.invitationFound}});
          await this.diagnostic(q,installation,c,'reconciliation',facts.diagnosticCode==='OK'?'POSTCONDITION_UNKNOWN':facts.diagnosticCode);
          return finish({duplicate:false,stage:'paused'});
        }
        return finish({ duplicate:false,stage:c.stage });
      }
      if (c.payload?.reconcile === true && c.action_intent_id) {
        const intent = (await q.query('SELECT state FROM callum_v2.action_intents WHERE id=$1', [c.action_intent_id])).rows[0];
        if (intent?.state === 'confirmed' || intent?.state === 'cancelled') return finish({ duplicate: false, stage: c.stage });
      }
      let choice = decideObservation(c.mode, facts, c.payload?.reconcile === true);
      if (choice.stage === 'awaiting_action') choice = await this.reserveConnect(q, c);
      await q.query('UPDATE callum_v2.run_leads SET stage=$3,updated_at=now() WHERE run_id=$1 AND lead_id=$2', [c.run_id,c.lead_id,choice.stage]);
      if (c.payload?.reconcile === true && c.action_intent_id && choice.event === 'connection_reconciled') {
        await q.query("UPDATE callum_v2.action_intents SET state='confirmed',updated_at=now() WHERE id=$1 AND state='reconcile_required'", [c.action_intent_id]);
      }
      await this.event(q, { event_key: `command:${c.id}:${choice.event}`, event_type: choice.event, operator_id: c.operator_id,
        installation_id: installation.id, run_id: c.run_id, lead_id: c.lead_id, command_id: c.id, action_intent_id: c.action_intent_id,
        extension_version: installation.extension_version, build_sha: installation.build_sha, protocol_version: PROTOCOL_VERSION,
        config_version: Number(c.config_version), diagnostic_code: choice.diagnosticCode || facts.diagnosticCode });
      if (choice.event === 'connection_reconciled' && c.action_intent_id) {
        const confirmedEventId = await this.event(q, { event_key: `intent:${c.action_intent_id}:confirmed`, event_type: 'connection_confirmed',
          operator_id: c.operator_id, installation_id: installation.id, run_id: c.run_id, lead_id: c.lead_id,
          command_id: c.id, action_intent_id: c.action_intent_id, extension_version: installation.extension_version,
          build_sha: installation.build_sha, protocol_version: PROTOCOL_VERSION, config_version: Number(c.config_version), diagnostic_code: facts.diagnosticCode });
        await this.applyPay(q, c, confirmedEventId, 'connection_confirmed');
      }
      if (choice.stage === 'paused') await this.diagnostic(q, installation, c, 'observation', choice.diagnosticCode || facts.diagnosticCode);
      return finish({ duplicate: false, stage: choice.stage });
    });
  }

  async reserveConnect(q, c) {
    const otherIntent=(await q.query(`SELECT id FROM callum_v2.action_intents WHERE lead_id=$1
      AND action_type<>'connect' AND state IN ('reserved','submitted','reconcile_required') LIMIT 1`,[c.lead_id])).rows[0];
    if(otherIntent)return {stage:'paused',event:'connection_reservation_conflict',diagnosticCode:'ACTION_CONFLICT'};
    const op = (await q.query('SELECT daily_connection_limit FROM callum_v2.operators WHERE id=$1 FOR UPDATE', [c.operator_id])).rows[0];
    const used = (await q.query(`SELECT count(*)::INT4 AS n FROM callum_v2.action_intents
      WHERE operator_id=$1 AND action_type='connect' AND created_at >= date_trunc('day',now()) AND state IN ('reserved','submitted','reconcile_required','confirmed')`, [c.operator_id])).rows[0].n;
    if (used >= op.daily_connection_limit) {
      return {stage:'paused',event:'daily_limit_reached',diagnosticCode:'DAILY_LIMIT'};
    }
    const target=(await q.query(`INSERT INTO callum_v2.action_targets(action_type,target_key)
      VALUES ('connect',$1) ON CONFLICT DO NOTHING RETURNING target_key`,[c.target_profile_key])).rows[0];
    if (!target) return {stage:'paused',event:'connection_reservation_conflict',diagnosticCode:'ACTION_CONFLICT'};
    const { rows } = await q.query(`INSERT INTO callum_v2.action_intents(run_id,operator_id,lead_id,action_type,target_key,state)
      VALUES ($1,$2,$3,'connect',$4,'reserved') ON CONFLICT DO NOTHING RETURNING id,state,run_id`, [c.run_id,c.operator_id,c.lead_id,c.target_profile_key]);
    const intent = rows[0];
    if (!intent || intent.state !== 'reserved' || intent.run_id !== c.run_id) {
      return {stage:'paused',event:'connection_reservation_conflict',diagnosticCode:'ACTION_CONFLICT'};
    }
    await this.enqueue(q, c, { id: c.lead_id, profile_key: c.target_profile_key, linkedin_url: c.target_url },
      'EXECUTE_CONNECT', `connect:${intent.id}`, intent.id, { expectedName: c.payload?.expectedName || null });
    await this.event(q, { event_key: `intent:${intent.id}:reserved`, event_type: 'connection_reserved', operator_id: c.operator_id,
      run_id: c.run_id, lead_id: c.lead_id, action_intent_id: intent.id, config_version: Number(c.config_version) });
    return {stage:'awaiting_action',event:'connection_reserved'};
  }

  async finishAction(q, installation, c, result) {
    const intent=(await q.query('SELECT state FROM callum_v2.action_intents WHERE id=$1',[c.action_intent_id])).rows[0];
    if(intent?.state==='confirmed'||intent?.state==='cancelled'){
      const current=(await q.query('SELECT stage FROM callum_v2.run_leads WHERE run_id=$1 AND lead_id=$2',[c.run_id,c.lead_id])).rows[0];
      return {duplicate:false,stage:current?.stage||'paused'};
    }
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

  async finishWithdraw(q, installation, c, result) {
    const intent=(await q.query('SELECT state FROM callum_v2.action_intents WHERE id=$1',[c.action_intent_id])).rows[0];
    if(intent?.state==='confirmed'||intent?.state==='cancelled'){
      const current=(await q.query('SELECT stage FROM callum_v2.run_leads WHERE run_id=$1 AND lead_id=$2',[c.run_id,c.lead_id])).rows[0];
      return {duplicate:false,stage:current?.stage||'paused'};
    }
    const authorization=(await q.query("SELECT id FROM callum_v2.events WHERE action_intent_id=$1 AND event_type='withdrawal_authorized' LIMIT 1",[c.action_intent_id])).rows[0];
    if (result.status==='not_submitted') {
      await q.query("UPDATE callum_v2.action_intents SET state='cancelled',updated_at=now() WHERE id=$1 AND state IN ('reserved','submitted','reconcile_required')",[c.action_intent_id]);
      await q.query("UPDATE callum_v2.commands SET status='cancelled',updated_at=now() WHERE idempotency_key=$1 AND status='pending'",[`reconcile:${c.action_intent_id}`]);
      await q.query("UPDATE callum_v2.run_leads SET stage='paused',updated_at=now() WHERE run_id=$1 AND lead_id=$2",[c.run_id,c.lead_id]);
      await this.event(q,{event_key:`intent:${c.action_intent_id}:not_submitted`,event_type:'withdrawal_not_submitted',
        operator_id:c.operator_id,installation_id:installation.id,run_id:c.run_id,lead_id:c.lead_id,
        command_id:c.id,action_intent_id:c.action_intent_id,config_version:Number(c.config_version),
        diagnostic_code:result.facts.diagnosticCode});
      return {duplicate:false,stage:'paused'};
    }
    const confirmed=!!authorization && result.status==='confirmed' && result.facts.withdrawalPostcondition;
    if (confirmed) {
      await q.query("UPDATE callum_v2.action_intents SET state='confirmed',updated_at=now() WHERE id=$1 AND state IN ('submitted','reconcile_required')",[c.action_intent_id]);
      await q.query("UPDATE callum_v2.commands SET status='cancelled',updated_at=now() WHERE idempotency_key=$1 AND status='pending'",[`reconcile:${c.action_intent_id}`]);
      await q.query("UPDATE callum_v2.run_leads SET stage='completed',updated_at=now() WHERE run_id=$1 AND lead_id=$2",[c.run_id,c.lead_id]);
      await this.event(q,{event_key:`intent:${c.action_intent_id}:confirmed`,event_type:'withdrawal_confirmed',
        operator_id:c.operator_id,installation_id:installation.id,run_id:c.run_id,lead_id:c.lead_id,
        command_id:c.id,action_intent_id:c.action_intent_id,extension_version:installation.extension_version,
        build_sha:installation.build_sha,protocol_version:PROTOCOL_VERSION,config_version:Number(c.config_version),diagnostic_code:'OK'});
      return {duplicate:false,stage:'completed'};
    }
    await q.query("UPDATE callum_v2.action_intents SET state='reconcile_required',updated_at=now() WHERE id=$1 AND state NOT IN ('confirmed','cancelled')",[c.action_intent_id]);
    await q.query("UPDATE callum_v2.run_leads SET stage='reconcile_required',updated_at=now() WHERE run_id=$1 AND lead_id=$2",[c.run_id,c.lead_id]);
    await this.enqueue(q,c,{id:c.lead_id,profile_key:c.target_profile_key,linkedin_url:SENT_INVITATIONS_URL},
      'INSPECT_PENDING_INVITATION',`reconcile:${c.action_intent_id}`,c.action_intent_id,
      {reconcile:true,expectedName:c.payload?.expectedName||null});
    await this.event(q,{event_key:`intent:${c.action_intent_id}:uncertain`,event_type:'withdrawal_uncertain',
      operator_id:c.operator_id,installation_id:installation.id,run_id:c.run_id,lead_id:c.lead_id,
      command_id:c.id,action_intent_id:c.action_intent_id,config_version:Number(c.config_version),
      diagnostic_code:result.facts.diagnosticCode});
    return {duplicate:false,stage:'reconcile_required'};
  }

  async finishComment(q,installation,c,result){
    const intent=(await q.query('SELECT state FROM callum_v2.action_intents WHERE id=$1',[c.action_intent_id])).rows[0];
    if(intent?.state==='confirmed'||intent?.state==='cancelled'){
      const current=(await q.query('SELECT stage FROM callum_v2.run_leads WHERE run_id=$1 AND lead_id=$2',[c.run_id,c.lead_id])).rows[0];
      return {duplicate:false,stage:current?.stage||'paused'};
    }
    const authorization=(await q.query("SELECT id FROM callum_v2.events WHERE action_intent_id=$1 AND event_type='comment_authorized' LIMIT 1",[c.action_intent_id])).rows[0];
    if(result.status==='not_submitted'){
      await q.query("UPDATE callum_v2.action_intents SET state='cancelled',updated_at=now() WHERE id=$1 AND state IN ('reserved','submitted','reconcile_required')",[c.action_intent_id]);
      await q.query("UPDATE callum_v2.commands SET status='cancelled',updated_at=now() WHERE idempotency_key=$1 AND status='pending'",[`reconcile:${c.action_intent_id}`]);
      await q.query("UPDATE callum_v2.run_leads SET stage='paused',updated_at=now() WHERE run_id=$1 AND lead_id=$2",[c.run_id,c.lead_id]);
      await this.event(q,{event_key:`intent:${c.action_intent_id}:not_submitted`,event_type:'comment_not_submitted',operator_id:c.operator_id,
        installation_id:installation.id,run_id:c.run_id,lead_id:c.lead_id,command_id:c.id,action_intent_id:c.action_intent_id,
        config_version:Number(c.config_version),diagnostic_code:result.facts.diagnosticCode});
      return {duplicate:false,stage:'paused'};
    }
    const confirmed=!!authorization&&result.status==='confirmed'&&result.facts.commentPostcondition;
    if(confirmed){
      await q.query("UPDATE callum_v2.action_intents SET state='confirmed',updated_at=now() WHERE id=$1 AND state IN ('submitted','reconcile_required')",[c.action_intent_id]);
      await q.query("UPDATE callum_v2.commands SET status='cancelled',updated_at=now() WHERE idempotency_key=$1 AND status='pending'",[`reconcile:${c.action_intent_id}`]);
      await q.query("UPDATE callum_v2.run_leads SET stage='completed',updated_at=now() WHERE run_id=$1 AND lead_id=$2",[c.run_id,c.lead_id]);
      const eventId=await this.event(q,{event_key:`intent:${c.action_intent_id}:confirmed`,event_type:'comment_confirmed',operator_id:c.operator_id,
        installation_id:installation.id,run_id:c.run_id,lead_id:c.lead_id,command_id:c.id,action_intent_id:c.action_intent_id,
        extension_version:installation.extension_version,build_sha:installation.build_sha,protocol_version:PROTOCOL_VERSION,
        config_version:Number(c.config_version),diagnostic_code:'OK'});
      await this.applyPay(q,c,eventId,'comment_confirmed');
      return {duplicate:false,stage:'completed'};
    }
    await q.query("UPDATE callum_v2.action_intents SET state='reconcile_required',updated_at=now() WHERE id=$1 AND state NOT IN ('confirmed','cancelled')",[c.action_intent_id]);
    await q.query("UPDATE callum_v2.run_leads SET stage='reconcile_required',updated_at=now() WHERE run_id=$1 AND lead_id=$2",[c.run_id,c.lead_id]);
    await this.enqueue(q,c,{id:c.lead_id,profile_key:c.target_profile_key,linkedin_url:c.target_url},'INSPECT_COMMENT_STATE',
      `reconcile:${c.action_intent_id}`,c.action_intent_id,{reconcile:true,expectedName:c.payload.expectedName,
        postUrl:c.payload.postUrl,approvedText:c.payload.approvedText,actorProfileKey:c.payload.actorProfileKey});
    await this.event(q,{event_key:`intent:${c.action_intent_id}:uncertain`,event_type:'comment_uncertain',operator_id:c.operator_id,
      installation_id:installation.id,run_id:c.run_id,lead_id:c.lead_id,command_id:c.id,action_intent_id:c.action_intent_id,
      config_version:Number(c.config_version),diagnostic_code:result.facts.diagnosticCode});
    return {duplicate:false,stage:'reconcile_required'};
  }

  async applyPay(q, c, eventId, eventType) {
    const intent = (await q.query('SELECT * FROM callum_v2.action_intents WHERE id=$1', [c.action_intent_id])).rows[0];
    const authorization = (await q.query('SELECT id FROM callum_v2.events WHERE action_intent_id=$1 AND event_type=$2 LIMIT 1',
      [c.action_intent_id,eventType==='comment_confirmed'?'comment_authorized':'connection_authorized'])).rows[0];
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

  async pauseRun(id) {
    return this.db.tx(async q=>{
      const run=(await q.query("UPDATE callum_v2.runs SET status='paused',updated_at=now() WHERE id=$1 AND status='running' RETURNING id,operator_id",[id])).rows[0];
      if(run)await this.event(q,{event_key:`run:${id}:paused:${randomUUID()}`,event_type:'run_paused',operator_id:run.operator_id,run_id:id});
      return {status:run?'paused':null};
    });
  }
  async resumeRun(id) {
    return this.db.tx(async q=>{
      const run=(await q.query("SELECT * FROM callum_v2.runs WHERE id=$1 AND status='paused' FOR UPDATE",[id])).rows[0];
      if(!run)return {status:null,queued:0};
      const {rows}=await q.query(`SELECT l.* FROM callum_v2.run_leads l WHERE l.run_id=$1 AND l.stage='paused'
        AND NOT EXISTS (SELECT 1 FROM callum_v2.commands c WHERE c.run_id=l.run_id AND c.lead_id=l.lead_id AND c.status IN ('pending','leased'))
        AND NOT EXISTS (SELECT 1 FROM callum_v2.action_intents i WHERE i.run_id=l.run_id AND i.lead_id=l.lead_id
          AND i.state IN ('reserved','submitted','reconcile_required')) ORDER BY l.lead_id`,[id]);
      for(const lead of rows){
        await this.enqueue(q,run,{id:lead.lead_id,profile_key:lead.profile_key,linkedin_url:lead.linkedin_url},'INSPECT_PROFILE',
          `resume:${id}:${lead.lead_id}:${randomUUID()}`,null,{expectedName:lead.full_name});
        await q.query("UPDATE callum_v2.run_leads SET stage='awaiting_observation',updated_at=now() WHERE run_id=$1 AND lead_id=$2",[id,lead.lead_id]);
      }
      await q.query("UPDATE callum_v2.runs SET status='running',updated_at=now() WHERE id=$1",[id]);
      await this.event(q,{event_key:`run:${id}:resumed:${randomUUID()}`,event_type:'run_resumed',operator_id:run.operator_id,run_id:id,details:{requeuedObservations:rows.length}});
      return {status:'running',queued:rows.length};
    });
  }
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

  async createConfig(config, minVersion = CURRENT_EXTENSION_VERSION) {
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
      installations: 'SELECT id,operator_id,extension_version,build_sha,actor_profile_key,disabled,last_seen_at FROM callum_v2.installations ORDER BY created_at DESC LIMIT 100',
      runs: 'SELECT id,operator_id,mode,status,config_version,created_at FROM callum_v2.runs ORDER BY created_at DESC LIMIT 100',
      assignments: 'SELECT run_id,lead_id,full_name,niche,stage FROM callum_v2.run_leads ORDER BY created_at DESC LIMIT 100',
      intents: 'SELECT id,run_id,operator_id,lead_id,action_type,state,updated_at FROM callum_v2.action_intents ORDER BY updated_at DESC LIMIT 100',
      drafts: 'SELECT id,run_id,lead_id,inspection_command_id,post_url,body,body_sha256,status,reviewer,action_intent_id,created_at FROM callum_v2.comment_drafts ORDER BY created_at DESC LIMIT 100',
      events: 'SELECT id,event_type,operator_id,run_id,lead_id,command_id,action_intent_id,config_version,diagnostic_code,created_at FROM callum_v2.events ORDER BY created_at DESC LIMIT 100',
      diagnostics: `SELECT d.operator_id,COALESCE(d.installation_id,c.installation_id) AS installation_id,
        d.run_id,d.lead_id,d.command_id,d.action_intent_id,d.stage,d.code,d.created_at,
        i.extension_version,i.build_sha,c.config_version,c.trace_id,c.type AS command_type,c.status AS command_status,
        r.status AS run_status,l.stage AS lead_stage,a.state AS intent_state,
        rc.id AS reconciliation_command_id,rc.status AS reconciliation_status,
        (SELECT count(*)::INT4 FROM callum_v2.command_attempts t WHERE t.command_id=d.command_id) AS attempt_count,
        o.facts->>'profileMatched' AS profile_matched,o.facts->>'pageReady' AS page_ready,
        o.facts->>'pendingVisible' AS pending_visible,o.facts->>'connectedVisible' AS connected_visible,
        o.facts->>'targetPostPresent' AS target_post_present,o.facts->>'viewerMatched' AS viewer_matched,
        o.facts->>'invitationFound' AS invitation_found,o.facts->>'contactInfoOpened' AS contact_info_opened,
        (o.facts->>'contactEmail') IS NOT NULL AS contact_email_present
        FROM callum_v2.support_diagnostics d
        LEFT JOIN callum_v2.commands c ON c.id=d.command_id
        LEFT JOIN callum_v2.installations i ON i.id=COALESCE(d.installation_id,c.installation_id)
        LEFT JOIN callum_v2.runs r ON r.id=d.run_id
        LEFT JOIN callum_v2.run_leads l ON l.run_id=d.run_id AND l.lead_id=d.lead_id
        LEFT JOIN callum_v2.action_intents a ON a.id=d.action_intent_id
        LEFT JOIN callum_v2.commands rc ON rc.idempotency_key='reconcile:' || d.action_intent_id::STRING
        LEFT JOIN callum_v2.observations o ON o.command_id=d.command_id
        ORDER BY d.created_at DESC,d.id DESC LIMIT 100`,
      observations: `SELECT o.run_id,o.lead_id,o.command_id,c.type,o.diagnostic_code,
        o.facts->>'profileMatched' AS profile_matched,
        o.facts->>'contactInfoOpened' AS contact_info_opened,
        (o.facts->>'contactEmail') IS NOT NULL AS contact_email_present,
        o.facts->>'invitationFound' AS invitation_found,
        o.facts->>'invitationAgeDays' AS invitation_age_days,
        o.facts->>'invitationEligible' AS invitation_eligible,
        o.facts->>'targetPostPresent' AS target_post_present,
        o.facts->>'targetPostAuthoredByLead' AS target_post_authored_by_lead,
        o.facts->>'viewerMatched' AS viewer_matched,
        o.facts->>'ownCommentPresent' AS own_comment_present,
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
