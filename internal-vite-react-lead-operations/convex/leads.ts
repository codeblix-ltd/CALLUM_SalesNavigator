"use node";

import pg from "pg";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

const optionalText = v.union(v.string(), v.null());
const emailAvailabilityValidator = v.union(
  v.literal("present"),
  v.literal("missing"),
);
const legacyEmailAvailabilityValidator = v.union(
  v.literal("all"),
  v.literal("present"),
  v.literal("missing"),
);
const emailValidationValidator = v.union(
  v.literal("validated"),
  v.literal("not_validated"),
);
const leadFilterArgs = {
  // Keep the new array fields optional while cached production clients roll
  // forward from the previous single-select request shape.
  niches: v.optional(v.array(v.string())),
  niche: v.optional(v.union(v.string(), v.null())),
  search: v.union(v.string(), v.null()),
  originalEmailFilters: v.optional(v.array(emailAvailabilityValidator)),
  originalEmailFilter: v.optional(legacyEmailAvailabilityValidator),
  workEmailFilters: v.optional(v.array(emailAvailabilityValidator)),
  workEmailFilter: v.optional(legacyEmailAvailabilityValidator),
  workEmailValidationFilters: v.optional(v.array(emailValidationValidator)),
};

type LeadFilterArgs = {
  niches?: string[];
  niche?: string | null;
  search: string | null;
  originalEmailFilters?: string[];
  originalEmailFilter?: "all" | "present" | "missing";
  workEmailFilters?: string[];
  workEmailFilter?: "all" | "present" | "missing";
  workEmailValidationFilters?: string[];
};

const leadValidator = v.object({
  id: v.string(),
  fullName: optionalText,
  firstName: optionalText,
  lastName: optionalText,
  domain: optionalText,
  companyName: optionalText,
  currentTitle: optionalText,
  linkedinUrl: v.string(),
  geographicRegion: optionalText,
  companyIndustry: optionalText,
  companySize: optionalText,
  companyLinkedin: optionalText,
  employeeCount: v.union(v.number(), v.null()),
  companyLocation: optionalText,
  foundedYear: v.union(v.number(), v.null()),
  connectionDegree: optionalText,
  premium: v.union(v.boolean(), v.null()),
  originalEmail: optionalText,
  originalEmailStatus: v.string(),
  originalEmailCheckedAt: optionalText,
  workEmail: optionalText,
  workEmailValidation: optionalText,
  workEmailStatus: v.string(),
  leadNote: optionalText,
  leadNoteUpdatedAt: optionalText,
});

const nicheValidator = v.object({
  name: v.string(),
  count: v.number(),
});

type LeadStats = {
  total: number;
  assigned: number;
  updatedAt: string;
  niches: Array<{ name: string; count: number }>;
};

let pool: pg.Pool | null = null;
let statsCache: { value: LeadStats; expiresAt: number } | null = null;

export const getStats = action({
  args: {},
  returns: v.object({
    total: v.number(),
    assigned: v.number(),
    updatedAt: v.string(),
    niches: v.array(nicheValidator),
  }),
  handler: async (ctx) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    if (statsCache && statsCache.expiresAt > Date.now()) {
      return statsCache.value;
    }
    const database = getPool();
    const [statsResult, nichesResult, assignedResult] = await Promise.all([
      database.query(
        `SELECT total_count::FLOAT8 AS total_count, updated_at::STRING AS updated_at
           FROM lead_stats
          WHERE key = 'all'`,
      ),
      database.query(
        `SELECT name, lead_count::FLOAT8 AS lead_count
           FROM niches
          ORDER BY lead_count DESC, name ASC`,
      ),
      database.query(
        "SELECT count(*)::FLOAT8 AS assigned_count FROM lead_assignments",
      ),
    ]);

    const stats = statsResult.rows[0] ?? {
      total_count: 0,
      updated_at: new Date(0).toISOString(),
    };
    const value = {
      total: Number(stats.total_count),
      assigned: Number(assignedResult.rows[0]?.assigned_count ?? 0),
      updatedAt: String(stats.updated_at),
      niches: nichesResult.rows.map((row) => ({
        name: String(row.name),
        count: Number(row.lead_count),
      })),
    };
    statsCache = { value, expiresAt: Date.now() + 30_000 };
    return value;
  },
});

export const list = action({
  args: {
    ...leadFilterArgs,
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.object({
    leads: v.array(leadValidator),
    nextCursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
    filteredCount: v.number(),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const database = getPool();
    const limit = Math.max(1, Math.min(100, Math.trunc(args.limit)));
    const leadFilter = buildLeadFilter(args);
    const cursor = validateCursor(args.cursor);
    const parameters = [...leadFilter.parameters];
    const conditions = [...leadFilter.conditions];

    const countParameters = [...parameters];
    const countConditions = [...conditions];
    if (cursor) {
      parameters.push(cursor);
      conditions.push(`l.id > $${parameters.length}::UUID`);
    }

    parameters.push(limit + 1);
    const whereSql = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const fromSql = "FROM leads AS l";
    const query = `
      SELECT
        l.id::STRING AS id,
        l.full_name,
        l.first_name,
        l.last_name,
        l.domain,
        l.company_name,
        l.current_title,
        l.linkedin_url,
        l.geographic_region,
        l.company_industry,
        l.company_size,
        l.company_linkedin,
        l.employee_count::FLOAT8 AS employee_count,
        l.company_location,
        l.founded_year::FLOAT8 AS founded_year,
        l.connection_degree,
        l.premium,
        l.original_email,
        l.original_email_status,
        l.original_email_checked_at::STRING AS original_email_checked_at,
        l.work_email,
        l.work_email_validation,
        l.work_email_status,
        l.lead_note,
        l.lead_note_updated_at::STRING AS lead_note_updated_at
      ${fromSql}
      ${whereSql}
      ORDER BY l.id
      LIMIT $${parameters.length}`;
    const countWhereSql = countConditions.length > 0
      ? `WHERE ${countConditions.join(" AND ")}`
      : "";
    const [result, countResult] = await Promise.all([
      database.query(query, parameters),
      database.query(
        `SELECT count(*)::FLOAT8 AS count ${fromSql} ${countWhereSql}`,
        countParameters,
      ),
    ]);
    const hasMore = result.rows.length > limit;
    const pageRows = result.rows.slice(0, limit);
    const leads = pageRows.map(mapLead);

    return {
      leads,
      nextCursor: hasMore ? leads.at(-1)?.id ?? null : null,
      hasMore,
      filteredCount: Number(countResult.rows[0]?.count ?? 0),
    };
  },
});

export const exportCsv = action({
  args: leadFilterArgs,
  returns: v.object({
    fileName: v.string(),
    csv: v.string(),
    rowCount: v.number(),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const database = getPool();
    const exportLimit = 25_000;
    const leadFilter = buildLeadFilter(args);
    const parameters = [...leadFilter.parameters, exportLimit + 1];
    const whereSql = leadFilter.conditions.length > 0
      ? `WHERE ${leadFilter.conditions.join(" AND ")}`
      : "";
    const result = await database.query(
      `SELECT
         l.linkedin_url,
         l.full_name,
         l.first_name,
         l.last_name,
         l.current_title,
         l.company_name,
         l.original_email,
         l.original_email_status,
         l.original_email_checked_at::STRING AS original_email_checked_at,
         l.work_email,
         l.work_email_validation,
         l.work_email_status,
         l.lead_note,
         l.lead_note_updated_at::STRING AS lead_note_updated_at,
         l.geographic_region,
         l.company_industry,
         l.company_size,
         l.employee_count::STRING AS employee_count,
         l.company_location,
         l.company_linkedin,
         l.connection_degree,
         l.premium::STRING AS premium
       FROM leads AS l
       ${whereSql}
       ORDER BY l.id
       LIMIT $${parameters.length}`,
      parameters,
    );
    const truncated = result.rows.length > exportLimit;
    const rows = result.rows.slice(0, exportLimit).map((row) => [
      row.linkedin_url,
      row.full_name,
      row.first_name,
      row.last_name,
      row.current_title,
      row.company_name,
      row.original_email,
      row.original_email_status,
      row.original_email_checked_at,
      row.work_email,
      row.work_email_validation,
      row.work_email_status,
      row.lead_note,
      row.lead_note_updated_at,
      row.geographic_region,
      row.company_industry,
      row.company_size,
      row.employee_count,
      row.company_location,
      row.company_linkedin,
      row.connection_degree,
      row.premium,
    ]);
    const header = [
      "LinkedIn URL",
      "Full Name",
      "First Name",
      "Last Name",
      "Current Title",
      "Company",
      "Original Email",
      "Original Email Status",
      "Original Email Checked At",
      "Work Email",
      "Work Email Validation",
      "Work Email Status",
      "Lead Note",
      "Lead Note Updated At",
      "Region",
      "Industry",
      "Company Size",
      "Employee Count",
      "Company Location",
      "Company LinkedIn",
      "Connection Degree",
      "Premium",
    ];
    return {
      fileName: `filtered-leads-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: [header, ...rows].map(csvLine).join("\r\n"),
      rowCount: rows.length,
      truncated,
    };
  },
});

function mapLead(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    fullName: nullableString(row.full_name),
    firstName: nullableString(row.first_name),
    lastName: nullableString(row.last_name),
    domain: nullableString(row.domain),
    companyName: nullableString(row.company_name),
    currentTitle: nullableString(row.current_title),
    linkedinUrl: String(row.linkedin_url ?? ""),
    geographicRegion: nullableString(row.geographic_region),
    companyIndustry: nullableString(row.company_industry),
    companySize: nullableString(row.company_size),
    companyLinkedin: nullableString(row.company_linkedin),
    employeeCount: nullableNumber(row.employee_count),
    companyLocation: nullableString(row.company_location),
    foundedYear: nullableNumber(row.founded_year),
    connectionDegree: nullableString(row.connection_degree),
    premium: typeof row.premium === "boolean" ? row.premium : null,
    originalEmail: nullableString(row.original_email),
    originalEmailStatus: String(row.original_email_status ?? "pending"),
    originalEmailCheckedAt: nullableString(row.original_email_checked_at),
    workEmail: nullableString(row.work_email),
    workEmailValidation: nullableString(row.work_email_validation),
    workEmailStatus: String(row.work_email_status ?? "pending"),
    leadNote: nullableString(row.lead_note),
    leadNoteUpdatedAt: nullableString(row.lead_note_updated_at),
  };
}

function addEmailAvailabilityCondition(
  conditions: string[],
  column: string,
  filters: string[],
) {
  const selected = new Set(filters);
  if (!selected.size || (selected.has("present") && selected.has("missing"))) return;
  if (selected.has("present")) conditions.push(`${column} IS NOT NULL AND ${column} <> ''`);
  if (selected.has("missing")) conditions.push(`(${column} IS NULL OR ${column} = '')`);
}

function addEmailValidationCondition(
  conditions: string[],
  column: string,
  filters: string[],
) {
  const selected = new Set(filters);
  if (!selected.size || (selected.has("validated") && selected.has("not_validated"))) return;
  const hasWorkEmail = `l.work_email IS NOT NULL AND l.work_email <> ''`;
  const isValidated = `lower(btrim(coalesce(${column}, ''))) = 'valid'`;
  const isNotValidated = `lower(btrim(coalesce(${column}, ''))) <> 'valid'`;
  if (selected.has("validated")) conditions.push(`(${hasWorkEmail} AND ${isValidated})`);
  if (selected.has("not_validated")) conditions.push(`(${hasWorkEmail} AND ${isNotValidated})`);
}

function buildLeadFilter(args: LeadFilterArgs) {
  const niches = normalizeList(args.niches ?? (args.niche ? [args.niche] : []), 100);
  const originalEmailFilters = resolveEmailAvailabilityFilters(args.originalEmailFilters, args.originalEmailFilter);
  const workEmailFilters = resolveEmailAvailabilityFilters(args.workEmailFilters, args.workEmailFilter);
  const workEmailValidationFilters = normalizeList(args.workEmailValidationFilters ?? []);
  const rawSearch = args.search?.trim().toLowerCase().slice(0, 120) || "";
  const search = rawSearch.length >= 3 ? rawSearch : "";
  const parameters: Array<string | number> = [];
  const conditions: string[] = [];

  if (niches.length) {
    const nicheParameters = niches.map((selectedNiche) => {
      parameters.push(selectedNiche);
      return `$${parameters.length}`;
    });
    conditions.push(`EXISTS (
      SELECT 1
        FROM lead_niches AS ln
       WHERE ln.lead_id = l.id
         AND ln.niche IN (${nicheParameters.join(", ")})
    )`);
  }
  if (search) {
    parameters.push(`%${search}%`);
    conditions.push(`(
      l.search_text ILIKE $${parameters.length}
      OR coalesce(l.original_email, '') ILIKE $${parameters.length}
      OR coalesce(l.work_email, '') ILIKE $${parameters.length}
      OR coalesce(l.lead_note, '') ILIKE $${parameters.length}
    )`);
  }
  addEmailAvailabilityCondition(conditions, "l.original_email", originalEmailFilters);
  addEmailAvailabilityCondition(conditions, "l.work_email", workEmailFilters);
  addEmailValidationCondition(conditions, "l.work_email_validation", workEmailValidationFilters);

  return { parameters, conditions };
}

function csvLine(values: unknown[]) {
  return values
    .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
    .join(",");
}

function normalizeList(values: string[], maximum = 2) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, maximum);
}

function resolveEmailAvailabilityFilters(
  filters: string[] | undefined,
  legacyFilter: "all" | "present" | "missing" | undefined,
) {
  if (filters) return normalizeList(filters);
  return legacyFilter && legacyFilter !== "all" ? [legacyFilter] : [];
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validateCursor(cursor: string | null) {
  if (!cursor) return null;
  const value = cursor.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Invalid pagination cursor.");
  }
  return value;
}

function getPool() {
  if (pool) return pool;
  const value = process.env.COCKROACH_DATABASE_URL;
  if (!value) {
    throw new Error("COCKROACH_DATABASE_URL is not configured.");
  }
  pool = new pg.Pool({
    connectionString: value,
    ssl: { rejectUnauthorized: true },
    max: 3,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    options: "--statement_timeout=10000",
  });
  return pool;
}
