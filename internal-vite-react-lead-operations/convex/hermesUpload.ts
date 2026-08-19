"use node";

import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { getPool } from "./lib/cockroach";

const HERMES_NICHE = "Hermes";
const MAX_CSV_BYTES = 5_000_000;
const MAX_ROWS = 2_000;
const BATCH_SIZE = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_HEADERS = [
  "linkedin_url",
  "first_name",
  "last_name",
  "headline",
  "location",
  "current_role",
  "current_company",
  "network_distance",
  "profile_urn",
  "public_identifier",
  "day_rotation",
  "date_found",
];
const REQUIRED_HEADERS = [
  "linkedin_url",
  "first_name",
  "last_name",
  "headline",
  "location",
  "date_found",
];
const LEAD_COLUMNS = [
  "profile_key",
  "full_name",
  "first_name",
  "last_name",
  "domain",
  "company_name",
  "profile_role",
  "current_title",
  "linkedin_url",
  "geographic_region",
  "company_industry",
  "company_size",
  "company_linkedin",
  "employee_count",
  "company_location",
  "founded_year",
  "connection_degree",
  "premium",
  "company_description",
  "summary",
  "profile_urn",
  "public_identifier",
  "network_distance",
  "day_rotation",
  "date_found",
  "search_text",
  "source_file",
  "source_row",
];

const uploadLeadValidator = v.object({
  id: v.string(),
  linkedinUrl: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  headline: v.string(),
  location: v.string(),
  currentRole: v.union(v.string(), v.null()),
  currentCompany: v.union(v.string(), v.null()),
  dateFound: v.string(),
  sourceRow: v.number(),
});

const uploadScoutValidator = v.object({
  operatorId: v.string(),
  username: v.string(),
});

const uploadResultValidator = v.object({
  importId: v.string(),
  fileName: v.string(),
  niche: v.string(),
  totalRows: v.number(),
  uniqueRows: v.number(),
  leads: v.array(uploadLeadValidator),
  scouts: v.array(uploadScoutValidator),
});

const assignmentResultValidator = v.object({
  assignedCount: v.number(),
  skippedCount: v.number(),
  allocations: v.array(v.object({
    operatorId: v.string(),
    username: v.string(),
    count: v.number(),
  })),
});

type NormalizedLead = {
  profile_key: string;
  full_name: string;
  first_name: string;
  last_name: string;
  domain: null;
  company_name: string | null;
  profile_role: string | null;
  current_title: string;
  linkedin_url: string;
  geographic_region: string;
  company_industry: null;
  company_size: null;
  company_linkedin: null;
  employee_count: null;
  company_location: string;
  founded_year: null;
  connection_degree: null;
  premium: null;
  company_description: null;
  summary: null;
  profile_urn: string | null;
  public_identifier: string | null;
  network_distance: string | null;
  day_rotation: string | null;
  date_found: string;
  search_text: string;
  source_file: string;
  source_row: number;
};

type ScoutAccount = {
  operatorId: string;
  username: string;
  active: boolean;
};

type ActionContext = {
  runQuery: (
    reference: typeof internal.adminIdentity.listScouts,
    args: Record<string, never>,
  ) => Promise<{ scouts: ScoutAccount[] }>;
};

export const uploadLeads = action({
  args: {
    fileName: v.string(),
    csvText: v.string(),
  },
  returns: uploadResultValidator,
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const scouts = await activeScouts(ctx);
    if (scouts.length === 0) {
      throw new Error("There are no active scout accounts available for allocation.");
    }

    const fileName = safeFileName(args.fileName);
    if (!fileName.toLowerCase().endsWith(".csv")) {
      throw new Error("Please upload a .csv file.");
    }
    if (Buffer.byteLength(args.csvText, "utf8") > MAX_CSV_BYTES) {
      throw new Error("CSV files must be 5 MB or smaller.");
    }

    const parsed = parseHermesCsv(args.csvText, fileName);
    const importHash = createHash("sha256").update(args.csvText).digest("hex");
    const pool = getPool();
    const client = await pool.connect();
    const idsByProfile = new Map<string, string>();

    try {
      await client.query("BEGIN");
      const importResult = await client.query(
        `INSERT INTO lead_imports
          (source_file, niche, sha256, file_bytes, status, processed_rows, error_message, started_at, completed_at)
         VALUES ($1, $2, $3, $4, 'importing', 0, NULL, now(), NULL)
         ON CONFLICT (sha256, niche) DO UPDATE SET
           source_file = excluded.source_file,
           file_bytes = excluded.file_bytes,
           status = 'importing',
           processed_rows = 0,
           error_message = NULL,
           started_at = now(),
           completed_at = NULL
         RETURNING id::STRING AS id`,
        [fileName, HERMES_NICHE, importHash, Buffer.byteLength(args.csvText, "utf8")],
      );
      const importId = String(importResult.rows[0].id);

      for (let offset = 0; offset < parsed.leads.length; offset += BATCH_SIZE) {
        const batch = parsed.leads.slice(offset, offset + BATCH_SIZE);
        const values: unknown[] = [];
        const rowSql = batch.map((lead, rowIndex) => {
          const placeholders = LEAD_COLUMNS.map((column, columnIndex) => {
            values.push(lead[column as keyof NormalizedLead]);
            return `$${rowIndex * LEAD_COLUMNS.length + columnIndex + 1}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        const merged = await client.query(
          `INSERT INTO leads (${LEAD_COLUMNS.join(", ")})
           VALUES ${rowSql.join(",\n")}
           ON CONFLICT (profile_key) DO UPDATE SET
             full_name = excluded.full_name,
             first_name = excluded.first_name,
             last_name = excluded.last_name,
             company_name = coalesce(excluded.company_name, leads.company_name),
             profile_role = coalesce(excluded.profile_role, leads.profile_role),
             current_title = excluded.current_title,
             linkedin_url = excluded.linkedin_url,
             geographic_region = excluded.geographic_region,
             company_location = excluded.company_location,
             profile_urn = coalesce(excluded.profile_urn, leads.profile_urn),
             public_identifier = coalesce(excluded.public_identifier, leads.public_identifier),
             network_distance = coalesce(excluded.network_distance, leads.network_distance),
             day_rotation = coalesce(excluded.day_rotation, leads.day_rotation),
             date_found = coalesce(excluded.date_found, leads.date_found),
             search_text = excluded.search_text,
             source_file = excluded.source_file,
             source_row = excluded.source_row,
             updated_at = now()
           RETURNING id::STRING AS id, profile_key`,
          values,
        );

        const nicheValues: unknown[] = [];
        const nicheRows = merged.rows.map((row, rowIndex) => {
          const lead = batch.find((item) => item.profile_key === String(row.profile_key));
          if (lead) idsByProfile.set(lead.profile_key, String(row.id));
          nicheValues.push(HERMES_NICHE, String(row.id), importId);
          const base = rowIndex * 3;
          return `($${base + 1}, $${base + 2}, $${base + 3})`;
        });
        if (nicheRows.length > 0) {
          await client.query(
            `INSERT INTO lead_niches (niche, lead_id, first_seen_import_id)
             VALUES ${nicheRows.join(",\n")}
             ON CONFLICT (niche, lead_id) DO NOTHING`,
            nicheValues,
          );
        }
        await client.query(
          "UPDATE lead_imports SET processed_rows = $2 WHERE id = $1::UUID",
          [importId, Math.min(offset + batch.length, parsed.leads.length)],
        );
      }

      await client.query(
        `UPSERT INTO lead_stats (key, total_count, updated_at)
         SELECT 'all', count(*), now() FROM leads`,
      );
      await client.query(
        `UPSERT INTO niches (name, lead_count, updated_at)
         SELECT $1, count(*), now()
           FROM lead_niches
          WHERE niche = $1`,
        [HERMES_NICHE],
      );
      await client.query(
        `UPDATE lead_imports
            SET status = 'completed', processed_rows = $2, error_message = NULL, completed_at = now()
          WHERE id = $1::UUID`,
        [importId, parsed.leads.length],
      );
      await client.query("COMMIT");

      return {
        importId,
        fileName,
        niche: HERMES_NICHE,
        totalRows: parsed.totalRows,
        uniqueRows: parsed.leads.length,
        leads: parsed.leads.map((lead) => ({
          id: idsByProfile.get(lead.profile_key) ?? "",
          linkedinUrl: lead.linkedin_url,
          firstName: lead.first_name,
          lastName: lead.last_name,
          headline: lead.current_title,
          location: lead.geographic_region,
          currentRole: lead.profile_role,
          currentCompany: lead.company_name,
          dateFound: lead.date_found,
          sourceRow: lead.source_row,
        })),
        scouts: scouts.map(({ operatorId, username }) => ({ operatorId, username })),
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The database rolls back the transaction when the connection dies.
      }
      throw error;
    } finally {
      client.release();
    }
  },
});

export const confirmAssignments = action({
  args: {
    leadIds: v.array(v.string()),
    scoutIds: v.array(v.string()),
  },
  returns: assignmentResultValidator,
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const leadIds = [...new Set(args.leadIds.map((id) => id.trim()).filter(Boolean))];
    if (leadIds.length === 0) throw new Error("Select at least one lead to assign.");
    if (leadIds.length > MAX_ROWS) throw new Error(`You can assign at most ${MAX_ROWS.toLocaleString()} leads at once.`);
    if (leadIds.some((id) => !UUID_PATTERN.test(id))) throw new Error("The upload contains an invalid lead identifier.");

    const selectedScoutIds = [...new Set(args.scoutIds.map((id) => id.trim()).filter(Boolean))];
    if (selectedScoutIds.length === 0) throw new Error("Select at least one scout for allocation.");
    const availableScouts = await activeScouts(ctx);
    const availableScoutIds = new Set(availableScouts.map((scout) => scout.operatorId));
    if (selectedScoutIds.some((id) => !availableScoutIds.has(id))) {
      throw new Error("One or more selected scouts are no longer active. Refresh and try again.");
    }
    const selectedScoutSet = new Set(selectedScoutIds);
    const scouts = availableScouts.filter((scout) => selectedScoutSet.has(scout.operatorId));
    if (scouts.length === 0) throw new Error("There are no active scout accounts available for allocation.");
    const pool = getPool();
    const client = await pool.connect();
    const allocations = new Map(scouts.map((scout) => [scout.operatorId, 0]));
    let insertedCount = 0;

    try {
      await client.query("BEGIN");
      const placeholders = leadIds.map((_, index) => `$${index + 1}::UUID`).join(", ");
      const eligibleResult = await client.query(
        `SELECT l.id::STRING AS lead_id
           FROM leads AS l
           INNER JOIN lead_niches AS ln ON ln.lead_id = l.id AND ln.niche = $${leadIds.length + 1}
           LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
          WHERE l.id IN (${placeholders}) AND a.lead_id IS NULL`,
        [...leadIds, HERMES_NICHE],
      );
      const eligibleIds = new Set(eligibleResult.rows.map((row) => String(row.lead_id)));
      const orderedEligibleIds = leadIds.filter((id) => eligibleIds.has(id));

      for (let offset = 0; offset < orderedEligibleIds.length; offset += BATCH_SIZE) {
        const batch = orderedEligibleIds.slice(offset, offset + BATCH_SIZE);
        const values: unknown[] = [];
        const rowSql = batch.map((leadId, rowIndex) => {
          const operatorId = scouts[(offset + rowIndex) % scouts.length].operatorId;
          values.push(leadId, operatorId);
          return `($${rowIndex * 2 + 1}::UUID, $${rowIndex * 2 + 2}, 'assigned')`;
        });
        const inserted = await client.query(
          `INSERT INTO lead_assignments (lead_id, operator_id, status)
           VALUES ${rowSql.join(",\n")}
           ON CONFLICT (lead_id) DO NOTHING
           RETURNING operator_id`,
          values,
        );
        insertedCount += inserted.rowCount ?? 0;
        for (const row of inserted.rows) {
          const operatorId = String(row.operator_id);
          allocations.set(operatorId, (allocations.get(operatorId) ?? 0) + 1);
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The database rolls back the transaction when the connection dies.
      }
      throw error;
    } finally {
      client.release();
    }

    return {
      assignedCount: insertedCount,
      skippedCount: leadIds.length - insertedCount,
      allocations: scouts.map((scout) => ({
        operatorId: scout.operatorId,
        username: scout.username,
        count: allocations.get(scout.operatorId) ?? 0,
      })),
    };
  },
});

async function activeScouts(ctx: ActionContext) {
  const result = await ctx.runQuery(internal.adminIdentity.listScouts, {});
  return result.scouts
    .filter((scout) => scout.active)
    .sort((left, right) => left.username.localeCompare(right.username));
}

function parseHermesCsv(csvText: string, fileName: string) {
  let actualHeaders: string[] = [];
  let records: Array<Record<string, unknown>>;
  try {
    records = parse(csvText, {
      bom: true,
      columns: (headers: string[]) => {
        actualHeaders = headers;
        return headers;
      },
      skip_empty_lines: true,
      relax_column_count: false,
      trim: true,
    }) as Array<Record<string, unknown>>;
  } catch (error) {
    throw new Error(`CSV could not be read: ${String(error instanceof Error ? error.message : error).split("\n")[0]}`);
  }

  if (actualHeaders.length !== EXPECTED_HEADERS.length || actualHeaders.some((header, index) => header !== EXPECTED_HEADERS[index])) {
    throw new Error(`CSV headers must match exactly: ${EXPECTED_HEADERS.join(",")}`);
  }
  if (records.length === 0) throw new Error("CSV has no lead rows.");
  if (records.length > MAX_ROWS) throw new Error(`CSV contains ${records.length.toLocaleString()} rows. The maximum is ${MAX_ROWS.toLocaleString()}.`);

  const errors: string[] = [];
  const unique = new Map<string, NormalizedLead>();
  records.forEach((row, index) => {
    const sourceRow = index + 2;
    const values = Object.fromEntries(EXPECTED_HEADERS.map((header) => [header, clean(row[header])]));
    const missing = REQUIRED_HEADERS.filter((header) => !values[header]);
    if (missing.length > 0) {
      errors.push(`row ${sourceRow}: missing ${missing.join(", ")}`);
      return;
    }
    let linkedinUrl: string;
    try {
      linkedinUrl = normalizeLinkedInUrl(values.linkedin_url);
    } catch (error) {
      errors.push(`row ${sourceRow}: ${String(error instanceof Error ? error.message : error)}`);
      return;
    }
    let dateFound: string;
    try {
      dateFound = normalizeDate(values.date_found);
    } catch (error) {
      errors.push(`row ${sourceRow}: ${String(error instanceof Error ? error.message : error)}`);
      return;
    }
    const fullName = `${values.first_name} ${values.last_name}`.trim();
    const profileKey = createHash("sha256").update(linkedinUrl).digest("hex");
    const searchText = [
      fullName,
      values.headline,
      values.location,
      values.current_role,
      values.current_company,
      values.public_identifier,
    ].filter(Boolean).join(" ").toLowerCase();
    unique.set(profileKey, {
      profile_key: profileKey,
      full_name: fullName,
      first_name: values.first_name,
      last_name: values.last_name,
      domain: null,
      company_name: values.current_company || null,
      profile_role: values.current_role || null,
      current_title: values.headline,
      linkedin_url: linkedinUrl,
      geographic_region: values.location,
      company_industry: null,
      company_size: null,
      company_linkedin: null,
      employee_count: null,
      company_location: values.location,
      founded_year: null,
      connection_degree: null,
      premium: null,
      company_description: null,
      summary: null,
      profile_urn: values.profile_urn || null,
      public_identifier: values.public_identifier || null,
      network_distance: values.network_distance || null,
      day_rotation: values.day_rotation || null,
      date_found: dateFound,
      search_text: searchText,
      source_file: fileName,
      source_row: sourceRow,
    });
  });
  if (errors.length > 0) {
    const shown = errors.slice(0, 8).join("; ");
    throw new Error(`CSV validation failed: ${shown}${errors.length > 8 ? `; plus ${errors.length - 8} more` : ""}`);
  }
  return { totalRows: records.length, leads: [...unique.values()] };
}

function normalizeLinkedInUrl(value: string) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) throw new Error("linkedin_url must be a LinkedIn URL.");
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (!/^\/in\/[^/]+$/i.test(pathname)) throw new Error("linkedin_url must point to a LinkedIn profile (/in/...).");
    return `https://linkedin.com${pathname}`;
  } catch (error) {
    if (error instanceof Error && error.message.includes("linkedin_url")) throw error;
    throw new Error("linkedin_url must be a valid LinkedIn profile URL.");
  }
}

function normalizeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("date_found must use YYYY-MM-DD.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("date_found is not a valid calendar date.");
  return value;
}

function safeFileName(value: string) {
  const candidate = clean(value).split(/[\\/]/).pop() || "hermes-leads.csv";
  return candidate.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "hermes-leads.csv";
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
