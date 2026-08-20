"use node";

import { createAccount } from "@convex-dev/auth/server";
import { randomBytes } from "node:crypto";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { getPool } from "./lib/cockroach";

const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,39}$/;

const nicheAssignmentValidator = v.object({
  name: v.string(),
  total: v.number(),
  assigned: v.number(),
  unassigned: v.number(),
});

const unassignedLeadValidator = v.object({
  id: v.string(),
  fullName: v.union(v.string(), v.null()),
  currentTitle: v.union(v.string(), v.null()),
  companyName: v.union(v.string(), v.null()),
  profileUrl: v.string(),
});

export const createScout = action({
  args: {
    username: v.string(),
  },
  returns: v.object({
    username: v.string(),
    password: v.string(),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const username = normalizeUsername(args.username);
    const password = generatePassword();

    await createAccount(ctx, {
      provider: "password",
      account: {
        id: `${username}@scout.callum.invalid`,
        secret: password,
      },
      profile: {
        email: `${username}@scout.callum.invalid`,
        name: username,
        role: "scout",
        operatorId: username,
        active: true,
      },
      shouldLinkViaEmail: false,
      shouldLinkViaPhone: false,
    });

    return { username, password };
  },
});

export const getNicheAssignments = action({
  args: {},
  returns: v.object({
    generatedAt: v.string(),
    niches: v.array(nicheAssignmentValidator),
  }),
  handler: async (ctx) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const result = await getPool().query(
      `SELECT
         n.name,
         count(ln.lead_id)::FLOAT8 AS total,
         count(a.lead_id)::FLOAT8 AS assigned
       FROM niches AS n
       LEFT JOIN lead_niches AS ln ON ln.niche = n.name
       LEFT JOIN lead_assignments AS a ON a.lead_id = ln.lead_id
      GROUP BY n.name
      ORDER BY n.name`,
    );

    return {
      generatedAt: new Date().toISOString(),
      niches: result.rows.map((row) => {
        const total = Number(row.total ?? 0);
        const assigned = Number(row.assigned ?? 0);
        return {
          name: String(row.name),
          total,
          assigned,
          unassigned: Math.max(0, total - assigned),
        };
      }),
    };
  },
});

export const listUnassignedLeads = action({
  args: {
    niche: v.string(),
    search: v.union(v.string(), v.null()),
    page: v.number(),
    pageSize: v.number(),
  },
  returns: v.object({
    total: v.number(),
    page: v.number(),
    pageSize: v.number(),
    pageCount: v.number(),
    leads: v.array(unassignedLeadValidator),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const niche = args.niche.trim();
    if (!niche) throw new Error("Select a niche.");
    const search = (args.search ?? "").trim();
    if (search && search.length < 3) {
      throw new Error("Search must be at least 3 characters.");
    }
    const pageSize = Math.min(50, Math.max(10, Math.floor(args.pageSize)));
    const requestedPage = Math.max(1, Math.floor(args.page));
    const values: unknown[] = [niche];
    const searchClause = search
      ? (() => {
          values.push(`%${search}%`);
          return `AND concat_ws(' ', l.full_name, l.current_title, l.company_name, l.linkedin_url) ILIKE $${values.length}`;
        })()
      : "";
    const database = getPool();
    const countResult = await database.query(
      `SELECT count(*)::FLOAT8 AS total
         FROM lead_niches AS ln
         INNER JOIN leads AS l ON l.id = ln.lead_id
         LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
        WHERE ln.niche = $1 AND a.lead_id IS NULL ${searchClause}`,
      values,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const queryValues = [...values, pageSize, (page - 1) * pageSize];
    const result = await database.query(
      `SELECT
         l.id::STRING AS id,
         l.full_name,
         l.current_title,
         l.company_name,
         l.linkedin_url AS profile_url
       FROM lead_niches AS ln
       INNER JOIN leads AS l ON l.id = ln.lead_id
       LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
      WHERE ln.niche = $1 AND a.lead_id IS NULL ${searchClause}
      ORDER BY l.full_name NULLS LAST, l.id
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      queryValues,
    );

    return {
      total,
      page,
      pageSize,
      pageCount,
      leads: result.rows.map((row) => ({
        id: String(row.id),
        fullName: nullableString(row.full_name),
        currentTitle: nullableString(row.current_title),
        companyName: nullableString(row.company_name),
        profileUrl: String(row.profile_url ?? ""),
      })),
    };
  },
});

export const assignLeads = action({
  args: {
    operatorId: v.string(),
    niche: v.string(),
    leadIds: v.array(v.string()),
  },
  returns: v.object({
    assigned: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const operatorId = normalizeUsername(args.operatorId);
    const niche = args.niche.trim();
    const leadIds = [...new Set(args.leadIds.map((id) => id.trim()).filter(Boolean))];
    if (!niche) throw new Error("Select a niche.");
    if (leadIds.length < 1 || leadIds.length > 100) {
      throw new Error("Select between 1 and 100 leads.");
    }
    const accounts = await ctx.runQuery(internal.adminIdentity.listScouts, {});
    const scout = accounts.scouts.find((item) => item.operatorId === operatorId);
    if (!scout?.active) throw new Error("Select an active scout.");

    const result = await getPool().query(
      `INSERT INTO lead_assignments (lead_id, operator_id, status)
       SELECT l.id, $2, 'assigned'
         FROM leads AS l
         INNER JOIN lead_niches AS ln ON ln.lead_id = l.id AND ln.niche = $3
         LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
        WHERE l.id = ANY($1::UUID[]) AND a.lead_id IS NULL
       ON CONFLICT (lead_id) DO NOTHING
       RETURNING lead_id`,
      [leadIds, operatorId, niche],
    );
    const assigned = result.rowCount ?? 0;
    return { assigned, skipped: leadIds.length - assigned };
  },
});

export const assignLeadCount = action({
  args: {
    operatorId: v.string(),
    niche: v.string(),
    count: v.number(),
  },
  returns: v.object({
    requested: v.number(),
    assigned: v.number(),
    remaining: v.number(),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const operatorId = normalizeUsername(args.operatorId);
    const niche = args.niche.trim();
    const count = Math.floor(args.count);
    if (!niche) throw new Error("Select a niche.");
    if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) {
      throw new Error("Choose a number between 1 and 100,000.");
    }
    const accounts = await ctx.runQuery(internal.adminIdentity.listScouts, {});
    const scout = accounts.scouts.find((item) => item.operatorId === operatorId);
    if (!scout?.active) throw new Error("Select an active scout.");

    const database = getPool();
    const result = await database.query(
      `INSERT INTO lead_assignments (lead_id, operator_id, status)
       SELECT ln.lead_id, $2, 'assigned'
         FROM lead_niches AS ln
         LEFT JOIN lead_assignments AS a ON a.lead_id = ln.lead_id
        WHERE ln.niche = $1 AND a.lead_id IS NULL
        ORDER BY ln.lead_id
        LIMIT $3
       ON CONFLICT (lead_id) DO NOTHING
       RETURNING lead_id`,
      [niche, operatorId, count],
    );
    const remainingResult = await database.query(
      `SELECT count(*)::FLOAT8 AS remaining
         FROM lead_niches AS ln
         LEFT JOIN lead_assignments AS a ON a.lead_id = ln.lead_id
        WHERE ln.niche = $1 AND a.lead_id IS NULL`,
      [niche],
    );
    return {
      requested: count,
      assigned: result.rowCount ?? 0,
      remaining: Number(remainingResult.rows[0]?.remaining ?? 0),
    };
  },
});

function normalizeUsername(value: string) {
  const username = value.trim().toLowerCase();
  if (!usernamePattern.test(username)) {
    throw new Error(
      "Username must be 3-40 characters using letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return username;
}

function generatePassword() {
  return `Ca${randomBytes(18).toString("base64url")}7`;
}

function nullableString(value: unknown) {
  return value === null || value === undefined || value === "" ? null : String(value);
}
