import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const DEFAULT_BATCH_SIZE = 250;
const MAX_RETRIES = 10;
const RETRY_DELAY_CAP_MS = 30_000;

await run().catch((error) => {
  console.error(
    `Scout sheet migration failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.COCKROACH_DATABASE_URL;
  const convexUrl = process.env.VITE_CONVEX_URL;
  const provisioningKey = process.env.SCOUT_PROVISIONING_KEY;
  if (!databaseUrl || !convexUrl || !provisioningKey) {
    throw new Error(
      "COCKROACH_DATABASE_URL, VITE_CONVEX_URL, or SCOUT_PROVISIONING_KEY is missing.",
    );
  }

  const filePath = path.resolve(args.file);
  const fileBytes = await readFile(filePath);
  const digest = createHash("sha256").update(fileBytes).digest("hex");
  const payload = JSON.parse(fileBytes.toString("utf8"));
  const sourceRecords = validatePayload(payload);
  const scoutIds = [...new Set(payload.scouts.map((scout) => scout.scout_account))];

  console.log(
    `Validated ${sourceRecords.length.toLocaleString()} source rows for ${scoutIds.length} scouts.`,
  );
  for (const operatorId of scoutIds) {
    await assertScout(convexUrl, provisioningKey, operatorId);
  }
  console.log("All source scout accounts are active in the app.");

  const prepared = prepareSourceRows(sourceRecords);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: true },
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    options: "--statement_timeout=120000",
  });
  pool.on("error", (error) => {
    console.warn(`Database connection dropped while idle: ${error.message}`);
  });

  let migrationId = null;
  try {
    const databaseBefore = await loadDatabaseCounts(pool, scoutIds);
    const existingBefore = await loadExistingByProfileKey(
      pool,
      [...prepared.groups.keys()],
      args.batchSize,
    );
    const plan = buildPlan(prepared, existingBefore);
    const dryRun = summarizePlan(
      payload,
      prepared,
      plan,
      existingBefore,
      databaseBefore,
    );
    console.log(JSON.stringify({ mode: args.mode, digest, ...dryRun }, null, 2));

    if (args.mode === "dry-run") {
      console.log("Dry run complete. No database rows were changed.");
      return;
    }

    await ensureMigrationTables(pool);
    const existingMigration = await pool.query(
      `SELECT id::STRING AS id, status, stats
         FROM scout_sheet_migrations
        WHERE sha256 = $1`,
      [digest],
    );
    if (existingMigration.rows[0]?.status === "completed" && !args.force) {
      console.log("This exact export was already migrated successfully.");
      const nicheStats = args.niche
        ? await linkMigrationToNiche(pool, existingMigration.rows[0].id, args.niche)
        : {};
      const verification = await verifyMigration(
        pool,
        existingMigration.rows[0].id,
        scoutIds,
        digest,
      );
      const refreshedStats = {
        ...(existingMigration.rows[0].stats ?? {}),
        ...verification,
        ...nicheStats,
      };
      await pool.query(
        `UPDATE scout_sheet_migrations
            SET stats = $2::JSONB,
                updated_at = now()
          WHERE id = $1::UUID`,
        [existingMigration.rows[0].id, JSON.stringify(refreshedStats)],
      );
      console.log(JSON.stringify(refreshedStats, null, 2));
      return;
    }

    const backupPath = await writeScopedBackup(
      pool,
      existingBefore,
      filePath,
      digest,
      args.backupDir,
      databaseBefore,
    );
    const migrationResult = await pool.query(
      `INSERT INTO scout_sheet_migrations
        (source_name, sha256, total_rows, status, stats, backup_file, error_message, started_at, completed_at, updated_at)
       VALUES ($1, $2, $3, 'importing', $4::JSONB, $5, NULL, now(), NULL, now())
       ON CONFLICT (sha256) DO UPDATE SET
         source_name = excluded.source_name,
         total_rows = excluded.total_rows,
         status = 'importing',
         stats = excluded.stats,
         backup_file = excluded.backup_file,
         error_message = NULL,
         started_at = now(),
         completed_at = NULL,
         updated_at = now()
       RETURNING id::STRING AS id`,
      [
        path.basename(filePath),
        digest,
        sourceRecords.length,
        JSON.stringify({ phase: "starting", dryRun }),
        backupPath,
      ],
    );
    migrationId = migrationResult.rows[0].id;

    const actionRows = plan.actionable.map((entry) =>
      mergeProfileRecords(entry, payload.metadata?.source_title ?? path.basename(filePath)),
    );
    await runBatches(actionRows, args.batchSize, "upsert canonical leads", async (batch) => {
      await upsertLeads(pool, batch);
    });

    const afterLeadUpsert = await loadExistingByProfileKey(
      pool,
      plan.actionable.map((entry) => entry.profileKey),
      args.batchSize,
    );
    const assignmentRows = actionRows.map((row) => {
      const existing = afterLeadUpsert.get(row.profile_key);
      if (!existing) {
        throw new Error(`Lead ${row.profile_key} was not readable after upsert.`);
      }
      return {
        lead_id: existing.lead_id,
        operator_id: row.operator_id,
        status: row.assignment_status,
        assigned_at: row.assigned_at,
        connection_requested_at: row.connection_requested_at,
        accepted_at: row.accepted_at,
        email_collected_at: row.email_collected_at,
        resolved_linkedin_url: row.linkedin_url,
        email: row.original_email,
      };
    });
    await runBatches(assignmentRows, args.batchSize, "create and enrich assignments", async (batch) => {
      await upsertAssignments(pool, batch);
    });

    const finalExisting = await loadExistingByProfileKey(
      pool,
      [...prepared.groups.keys()],
      args.batchSize,
    );
    const auditRows = buildAuditRows(
      migrationId,
      prepared,
      plan,
      finalExisting,
    );
    await runBatches(auditRows, args.batchSize, "preserve migration audit rows", async (batch) => {
      await upsertAuditRows(pool, batch);
    });

    await pool.query(
      `UPSERT INTO lead_stats (key, total_count, updated_at)
       SELECT 'all', count(*), now() FROM leads`,
    );

    const nicheStats = args.niche
      ? await linkMigrationToNiche(pool, migrationId, args.niche)
      : {};
    const verification = await verifyMigration(
      pool,
      migrationId,
      scoutIds,
      digest,
    );
    if (verification.audit_rows !== sourceRecords.length) {
      throw new Error(
        `Audit row mismatch: expected ${sourceRecords.length}, found ${verification.audit_rows}.`,
      );
    }
    const finalStats = {
      ...dryRun,
      ...verification,
      ...nicheStats,
      backup_file: backupPath,
      completed_at: new Date().toISOString(),
    };
    await pool.query(
      `UPDATE scout_sheet_migrations
          SET status = 'completed',
              stats = $2::JSONB,
              error_message = NULL,
              completed_at = now(),
              updated_at = now()
        WHERE id = $1::UUID`,
      [migrationId, JSON.stringify(finalStats)],
    );
    console.log("Migration completed and independently reconciled.");
    console.log(JSON.stringify(finalStats, null, 2));
  } catch (error) {
    if (migrationId) {
      await pool.query(
        `UPDATE scout_sheet_migrations
            SET status = 'failed',
                error_message = $2,
                updated_at = now()
          WHERE id = $1::UUID`,
        [migrationId, String(error).slice(0, 4000)],
      ).catch(() => {});
    }
    throw error;
  } finally {
    await pool.end();
  }
}

function validatePayload(payload) {
  if (!payload || !Array.isArray(payload.records) || !Array.isArray(payload.scouts)) {
    throw new Error("The migration file is not a scout lead export.");
  }
  const expectedRows = Number(payload.metadata?.record_count ?? payload.records.length);
  if (payload.records.length !== expectedRows || payload.records.length < 1) {
    throw new Error("The export record count does not match its metadata.");
  }
  const scouts = new Set(payload.scouts.map((scout) => scout.scout_account));
  for (const record of payload.records) {
    if (!scouts.has(record.scout_account)) {
      throw new Error(`Unknown scout account in export: ${record.scout_account}`);
    }
    if (!record.source_sheet || !Number.isSafeInteger(Number(record.source_row))) {
      throw new Error("Every export record must have a source sheet and row.");
    }
  }
  return payload.records;
}

function prepareSourceRows(records) {
  const rows = records.map((record, index) => {
    const linkedinUrl = normalizeLinkedInUrl(record.linkedin_url || record.linkedin_url_raw);
    const profileKey = linkedinUrl
      ? createHash("sha256").update(linkedinUrl).digest("hex")
      : null;
    return { index, record, linkedinUrl, profileKey };
  });
  const groups = new Map();
  for (const row of rows) {
    if (!row.profileKey) continue;
    const group = groups.get(row.profileKey) ?? [];
    group.push(row);
    groups.set(row.profileKey, group);
  }
  return { rows, groups };
}

function buildPlan(prepared, existingByKey) {
  const actionable = [];
  const conflicts = [];
  for (const [profileKey, rows] of prepared.groups) {
    const existing = existingByKey.get(profileKey);
    const operators = [...new Set(rows.map((row) => row.record.scout_account))];
    const existingOperator = existing?.operator_id ?? null;
    let operatorId = null;
    if (existingOperator) {
      if (operators.includes(existingOperator)) operatorId = existingOperator;
    } else {
      operatorId = rows[0].record.scout_account;
    }
    if (!operatorId) {
      conflicts.push({ profileKey, rows, existing, operators });
      continue;
    }
    const ownerRows = rows.filter((row) => row.record.scout_account === operatorId);
    actionable.push({
      profileKey,
      rows,
      ownerRows,
      operatorId,
      existing,
      operators,
    });
  }
  return { actionable, conflicts };
}

function summarizePlan(payload, prepared, plan, existingByKey, databaseBefore) {
  const validRows = prepared.rows.filter((row) => row.profileKey).length;
  const existingLeads = [...prepared.groups.keys()].filter((key) => existingByKey.has(key)).length;
  const existingAssignmentConflicts = plan.conflicts.reduce(
    (total, group) => total + group.rows.length,
    0,
  );
  const selectedOwnerRows = plan.actionable.reduce(
    (total, group) => total + group.ownerRows.length,
    0,
  );
  return {
    source_rows: prepared.rows.length,
    source_scouts: payload.scouts.length,
    valid_linkedin_rows: validRows,
    invalid_linkedin_rows: prepared.rows.length - validRows,
    unique_profiles: prepared.groups.size,
    existing_canonical_leads: existingLeads,
    new_canonical_leads_planned: prepared.groups.size - existingLeads,
    actionable_unique_profiles: plan.actionable.length,
    existing_assignment_conflict_profiles: plan.conflicts.length,
    existing_assignment_conflict_rows: existingAssignmentConflicts,
    same_owner_source_rows_merged: selectedOwnerRows - plan.actionable.length,
    cross_scout_duplicate_rows_skipped:
      validRows - selectedOwnerRows - existingAssignmentConflicts,
    database_before: databaseBefore,
  };
}

function mergeProfileRecords(entry, sourceTitle) {
  const records = entry.ownerRows.map((row) => row.record);
  const first = records[0];
  const email = firstNonEmpty(records, "email");
  const emailDate = firstDate(records, "email_added_date");
  const leadDate = firstDate(records, "lead_added_date");
  const connectedDate = firstDate(records, "connected_date");
  const requestDate = firstDate(records, "connection_request_sent_date");
  const isConnected = records.some((record) => record.connected === true);
  const hasRequestSignal = records.some((record) =>
    ["request_sent", "request_sent_without_note", "no_response"].includes(
      record.connection_status,
    )
  );
  const assignmentStatus = email
    ? "email_collected"
    : isConnected
      ? "accepted"
    : requestDate || hasRequestSignal
      ? "connection_requested"
      : "assigned";
  const migrationTime = new Date().toISOString();
  const noteParts = [];
  for (const record of records) {
    const details = [
      record.remarks ? `Remarks: ${record.remarks}` : "",
      record.notes ? `Notes: ${record.notes}` : "",
      record.phone ? `Phone: ${record.phone}` : "",
    ].filter(Boolean);
    if (details.length > 0) {
      noteParts.push(
        `[${record.source_sheet} row ${record.source_row}] ${details.join(" | ")}`,
      );
    }
  }
  const leadNote = [...new Set(noteParts)].join("\n").slice(0, 8000) || null;
  const fullName = firstNonEmpty(records, "full_name");
  const firstName = firstNonEmpty(records, "first_name");
  const lastName = firstNonEmpty(records, "last_name");
  const currentTitle = firstNonEmpty(records, "headline");
  const searchText = [fullName, firstName, lastName, currentTitle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return {
    profile_key: entry.profileKey,
    operator_id: entry.operatorId,
    full_name: fullName || null,
    first_name: firstName || null,
    last_name: lastName || null,
    current_title: currentTitle || null,
    linkedin_url: entry.ownerRows[0].linkedinUrl,
    date_found: leadDate || null,
    original_email: email || null,
    original_email_collected_at: email
      ? dateToTimestamp(emailDate || leadDate) || migrationTime
      : null,
    original_email_checked_at: email
      ? dateToTimestamp(emailDate || leadDate) || migrationTime
      : null,
    original_email_status: email ? "found" : "pending",
    lead_note: leadNote,
    lead_note_updated_at: leadNote ? migrationTime : null,
    search_text: searchText,
    source_file: `${sourceTitle}#${first.source_sheet}`,
    source_row: Number(first.source_row),
    assignment_status: assignmentStatus,
    assigned_at: dateToTimestamp(leadDate) || migrationTime,
    connection_requested_at: dateToTimestamp(requestDate),
    accepted_at: dateToTimestamp(connectedDate),
    email_collected_at: email
      ? dateToTimestamp(emailDate || leadDate) || migrationTime
      : null,
  };
}

async function upsertLeads(pool, rows) {
  await withRetry(async () => {
    await pool.query(
      `INSERT INTO leads (
         profile_key, full_name, first_name, last_name, current_title,
         linkedin_url, date_found, original_email,
         original_email_collected_at, original_email_checked_at,
         original_email_status, lead_note, lead_note_updated_at,
         search_text, source_file, source_row
       )
       SELECT
         x.profile_key, x.full_name, x.first_name, x.last_name, x.current_title,
         x.linkedin_url, x.date_found, x.original_email,
         x.original_email_collected_at, x.original_email_checked_at,
         x.original_email_status, x.lead_note, x.lead_note_updated_at,
         x.search_text, x.source_file, x.source_row
       FROM jsonb_to_recordset($1::JSONB) AS x(
         profile_key STRING, full_name STRING, first_name STRING, last_name STRING,
         current_title STRING, linkedin_url STRING, date_found DATE,
         original_email STRING, original_email_collected_at TIMESTAMPTZ,
         original_email_checked_at TIMESTAMPTZ, original_email_status STRING,
         lead_note STRING, lead_note_updated_at TIMESTAMPTZ, search_text STRING,
         source_file STRING, source_row INT8
       )
       ON CONFLICT (profile_key) DO UPDATE SET
         full_name = coalesce(leads.full_name, excluded.full_name),
         first_name = coalesce(leads.first_name, excluded.first_name),
         last_name = coalesce(leads.last_name, excluded.last_name),
         current_title = coalesce(leads.current_title, excluded.current_title),
         date_found = coalesce(leads.date_found, excluded.date_found),
         original_email = coalesce(leads.original_email, excluded.original_email),
         original_email_collected_at = coalesce(
           leads.original_email_collected_at,
           excluded.original_email_collected_at
         ),
         original_email_checked_at = coalesce(
           leads.original_email_checked_at,
           excluded.original_email_checked_at
         ),
         original_email_status = CASE
           WHEN leads.original_email IS NULL AND excluded.original_email IS NOT NULL
             THEN 'found'
           ELSE coalesce(leads.original_email_status, excluded.original_email_status, 'pending')
         END,
         lead_note = coalesce(leads.lead_note, excluded.lead_note),
         lead_note_updated_at = CASE
           WHEN leads.lead_note IS NULL AND excluded.lead_note IS NOT NULL
             THEN excluded.lead_note_updated_at
           ELSE leads.lead_note_updated_at
         END,
         search_text = CASE
           WHEN leads.search_text = '' THEN excluded.search_text
           ELSE leads.search_text
         END`,
      [JSON.stringify(rows)],
    );
  }, "upsert a lead batch");
}

async function upsertAssignments(pool, rows) {
  await withRetry(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO lead_assignments (
           lead_id, operator_id, status, assigned_at,
           connection_requested_at, accepted_at, email_collected_at,
           resolved_linkedin_url, email
         )
         SELECT
           x.lead_id, x.operator_id, x.status, x.assigned_at,
           x.connection_requested_at, x.accepted_at, x.email_collected_at,
           x.resolved_linkedin_url, x.email
         FROM jsonb_to_recordset($1::JSONB) AS x(
           lead_id UUID, operator_id STRING, status STRING, assigned_at TIMESTAMPTZ,
           connection_requested_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ,
           email_collected_at TIMESTAMPTZ, resolved_linkedin_url STRING,
           email STRING
         )
         ON CONFLICT (lead_id) DO NOTHING`,
        [JSON.stringify(rows)],
      );
      await client.query(
        `UPDATE lead_assignments AS a
            SET status = CASE
                  WHEN a.status IN ('failed', 'skipped', 'withdrawn', 'accepted', 'email_collected')
                    THEN a.status
                  WHEN x.status = 'accepted' THEN 'accepted'
                  WHEN x.status = 'connection_requested'
                       AND a.status IN ('assigned', 'viewed', 'engaged', 'connected')
                    THEN 'connection_requested'
                  ELSE a.status
                END,
                connection_requested_at = coalesce(
                  a.connection_requested_at,
                  x.connection_requested_at
                ),
                accepted_at = coalesce(a.accepted_at, x.accepted_at),
                email_collected_at = coalesce(
                  a.email_collected_at,
                  x.email_collected_at
                ),
                resolved_linkedin_url = coalesce(
                  a.resolved_linkedin_url,
                  x.resolved_linkedin_url
                ),
                email = coalesce(a.email, x.email),
                updated_at = now()
           FROM jsonb_to_recordset($1::JSONB) AS x(
             lead_id UUID, operator_id STRING, status STRING, assigned_at TIMESTAMPTZ,
             connection_requested_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ,
             email_collected_at TIMESTAMPTZ, resolved_linkedin_url STRING,
             email STRING
           )
          WHERE a.lead_id = x.lead_id
            AND a.operator_id = x.operator_id`,
        [JSON.stringify(rows)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }, "upsert an assignment batch");
}

function buildAuditRows(migrationId, prepared, plan, existingByKey) {
  const actionableByKey = new Map(
    plan.actionable.map((entry) => [entry.profileKey, entry]),
  );
  return prepared.rows.map((row) => {
    if (!row.profileKey) {
      return auditRow(
        migrationId,
        row,
        "invalid_url_skipped",
        null,
        null,
        "No safe LinkedIn profile URL was available.",
      );
    }
    const existing = existingByKey.get(row.profileKey);
    const assignedOperator = existing?.operator_id ?? null;
    const actionable = actionableByKey.get(row.profileKey);
    if (!actionable) {
      return auditRow(
        migrationId,
        row,
        "existing_assignment_conflict",
        existing?.lead_id ?? null,
        assignedOperator,
        "The canonical lead already belongs to a scout not listed for this source profile.",
      );
    }
    if (assignedOperator !== row.record.scout_account) {
      return auditRow(
        migrationId,
        row,
        "cross_scout_duplicate_skipped",
        existing?.lead_id ?? null,
        assignedOperator,
        "The canonical profile is assigned once; this duplicate source ownership was preserved only in the audit table.",
      );
    }
    const ownerIndex = actionable.ownerRows.findIndex(
      (candidate) => candidate.index === row.index,
    );
    return auditRow(
      migrationId,
      row,
      ownerIndex > 0 ? "same_owner_duplicate_merged" : "migrated",
      existing?.lead_id ?? null,
      assignedOperator,
      ownerIndex > 0
        ? "Duplicate rows for the same scout were merged into one canonical lead."
        : null,
    );
  });
}

function auditRow(
  migrationId,
  row,
  outcome,
  leadId,
  assignmentOperatorId,
  details,
) {
  return {
    migration_id: migrationId,
    source_sheet: row.record.source_sheet,
    source_row: Number(row.record.source_row),
    operator_id: row.record.scout_account,
    profile_key: row.profileKey,
    linkedin_url: row.linkedinUrl || null,
    raw_record: row.record,
    normalized_record: {
      linkedin_url: row.linkedinUrl || null,
      email: row.record.email || null,
      connected: row.record.connected,
      connection_status: row.record.connection_status,
    },
    outcome,
    lead_id: leadId,
    assignment_operator_id: assignmentOperatorId,
    details,
  };
}

async function upsertAuditRows(pool, rows) {
  await withRetry(async () => {
    await pool.query(
      `INSERT INTO scout_sheet_migration_rows (
         migration_id, source_sheet, source_row, operator_id, profile_key,
         linkedin_url, raw_record, normalized_record, outcome, lead_id,
         assignment_operator_id, details
       )
       SELECT
         x.migration_id, x.source_sheet, x.source_row, x.operator_id,
         x.profile_key, x.linkedin_url, x.raw_record, x.normalized_record,
         x.outcome, x.lead_id, x.assignment_operator_id, x.details
       FROM jsonb_to_recordset($1::JSONB) AS x(
         migration_id UUID, source_sheet STRING, source_row INT8,
         operator_id STRING, profile_key STRING, linkedin_url STRING,
         raw_record JSONB, normalized_record JSONB, outcome STRING,
         lead_id UUID, assignment_operator_id STRING, details STRING
       )
       ON CONFLICT (migration_id, source_sheet, source_row) DO UPDATE SET
         operator_id = excluded.operator_id,
         profile_key = excluded.profile_key,
         linkedin_url = excluded.linkedin_url,
         raw_record = excluded.raw_record,
         normalized_record = excluded.normalized_record,
         outcome = excluded.outcome,
         lead_id = excluded.lead_id,
         assignment_operator_id = excluded.assignment_operator_id,
         details = excluded.details,
         updated_at = now()`,
      [JSON.stringify(rows)],
    );
  }, "upsert an audit batch");
}

async function verifyMigration(pool, migrationId, scoutIds, digest) {
  const audit = await pool.query(
    `SELECT count(*)::INT8 AS audit_rows,
            count(*) FILTER (WHERE outcome = 'migrated')::INT8 AS migrated_rows,
            count(*) FILTER (WHERE outcome = 'same_owner_duplicate_merged')::INT8
              AS same_owner_duplicates,
            count(*) FILTER (WHERE outcome = 'cross_scout_duplicate_skipped')::INT8
              AS cross_scout_duplicates,
            count(*) FILTER (WHERE outcome = 'existing_assignment_conflict')::INT8
              AS existing_assignment_conflicts,
            count(*) FILTER (WHERE outcome = 'invalid_url_skipped')::INT8
              AS invalid_url_skipped,
            count(DISTINCT lead_id)::INT8 AS canonical_leads_linked
       FROM scout_sheet_migration_rows
      WHERE migration_id = $1::UUID`,
    [migrationId],
  );
  const assignmentCounts = await pool.query(
    `SELECT operator_id,
            count(*)::INT8 AS assignments,
            count(*) FILTER (
              WHERE accepted_at IS NOT NULL OR status IN ('accepted', 'email_collected')
            )::INT8 AS accepted,
            count(*) FILTER (WHERE email_collected_at IS NOT NULL)::INT8 AS emails
       FROM lead_assignments
      WHERE operator_id = ANY($1::STRING[])
      GROUP BY operator_id
      ORDER BY operator_id`,
    [scoutIds],
  );
  const database = await pool.query(
    `SELECT (SELECT count(*)::INT8 FROM leads) AS total_leads,
            (SELECT count(*)::INT8 FROM lead_assignments) AS total_assignments,
            (SELECT status FROM scout_sheet_migrations WHERE sha256 = $1) AS migration_status`,
    [digest],
  );
  return {
    ...numberValues(audit.rows[0]),
    selected_scout_assignments: assignmentCounts.rows.map(numberValues),
    database_after: numberValues(database.rows[0]),
  };
}

async function linkMigrationToNiche(pool, migrationId, niche) {
  const normalizedNiche = niche.trim();
  if (!normalizedNiche) {
    throw new Error("The migration niche cannot be blank.");
  }
  await withRetry(
    () => pool.query(
      `INSERT INTO lead_niches (niche, lead_id)
       SELECT $2, source.lead_id
         FROM (
           SELECT DISTINCT lead_id
             FROM scout_sheet_migration_rows
            WHERE migration_id = $1::UUID
              AND lead_id IS NOT NULL
         ) AS source
       ON CONFLICT (niche, lead_id) DO NOTHING`,
      [migrationId, normalizedNiche],
    ),
    `link migrated leads to ${normalizedNiche}`,
  );
  await withRetry(
    () => pool.query(
      `UPSERT INTO niches (name, lead_count, updated_at)
       SELECT $1, count(*), now()
         FROM lead_niches
        WHERE niche = $1`,
      [normalizedNiche],
    ),
    `refresh ${normalizedNiche} niche count`,
  );
  const counts = await pool.query(
    `SELECT $2::STRING AS migration_niche,
            count(DISTINCT rows.lead_id)::INT8 AS migration_niche_leads,
            (SELECT count(*)::INT8 FROM lead_niches WHERE niche = $2) AS total_niche_leads
       FROM scout_sheet_migration_rows AS rows
       JOIN lead_niches AS links
         ON links.lead_id = rows.lead_id
        AND links.niche = $2
      WHERE rows.migration_id = $1::UUID
        AND rows.lead_id IS NOT NULL`,
    [migrationId, normalizedNiche],
  );
  return numberValues(counts.rows[0]);
}

async function loadDatabaseCounts(pool, scoutIds) {
  const totals = await pool.query(
    `SELECT (SELECT count(*)::INT8 FROM leads) AS total_leads,
            (SELECT count(*)::INT8 FROM lead_assignments) AS total_assignments`,
  );
  const assignments = await pool.query(
    `SELECT operator_id, count(*)::INT8 AS assignments
       FROM lead_assignments
      WHERE operator_id = ANY($1::STRING[])
      GROUP BY operator_id
      ORDER BY operator_id`,
    [scoutIds],
  );
  return {
    ...numberValues(totals.rows[0]),
    selected_scout_assignments: assignments.rows.map(numberValues),
  };
}

async function loadExistingByProfileKey(pool, profileKeys, batchSize) {
  const result = new Map();
  for (const batch of chunks(profileKeys, batchSize)) {
    const rows = await withRetry(
      () => pool.query(
        `SELECT l.id::STRING AS lead_id,
                l.profile_key,
                l.full_name,
                l.first_name,
                l.last_name,
                l.current_title,
                l.linkedin_url,
                l.original_email,
                l.lead_note,
                a.operator_id,
                a.status AS assignment_status,
                a.connection_requested_at::STRING AS connection_requested_at,
                a.accepted_at::STRING AS accepted_at,
                a.email_collected_at::STRING AS email_collected_at
           FROM leads AS l
           LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
          WHERE l.profile_key = ANY($1::STRING[])`,
        [batch],
      ),
      "load existing canonical leads",
    );
    for (const row of rows.rows) result.set(row.profile_key, row);
  }
  return result;
}

async function writeScopedBackup(
  pool,
  existingByKey,
  sourcePath,
  digest,
  backupDir,
  databaseBefore,
) {
  const leadIds = [...existingByKey.values()].map((row) => row.lead_id);
  const leads = [];
  const assignments = [];
  for (const batch of chunks(leadIds, DEFAULT_BATCH_SIZE)) {
    if (batch.length === 0) continue;
    const leadRows = await pool.query(
      `SELECT * FROM leads WHERE id = ANY($1::UUID[]) ORDER BY id`,
      [batch],
    );
    const assignmentRows = await pool.query(
      `SELECT * FROM lead_assignments WHERE lead_id = ANY($1::UUID[]) ORDER BY lead_id`,
      [batch],
    );
    leads.push(...leadRows.rows);
    assignments.push(...assignmentRows.rows);
  }
  const resolvedBackupDir = path.resolve(backupDir || path.dirname(sourcePath));
  await mkdir(resolvedBackupDir, { recursive: true });
  const backupPath = path.join(
    resolvedBackupDir,
    `scout-sheet-migration-backup-${digest.slice(0, 12)}.json`,
  );
  await writeFile(
    backupPath,
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        source_file: sourcePath,
        source_sha256: digest,
        scope: "Only canonical leads matching the migration export and their assignments",
        database_before: databaseBefore,
        leads,
        assignments,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(
    `Saved scoped pre-migration backup for ${leads.length} existing leads to ${backupPath}.`,
  );
  return backupPath;
}

async function ensureMigrationTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scout_sheet_migrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_name STRING NOT NULL,
      sha256 STRING NOT NULL UNIQUE,
      total_rows INT8 NOT NULL,
      status STRING NOT NULL DEFAULT 'importing'
        CHECK (status IN ('importing', 'completed', 'failed')),
      stats JSONB NOT NULL DEFAULT '{}'::JSONB,
      backup_file STRING NULL,
      error_message STRING NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS scout_sheet_migration_rows (
      migration_id UUID NOT NULL REFERENCES scout_sheet_migrations(id) ON DELETE CASCADE,
      source_sheet STRING NOT NULL,
      source_row INT8 NOT NULL,
      operator_id STRING NOT NULL,
      profile_key STRING NULL,
      linkedin_url STRING NULL,
      raw_record JSONB NOT NULL,
      normalized_record JSONB NOT NULL DEFAULT '{}'::JSONB,
      outcome STRING NOT NULL,
      lead_id UUID NULL REFERENCES leads(id) ON DELETE SET NULL,
      assignment_operator_id STRING NULL,
      details STRING NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (migration_id, source_sheet, source_row)
    );
    CREATE INDEX IF NOT EXISTS scout_sheet_migration_rows_by_outcome
      ON scout_sheet_migration_rows (migration_id, outcome, source_sheet, source_row);
    CREATE INDEX IF NOT EXISTS scout_sheet_migration_rows_by_profile_key
      ON scout_sheet_migration_rows (profile_key)
      WHERE profile_key IS NOT NULL;
  `);
}

async function runBatches(rows, batchSize, label, operation) {
  let completed = 0;
  for (const batch of chunks(rows, batchSize)) {
    await operation(batch);
    completed += batch.length;
    if (completed === rows.length || completed % 2_500 === 0) {
      console.log(
        `  ${label}: ${completed.toLocaleString()}/${rows.length.toLocaleString()}`,
      );
    }
  }
}

function normalizeLinkedInUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return "";
    const pathName = parsed.pathname.replace(/\/+$/, "");
    if (!pathName.toLowerCase().startsWith("/in/") || pathName.length <= 4) {
      return "";
    }
    return `https://linkedin.com${pathName}`;
  } catch {
    return "";
  }
}

function firstNonEmpty(records, key) {
  for (const record of records) {
    const value = typeof record[key] === "string" ? record[key].trim() : "";
    if (value) return value;
  }
  return "";
}

function firstDate(records, key) {
  const dates = records
    .map((record) => record[key])
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")))
    .sort();
  return dates[0] ?? "";
}

function dateToTimestamp(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))
    ? `${value}T00:00:00.000Z`
    : null;
}

function numberValues(row) {
  return Object.fromEntries(
    Object.entries(row ?? {}).map(([key, value]) => [
      key,
      typeof value === "bigint" || /^\d+$/.test(String(value ?? ""))
        ? Number(value)
        : value,
    ]),
  );
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function assertScout(convexUrl, provisioningKey, operatorId) {
  const response = await fetch(`${convexUrl}/api/action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Convex-Client": "callum-scout-sheet-migration-0.1.0",
    },
    body: JSON.stringify({
      path: "scoutAdmin:assertScout",
      format: "convex_encoded_json",
      args: [{ operatorId, provisioningKey }],
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== "success") {
    throw new Error(`Scout validation failed for ${operatorId}.`);
  }
}

async function withRetry(operation, label) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
      const delayMs = Math.min(RETRY_DELAY_CAP_MS, 1_000 * (2 ** attempt));
      console.warn(`Database issue while trying to ${label}: ${error.message}`);
      console.warn(`Retrying in ${Math.ceil(delayMs / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function isRetryable(error) {
  const code = String(error?.code ?? "");
  if (["40001", "40003", "53300", "57P01", "57P02", "57P03"].includes(code)) {
    return true;
  }
  if (code.startsWith("08") || ["ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(code)) {
    return true;
  }
  const message = String(error?.message ?? error).toLowerCase();
  return [
    "connection terminated",
    "connection reset",
    "connection timeout",
    "server closed the connection",
    "restart transaction",
  ].some((part) => message.includes(part));
}

function parseArgs(argv) {
  const parsed = {
    file: "",
    mode: "",
    backupDir: "",
    batchSize: DEFAULT_BATCH_SIZE,
    force: false,
    niche: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") parsed.mode = "dry-run";
    else if (token === "--apply") parsed.mode = "apply";
    else if (token === "--force") parsed.force = true;
    else if (token === "--file") parsed.file = argv[++index] ?? "";
    else if (token === "--backup-dir") parsed.backupDir = argv[++index] ?? "";
    else if (token === "--niche") parsed.niche = argv[++index] ?? "";
    else if (token === "--batch-size") {
      parsed.batchSize = Math.max(
        50,
        Math.min(500, Number(argv[++index]) || DEFAULT_BATCH_SIZE),
      );
    }
  }
  if (!parsed.file || !["dry-run", "apply"].includes(parsed.mode)) {
    throw new Error(
      "Usage: npm run db:migrate-scout-sheet -- --file <all-scout-leads.json> (--dry-run | --apply) [--backup-dir <dir>]",
    );
  }
  return parsed;
}
