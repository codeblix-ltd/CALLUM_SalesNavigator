"use node";

import pg from "pg";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

const optionalText = v.union(v.string(), v.null());
const emailAvailabilityValidator = v.union(
  v.literal("all"),
  v.literal("present"),
  v.literal("missing"),
);

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
  workEmail: optionalText,
  workEmailStatus: v.string(),
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
    niche: v.union(v.string(), v.null()),
    search: v.union(v.string(), v.null()),
    originalEmailFilter: emailAvailabilityValidator,
    workEmailFilter: emailAvailabilityValidator,
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
    const niche = args.niche?.trim().slice(0, 120) || null;
    const rawSearch = args.search?.trim().toLowerCase().slice(0, 120) || "";
    const search = rawSearch.length >= 3 ? rawSearch : "";
    const cursor = validateCursor(args.cursor);
    const parameters = [];
    const conditions = [];
    let fromSql = "FROM leads AS l";

    if (niche) {
      parameters.push(niche);
      fromSql += ` INNER JOIN lead_niches AS ln
        ON ln.lead_id = l.id AND ln.niche = $${parameters.length}`;
    }
    if (search) {
      parameters.push(`%${search}%`);
      conditions.push(`(
        l.search_text ILIKE $${parameters.length}
        OR coalesce(l.original_email, '') ILIKE $${parameters.length}
        OR coalesce(l.work_email, '') ILIKE $${parameters.length}
      )`);
    }
    addEmailAvailabilityCondition(conditions, "l.original_email", args.originalEmailFilter);
    addEmailAvailabilityCondition(conditions, "l.work_email", args.workEmailFilter);

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
        l.work_email,
        l.work_email_status
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
    workEmail: nullableString(row.work_email),
    workEmailStatus: String(row.work_email_status ?? "pending"),
  };
}

function addEmailAvailabilityCondition(
  conditions: string[],
  column: string,
  filter: "all" | "present" | "missing",
) {
  if (filter === "present") conditions.push(`${column} IS NOT NULL AND ${column} <> ''`);
  if (filter === "missing") conditions.push(`(${column} IS NULL OR ${column} = '')`);
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
