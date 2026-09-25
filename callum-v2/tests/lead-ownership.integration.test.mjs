import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../apps/control-plane/db.mjs';
import { ControlPlane } from '../apps/control-plane/service.mjs';
import { profileKeyFromUrl } from '../packages/protocol/index.mjs';

const enabled = process.env.V2_TEST_DB === '1' && !!process.env.COCKROACH_DATABASE_URL;

test('V2 refuses a live canary run and action for a lead already assigned in V1', { skip: !enabled }, async t => {
  const db = openDatabase();
  const control = new ControlPlane(db);
  const previousQaKey = process.env.V2_QA_PROFILE_KEY;
  try {
    const { rows } = await db.query(`SELECT l.id,l.linkedin_url,l.full_name FROM public.leads l
      JOIN public.lead_assignments a ON a.lead_id=l.id
      WHERE l.linkedin_url LIKE 'https://%linkedin.com/in/%' AND length(trim(l.full_name))>0
      LIMIT 50`);
    const lead = rows.find(row => profileKeyFromUrl(row.linkedin_url));
    const profileKey = lead && profileKeyFromUrl(lead.linkedin_url);
    if (!profileKey) return t.skip('No V1-assigned LinkedIn lead in this catalog');
    process.env.V2_QA_PROFILE_KEY = profileKey;
    await control.seed();
    const operatorId = `v2overlap_${randomUUID().slice(0,8)}`;
    await control.createOperator(operatorId, 'dev', 1);
    const issued = await control.createInstallation(operatorId, '2.5.0', '8b04b5c7');
    const installation = await control.installation(issued.token);
    await assert.rejects(
      () => control.createRun({ operatorId, mode: 'live_canary', count: 1, leadId: lead.id }),
      /CANARY_INSTALLATION_REQUIRED/
    );
    const otherOperatorId = `v2other_${randomUUID().slice(0,8)}`;
    await control.createOperator(otherOperatorId, 'dev', 1);
    const otherIssued = await control.createInstallation(otherOperatorId, '2.5.0', '8b04b5c7');
    await assert.rejects(
      () => control.createRun({ operatorId, mode: 'live_canary', count: 1, leadId: lead.id, installationId: otherIssued.id }),
      /CANARY_INSTALLATION_REQUIRED/
    );
    await assert.rejects(
      () => control.createRun({ operatorId, mode: 'live_canary', count: 1, leadId: lead.id, installationId: installation.id }),
      /V1_LEAD_ASSIGNED/
    );

    // V2-only rows model an assignment appearing after a canary run was created.
    const configVersion = Number((await db.query("SELECT active_config_version FROM callum_v2.release_channels WHERE channel='dev'")).rows[0].active_config_version);
    const run = (await db.query(`INSERT INTO callum_v2.runs(operator_id,installation_id,mode,config_version)
      VALUES ($1,$2,'live_canary',$3) RETURNING id`, [operatorId, installation.id, configVersion])).rows[0];
    await db.query(`INSERT INTO callum_v2.run_leads(run_id,lead_id,profile_key,linkedin_url,full_name)
      VALUES ($1,$2,$3,$4,$5)`, [run.id, lead.id, profileKey, lead.linkedin_url, lead.full_name]);
    const intent = (await db.query(`INSERT INTO callum_v2.action_intents(run_id,operator_id,lead_id,action_type,target_key,state)
      VALUES ($1,$2,$3,'connect',$4,'reserved') RETURNING id`, [run.id, operatorId, lead.id, profileKey])).rows[0];
    await db.tx(q => control.enqueue(q, { id: run.id, operator_id: operatorId, config_version: configVersion },
      { id: lead.id, profile_key: profileKey, linkedin_url: lead.linkedin_url },
      'EXECUTE_CONNECT', `overlap:${run.id}`, intent.id, { expectedName: lead.full_name }));
    const command = (await control.claim(installation)).command;
    assert.equal(command.type, 'EXECUTE_CONNECT');
    await assert.rejects(() => control.authorizeAction(installation, command.id), /ACTION_NOT_AUTHORIZED/);
    const events = await db.query(`SELECT count(*)::INT4 AS n FROM callum_v2.events
      WHERE action_intent_id=$1 AND event_type='connection_authorized'`, [intent.id]);
    assert.equal(events.rows[0].n, 0);

    const unassigned = await db.query(`SELECT l.id,l.linkedin_url FROM public.leads l
      LEFT JOIN public.lead_assignments a ON a.lead_id=l.id
      WHERE a.lead_id IS NULL AND l.linkedin_url LIKE 'https://%linkedin.com/in/%'
        AND length(trim(l.full_name))>0 LIMIT 50`);
    const available = unassigned.rows.find(row => profileKeyFromUrl(row.linkedin_url));
    if (available) {
      process.env.V2_QA_PROFILE_KEY = profileKeyFromUrl(available.linkedin_url);
      const safeRun = await control.createRun({ operatorId, mode: 'live_canary', count: 1,
        leadId: available.id, installationId: installation.id });
      assert.equal(safeRun.selected, 1);
    }
  } finally {
    if (previousQaKey === undefined) delete process.env.V2_QA_PROFILE_KEY;
    else process.env.V2_QA_PROFILE_KEY = previousQaKey;
    await db.close();
  }
});
