"use node";

import { v } from "convex/values";
import type { PoolClient } from "pg";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { getPool } from "./lib/cockroach";

const optionalText = v.union(v.string(), v.null());
const optionalNumber = v.union(v.number(), v.null());
const queueRowValidator = v.object({
  leadId: v.string(),
  linkedinUrl: v.string(),
  fullName: optionalText,
  companyName: optionalText,
  workEmailStatus: v.string(),
  lastError: optionalText,
});
const queueNicheValidator = v.object({
  name: v.string(),
  eligible: v.number(),
});

export const listQueueNiches = action({
  args: {},
  returns: v.object({ niches: v.array(queueNicheValidator) }),
  handler: async (ctx) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const result = await getPool().query(
      `WITH queueable AS (
         SELECT l.id
         FROM leads AS l
         LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
         WHERE (${preferredLinkedInUrlSql} LIKE 'https://linkedin.com/in/%' OR ${preferredLinkedInUrlSql} LIKE 'https://www.linkedin.com/in/%')
           AND l.work_email IS NULL
           AND (
             l.work_email_status IN ('pending', 'error')
             OR (
               l.work_email_status = 'processing'
               AND l.work_email_checked_at < now() - INTERVAL '30 minutes'
             )
           )
       )
       SELECT ln.niche AS name, count(*)::FLOAT8 AS eligible
       FROM queueable AS q
       INNER JOIN lead_niches AS ln ON ln.lead_id = q.id
       GROUP BY ln.niche
       ORDER BY lower(ln.niche), ln.niche`,
    );
    return {
      niches: result.rows.map((row) => ({
        name: String(row.name),
        eligible: Number(row.eligible ?? 0),
      })),
    };
  },
});

export const listQueue = action({
  args: { limit: v.number(), niche: v.string() },
  returns: v.object({
    leads: v.array(queueRowValidator),
    remaining: v.number(),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const limit = Math.max(1, Math.min(500, Math.trunc(args.limit)));
    const niche = args.niche.trim();
    if (!niche || niche.length > 120) throw new Error("Choose one valid niche.");
    const database = getPool();
    const [rows, count] = await Promise.all([
      database.query(
         `WITH queueable AS (
           SELECT
             l.id::STRING AS lead_id,
             ${preferredLinkedInUrlSql} AS linkedin_url,
             l.full_name,
             l.company_name,
             l.work_email,
             l.work_email_status,
             l.work_email_last_error,
             l.work_email_checked_at,
             l.created_at,
             l.source_file,
             l.source_row,
             l.id AS sort_id
           FROM leads AS l
           LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
           INNER JOIN lead_niches AS ln ON ln.lead_id = l.id AND ln.niche = $1
         )
         SELECT lead_id, linkedin_url, full_name, company_name, work_email_status, work_email_last_error
         FROM queueable
         WHERE (linkedin_url LIKE 'https://linkedin.com/in/%' OR linkedin_url LIKE 'https://www.linkedin.com/in/%')
           AND work_email IS NULL
           AND (
             work_email_status IN ('pending', 'error')
             OR (
               work_email_status = 'processing'
               AND work_email_checked_at < now() - INTERVAL '30 minutes'
             )
           )
         ORDER BY
           created_at,
           source_file,
           source_row,
           sort_id
         LIMIT $2`,
        [niche, limit],
      ),
      database.query(
        `SELECT count(*)::FLOAT8 AS count
         FROM leads AS l
         LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
         INNER JOIN lead_niches AS ln ON ln.lead_id = l.id AND ln.niche = $1
         WHERE (${preferredLinkedInUrlSql} LIKE 'https://linkedin.com/in/%' OR ${preferredLinkedInUrlSql} LIKE 'https://www.linkedin.com/in/%')
           AND l.work_email IS NULL
           AND (
             l.work_email_status IN ('pending', 'error')
             OR (
               l.work_email_status = 'processing'
               AND l.work_email_checked_at < now() - INTERVAL '30 minutes'
             )
           )`,
        [niche],
      ),
    ]);

    return {
      leads: rows.rows.map((row) => ({
        leadId: String(row.lead_id),
        linkedinUrl: String(row.linkedin_url),
        fullName: nullableString(row.full_name),
        companyName: nullableString(row.company_name),
        workEmailStatus: String(row.work_email_status),
        lastError: nullableString(row.work_email_last_error),
      })),
      remaining: Number(count.rows[0]?.count ?? 0),
    };
  },
});

export const beginJob = action({
  args: { leadId: v.string() },
  returns: v.object({ started: v.boolean() }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    assertUuid(args.leadId);
    const result = await getPool().query(
      `UPDATE leads
          SET work_email_status = 'processing',
              work_email_checked_at = now(),
              work_email_last_error = NULL,
              updated_at = now()
        WHERE id = $1::UUID
          AND work_email IS NULL
          AND work_email_status <> 'not_found'
        RETURNING id`,
      [args.leadId],
    );
    if (!result.rows[0]) {
      throw new Error("This lead is no longer available for work-email extraction.");
    }
    return { started: true };
  },
});

export const saveResult = action({
  args: {
    leadId: optionalText,
    inputLinkedinUrl: v.string(),
    resolvedLinkedinUrl: v.string(),
    status: v.union(v.literal("found"), v.literal("not_found")),
    email: optionalText,
    validation: optionalText,
    httpStatus: optionalNumber,
  },
  returns: v.object({ saved: v.boolean(), leadId: optionalText }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const email = args.email?.trim().toLowerCase() || null;
    if (args.status === "found" && !isValidEmail(email)) {
      throw new Error("Mailmeteor returned an invalid work email address.");
    }

    const database = getPool();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const lead = await findLeadForUpdate(client, args);
      if (!lead) {
        await client.query("COMMIT");
        return { saved: false, leadId: null };
      }
      if (lead.work_email && args.status === "not_found") {
        await client.query("COMMIT");
        return { saved: true, leadId: String(lead.id) };
      }

      await client.query(
        `UPDATE leads
            SET work_email = CASE WHEN $2 = 'found' THEN coalesce(work_email, $3) ELSE work_email END,
                work_email_collected_at = CASE
                  WHEN $2 = 'found' THEN coalesce(work_email_collected_at, now())
                  ELSE work_email_collected_at
                END,
                work_email_status = CASE WHEN work_email IS NOT NULL THEN 'found' ELSE $2 END,
                work_email_validation = $4,
                work_email_source = 'mailmeteor',
                work_email_checked_at = now(),
                work_email_resolved_linkedin_url = $5,
                work_email_last_error = NULL,
                work_email_http_status = $6,
                updated_at = now()
          WHERE id = $1::UUID`,
        [
          lead.id,
          args.status,
          email,
          cleanOptional(args.validation, 120),
          normalizeLinkedInUrl(args.resolvedLinkedinUrl),
          normalizeHttpStatus(args.httpStatus),
        ],
      );
      await client.query("COMMIT");
      return { saved: true, leadId: String(lead.id) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
});

export const recordFailure = action({
  args: {
    leadId: optionalText,
    inputLinkedinUrl: v.string(),
    resolvedLinkedinUrl: optionalText,
    error: v.string(),
    httpStatus: optionalNumber,
  },
  returns: v.object({ saved: v.boolean(), leadId: optionalText }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const database = getPool();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const lead = await findLeadForUpdate(client, {
        leadId: args.leadId,
        inputLinkedinUrl: args.inputLinkedinUrl,
        resolvedLinkedinUrl: args.resolvedLinkedinUrl || args.inputLinkedinUrl,
      });
      if (!lead) {
        await client.query("COMMIT");
        return { saved: false, leadId: null };
      }
      await client.query(
        `UPDATE leads
            SET work_email_status = 'error',
                work_email_checked_at = now(),
                work_email_resolved_linkedin_url = coalesce($2, work_email_resolved_linkedin_url),
                work_email_last_error = $3,
                work_email_http_status = $4,
                updated_at = now()
          WHERE id = $1::UUID AND work_email IS NULL`,
        [
          lead.id,
          normalizeLinkedInUrl(args.resolvedLinkedinUrl),
          String(args.error).trim().slice(0, 1000),
          normalizeHttpStatus(args.httpStatus),
        ],
      );
      await client.query("COMMIT");
      return { saved: true, leadId: String(lead.id) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
});

async function findLeadForUpdate(
  client: PoolClient,
  args: {
    leadId: string | null;
    inputLinkedinUrl: string;
    resolvedLinkedinUrl: string;
  },
) {
  if (args.leadId) {
    assertUuid(args.leadId);
    const result = await client.query(
      "SELECT id, work_email FROM leads WHERE id = $1::UUID FOR UPDATE",
      [args.leadId],
    );
    return result.rows[0] ?? null;
  }

  const inputUrl = normalizeLinkedInUrl(args.inputLinkedinUrl);
  const resolvedUrl = normalizeLinkedInUrl(args.resolvedLinkedinUrl);
  if (!inputUrl && !resolvedUrl) return null;
  const match = await client.query(
    `SELECT l.id
       FROM leads AS l
       LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
      WHERE l.linkedin_url IN ($1, $2)
         OR l.work_email_resolved_linkedin_url IN ($1, $2)
         OR a.resolved_linkedin_url IN ($1, $2)
      ORDER BY CASE
        WHEN l.linkedin_url = $1 THEN 0
        WHEN l.work_email_resolved_linkedin_url = $1 OR a.resolved_linkedin_url = $1 THEN 1
        ELSE 2
      END
      LIMIT 1`,
    [inputUrl, resolvedUrl],
  );
  if (!match.rows[0]) return null;
  const result = await client.query(
    "SELECT id, work_email FROM leads WHERE id = $1::UUID FOR UPDATE",
    [match.rows[0].id],
  );
  return result.rows[0] ?? null;
}

const preferredLinkedInUrlSql = `CASE
  WHEN l.work_email_resolved_linkedin_url LIKE 'https://linkedin.com/in/%'
    OR l.work_email_resolved_linkedin_url LIKE 'https://www.linkedin.com/in/%'
    THEN l.work_email_resolved_linkedin_url
  WHEN a.resolved_linkedin_url LIKE 'https://linkedin.com/in/%'
    OR a.resolved_linkedin_url LIKE 'https://www.linkedin.com/in/%'
    THEN a.resolved_linkedin_url
  ELSE l.linkedin_url
END`;

function normalizeLinkedInUrl(value: unknown) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!/^\/in\/[^/]+$/i.test(path)) return null;
    return `https://linkedin.com${path}`;
  } catch {
    return null;
  }
}

function isValidEmail(value: string | null): value is string {
  return Boolean(value && value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function assertUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("The lead ID is invalid.");
  }
}

function cleanOptional(value: string | null, maximum: number) {
  return value?.trim().slice(0, maximum) || null;
}

function normalizeHttpStatus(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(100, Math.min(599, Math.trunc(value)));
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}
