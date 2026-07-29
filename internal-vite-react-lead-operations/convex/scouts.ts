"use node";

import OpenAI from "openai";
import { v } from "convex/values";
import type { PoolClient } from "pg";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { getPool } from "./lib/cockroach";

type ScoutIdentity = {
  userId: string;
  username: string;
  operatorId: string;
};

type ScoutSettings = {
  postEngagements: number;
  engagementIntervalMinutes: number;
  connectionDelayMinutes: number;
  includeNote: boolean;
};

type ScoutLead = {
  id: string;
  fullName: string | null;
  currentTitle: string | null;
  companyName: string | null;
  linkedinUrl: string;
  status: string;
};

type ScoutDashboard = {
  scout: { username: string };
  counts: ReturnType<typeof emptyCounts>;
  settings: ScoutSettings;
  activeLead: ScoutLead | null;
};

const optionalText = v.union(v.string(), v.null());
const settingsValidator = v.object({
  postEngagements: v.number(),
  engagementIntervalMinutes: v.number(),
  connectionDelayMinutes: v.number(),
  includeNote: v.boolean(),
});
const leadValidator = v.object({
  id: v.string(),
  fullName: optionalText,
  currentTitle: optionalText,
  companyName: optionalText,
  linkedinUrl: v.string(),
  status: v.string(),
});
const dashboardValidator = v.object({
  scout: v.object({
    username: v.string(),
  }),
  counts: v.object({
    total: v.number(),
    fresh: v.number(),
    viewed: v.number(),
    engaged: v.number(),
    connectionRequested: v.number(),
    accepted: v.number(),
    emailCollected: v.number(),
    skipped: v.number(),
    failed: v.number(),
  }),
  settings: settingsValidator,
  activeLead: v.union(leadValidator, v.null()),
});

const commentInstructions =
  "Write one authentic professional LinkedIn comment draft based only on the supplied post text. " +
  "Use one or two concise sentences. Do not invent personal experience, facts, or familiarity. " +
  "Do not use hashtags, a sales pitch, a call to connect, or generic praise. Return only the draft.";

export const getDashboard = action({
  args: {},
  returns: dashboardValidator,
  handler: async (ctx): Promise<ScoutDashboard> => {
    const scout: ScoutIdentity = await ctx.runQuery(
      internal.scoutIdentity.requireScout,
      {},
    );
    const database = getPool();
    const [countResult, settings, activeResult] = await Promise.all([
      database.query(
        `SELECT
           count(*)::FLOAT8 AS total,
           count(*) FILTER (WHERE status = 'assigned')::FLOAT8 AS fresh,
           count(*) FILTER (WHERE status = 'viewed')::FLOAT8 AS viewed,
           count(*) FILTER (
             WHERE engaged_at IS NOT NULL
                OR status IN ('engaged', 'connection_requested', 'accepted', 'email_collected')
           )::FLOAT8 AS engaged,
           count(*) FILTER (
             WHERE connection_requested_at IS NOT NULL
                OR status IN ('connected', 'connection_requested', 'accepted', 'email_collected')
           )::FLOAT8 AS connection_requested,
           count(*) FILTER (
             WHERE accepted_at IS NOT NULL OR status IN ('accepted', 'email_collected')
           )::FLOAT8 AS accepted,
           count(*) FILTER (
             WHERE email_collected_at IS NOT NULL OR status = 'email_collected'
           )::FLOAT8 AS email_collected,
           count(*) FILTER (WHERE status = 'skipped')::FLOAT8 AS skipped,
           count(*) FILTER (WHERE status = 'failed')::FLOAT8 AS failed
         FROM lead_assignments
         WHERE operator_id = $1`,
        [scout.operatorId],
      ),
      getOrCreateSettings(scout.operatorId),
      database.query(
        `SELECT
           l.id::STRING AS id,
           l.full_name,
           l.current_title,
           l.company_name,
           l.linkedin_url,
           a.status
         FROM lead_assignments AS a
         INNER JOIN leads AS l ON l.id = a.lead_id
         WHERE a.operator_id = $1
           AND a.status IN ('viewed', 'engaged', 'connected', 'connection_requested', 'accepted')
         ORDER BY a.updated_at DESC, a.lead_id
         LIMIT 1`,
        [scout.operatorId],
      ),
    ]);

    const countRow = countResult.rows[0] ?? {};
    const counts = {
      total: Number(countRow.total ?? 0),
      fresh: Number(countRow.fresh ?? 0),
      viewed: Number(countRow.viewed ?? 0),
      engaged: Number(countRow.engaged ?? 0),
      connectionRequested: Number(countRow.connection_requested ?? 0),
      accepted: Number(countRow.accepted ?? 0),
      emailCollected: Number(countRow.email_collected ?? 0),
      skipped: Number(countRow.skipped ?? 0),
      failed: Number(countRow.failed ?? 0),
    };

    return {
      scout: { username: scout.username },
      counts,
      settings,
      activeLead: activeResult.rows[0] ? mapLead(activeResult.rows[0]) : null,
    };
  },
});

export const claimNextLead = action({
  args: {},
  returns: v.union(leadValidator, v.null()),
  handler: async (ctx): Promise<ScoutLead | null> => {
    const scout: ScoutIdentity = await ctx.runQuery(
      internal.scoutIdentity.requireScout,
      {},
    );
    const database = getPool();
    const existing = await database.query(
      `SELECT
         l.id::STRING AS id,
         l.full_name,
         l.current_title,
         l.company_name,
         l.linkedin_url,
         a.status
       FROM lead_assignments AS a
       INNER JOIN leads AS l ON l.id = a.lead_id
       WHERE a.operator_id = $1
         AND a.status IN ('viewed', 'engaged', 'connected', 'connection_requested', 'accepted')
       ORDER BY a.updated_at DESC, a.lead_id
       LIMIT 1`,
      [scout.operatorId],
    );
    if (existing.rows[0]) return mapLead(existing.rows[0]);

    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `SELECT lead_id
           FROM lead_assignments
          WHERE operator_id = $1 AND status = 'assigned'
          ORDER BY assigned_at, lead_id
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [scout.operatorId],
      );
      if (!selected.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      const leadId = selected.rows[0].lead_id;
      await client.query(
        `UPDATE lead_assignments
            SET status = 'viewed', viewed_at = coalesce(viewed_at, now()), updated_at = now()
          WHERE lead_id = $1 AND operator_id = $2`,
        [leadId, scout.operatorId],
      );
      await insertEvent(client, leadId, scout.operatorId, "viewed", {});
      const leadResult = await client.query(
        `SELECT
           l.id::STRING AS id,
           l.full_name,
           l.current_title,
           l.company_name,
           l.linkedin_url,
           'viewed' AS status
         FROM leads AS l
         WHERE l.id = $1`,
        [leadId],
      );
      await client.query("COMMIT");
      return leadResult.rows[0] ? mapLead(leadResult.rows[0]) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
});

export const updateLeadStatus = action({
  args: {
    leadId: v.string(),
    status: v.union(
      v.literal("engaged"),
      v.literal("connection_requested"),
      v.literal("accepted"),
      v.literal("email_collected"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    email: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const email = args.email?.trim().toLowerCase() || null;
    if (args.status === "email_collected" && !isValidEmail(email)) {
      throw new Error("Enter a valid email address.");
    }
    const database = getPool();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query(
        `SELECT status
           FROM lead_assignments
          WHERE lead_id = $1::UUID AND operator_id = $2
          FOR UPDATE`,
        [args.leadId, scout.operatorId],
      );
      const current = currentResult.rows[0]?.status;
      if (!current) throw new Error("This lead is not assigned to you.");
      if (!isAllowedTransition(String(current), args.status)) {
        throw new Error(`Cannot move a lead from ${current} to ${args.status}.`);
      }
      await client.query(
        `UPDATE lead_assignments
            SET status = $3,
                updated_at = now(),
                engaged_at = CASE WHEN $3 = 'engaged' THEN coalesce(engaged_at, now()) ELSE engaged_at END,
                connection_requested_at = CASE WHEN $3 = 'connection_requested' THEN coalesce(connection_requested_at, now()) ELSE connection_requested_at END,
                accepted_at = CASE WHEN $3 = 'accepted' THEN coalesce(accepted_at, now()) ELSE accepted_at END,
                email_collected_at = CASE WHEN $3 = 'email_collected' THEN coalesce(email_collected_at, now()) ELSE email_collected_at END,
                email = CASE WHEN $3 = 'email_collected' THEN $4 ELSE email END,
                last_error = CASE WHEN $3 = 'failed' THEN $5 ELSE last_error END,
                last_error_at = CASE WHEN $3 = 'failed' THEN now() ELSE last_error_at END
          WHERE lead_id = $1::UUID AND operator_id = $2`,
        [
          args.leadId,
          scout.operatorId,
          args.status,
          email,
          args.error?.slice(0, 1000) ?? null,
        ],
      );
      await insertEvent(client, args.leadId, scout.operatorId, args.status, {
        email: args.status === "email_collected" ? email : undefined,
        error: args.status === "failed" ? args.error?.slice(0, 1000) : undefined,
      });
      await client.query("COMMIT");
      return null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
});

export const updateSettings = action({
  args: {
    postEngagements: v.number(),
    engagementIntervalMinutes: v.number(),
    connectionDelayMinutes: v.number(),
    includeNote: v.boolean(),
  },
  returns: settingsValidator,
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const settings = {
      postEngagements: clampInteger(args.postEngagements, 1, 10),
      engagementIntervalMinutes: clampInteger(
        args.engagementIntervalMinutes,
        1,
        43_200,
      ),
      connectionDelayMinutes: clampInteger(
        args.connectionDelayMinutes,
        0,
        43_200,
      ),
      includeNote: args.includeNote,
    };
    const database = getPool();
    await database.query(
      `UPSERT INTO operator_settings (
         operator_id,
         post_engagements,
         engagement_interval_minutes,
         connection_delay_minutes,
         include_note,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, now())`,
      [
        scout.operatorId,
        settings.postEngagements,
        settings.engagementIntervalMinutes,
        settings.connectionDelayMinutes,
        settings.includeNote,
      ],
    );
    return settings;
  },
});

export const reportError = action({
  args: {
    leadId: v.union(v.string(), v.null()),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const database = getPool();
    const message =
      args.message.trim().slice(0, 1000) || "Unknown extension error";
    if (args.leadId) {
      await database.query(
        `UPDATE lead_assignments
            SET last_error = $3, last_error_at = now(), updated_at = now()
          WHERE lead_id = $1::UUID AND operator_id = $2`,
        [args.leadId, scout.operatorId, message],
      );
      await database.query(
        `INSERT INTO lead_assignment_events (lead_id, operator_id, event_type, details)
         SELECT lead_id, operator_id, 'error', $3::JSONB
           FROM lead_assignments
          WHERE lead_id = $1::UUID AND operator_id = $2`,
        [args.leadId, scout.operatorId, JSON.stringify({ message })],
      );
    }
    return null;
  },
});

export const draftComment = action({
  args: {
    postText: v.string(),
  },
  returns: v.object({
    draft: v.string(),
    threadId: v.string(),
    model: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ draft: string; threadId: string; model: string }> => {
    const scout: ScoutIdentity = await ctx.runQuery(
      internal.scoutIdentity.requireScout,
      {},
    );
    const postText = args.postText.trim();
    if (postText.length < 30 || postText.length > 8_000) {
      throw new Error("Post text must be between 30 and 8,000 characters.");
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        "The OpenAI API key is not configured on this Convex deployment.",
      );
    }
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: "gpt-5.6-luna",
      instructions: commentInstructions,
      input: `Draft a comment for this post:\n\n${postText}`,
      max_output_tokens: 180,
      reasoning: { effort: "low" },
      safety_identifier: `scout_${scout.userId}`,
      store: false,
      text: { verbosity: "low" },
    });
    return {
      draft: response.output_text.trim(),
      threadId: response.id,
      model: "gpt-5.6-luna",
    };
  },
});

async function getOrCreateSettings(operatorId: string) {
  const database = getPool();
  await database.query(
    `INSERT INTO operator_settings (operator_id)
     VALUES ($1)
     ON CONFLICT (operator_id) DO NOTHING`,
    [operatorId],
  );
  const result = await database.query(
    `SELECT
       post_engagements::FLOAT8 AS post_engagements,
       engagement_interval_minutes::FLOAT8 AS engagement_interval_minutes,
       connection_delay_minutes::FLOAT8 AS connection_delay_minutes,
       include_note
     FROM operator_settings
     WHERE operator_id = $1`,
    [operatorId],
  );
  const row = result.rows[0];
  return {
    postEngagements: Number(row?.post_engagements ?? 3),
    engagementIntervalMinutes: Number(
      row?.engagement_interval_minutes ?? 60,
    ),
    connectionDelayMinutes: Number(row?.connection_delay_minutes ?? 1440),
    includeNote: Boolean(row?.include_note),
  };
}

function emptyCounts() {
  return {
    total: 0,
    fresh: 0,
    viewed: 0,
    engaged: 0,
    connectionRequested: 0,
    accepted: 0,
    emailCollected: 0,
    skipped: 0,
    failed: 0,
  };
}

function mapLead(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    fullName: nullableString(row.full_name),
    currentTitle: nullableString(row.current_title),
    companyName: nullableString(row.company_name),
    linkedinUrl: String(row.linkedin_url ?? ""),
    status: String(row.status ?? "assigned"),
  };
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function clampInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) {
    throw new Error("Settings must be valid numbers.");
  }
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function isValidEmail(value: string | null): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function isAllowedTransition(current: string, next: string) {
  if (next === "failed" || next === "skipped") {
    return [
      "assigned",
      "viewed",
      "engaged",
      "connected",
      "connection_requested",
      "accepted",
    ].includes(current);
  }
  const transitions: Record<string, string[]> = {
    viewed: ["engaged", "connection_requested"],
    engaged: ["connection_requested"],
    connected: ["accepted"],
    connection_requested: ["accepted"],
    accepted: ["email_collected"],
  };
  return transitions[current]?.includes(next) ?? false;
}

async function insertEvent(
  client: PoolClient,
  leadId: unknown,
  operatorId: string,
  eventType: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO lead_assignment_events (lead_id, operator_id, event_type, details)
     VALUES ($1::UUID, $2, $3, $4::JSONB)`,
    [leadId, operatorId, eventType, JSON.stringify(details)],
  );
}
