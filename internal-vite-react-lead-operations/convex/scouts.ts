"use node";

import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import type { PoolClient } from "pg";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requestCodexGateway } from "./lib/codexGateway";
import { getPool } from "./lib/cockroach";

type ScoutIdentity = {
  userId: string;
  username: string;
  operatorId: string;
};

type ScoutSettings = {
  postEngagements: number;
  linkedinPremium: boolean;
  linkedinPremiumVerified: boolean;
  connectionDailyLimit: number;
  engagementDailyLimit: number;
  onboardingCompleted: boolean;
  includeNote: boolean;
};

type DailyUsage = {
  date: string;
  requestsSent: number;
  likesUsed: number;
  requestLimit: number;
  engagementLimit: number;
  requestRemaining: number;
  engagementRemaining: number;
};

type ScoutLead = {
  id: string;
  fullName: string | null;
  currentTitle: string | null;
  companyName: string | null;
  linkedinUrl: string;
  status: string;
};

type ReviewLead = {
  id: string;
  fullName: string | null;
  profileUrl: string;
  requestedAt: string | null;
};

type ConnectionReviewPlan = {
  shouldReview: boolean;
  cutoffDate: string | null;
  checkpoint: {
    topProfileUrl: string | null;
    topConnectedOn: string | null;
    lastReviewedAt: string | null;
  };
  pendingLeads: ReviewLead[];
  contactLeads: ReviewLead[];
};

type ScoutDashboard = {
  scout: { username: string };
  counts: ReturnType<typeof emptyCounts>;
  settings: ScoutSettings;
  usage: DailyUsage;
  hasSentConnectionRequest: boolean;
  activeLead: ScoutLead | null;
};

type ScoutOperations = {
  generatedAt: string;
  oldRequests: Array<{
    leadId: string;
    fullName: string | null;
    profileUrl: string;
    requestedAt: string;
    ageDays: number;
  }>;
  followups: Array<{
    id: string;
    leadId: string;
    fullName: string | null;
    profileUrl: string;
    step: number;
    dueAt: string;
    status: string;
    messageText: string;
    isDue: boolean;
  }>;
  dailyTasks: Array<{
    taskKey: string;
    label: string;
    helpText: string;
    completed: boolean;
  }>;
  leadsToCheck: Array<{
    leadId: string;
    fullName: string | null;
    currentTitle: string | null;
    companyName: string | null;
    profileUrl: string;
    qualificationStatus: string;
    hasRecentPost: boolean | null;
    icpScore: number;
    icpReason: string;
    note: string | null;
  }>;
  openEscalations: number;
};

const optionalText = v.union(v.string(), v.null());
const settingsValidator = v.object({
  postEngagements: v.number(),
  linkedinPremium: v.boolean(),
  linkedinPremiumVerified: v.boolean(),
  connectionDailyLimit: v.number(),
  engagementDailyLimit: v.number(),
  onboardingCompleted: v.boolean(),
  includeNote: v.boolean(),
});
const usageValidator = v.object({
  date: v.string(),
  requestsSent: v.number(),
  likesUsed: v.number(),
  requestLimit: v.number(),
  engagementLimit: v.number(),
  requestRemaining: v.number(),
  engagementRemaining: v.number(),
});
const leadValidator = v.object({
  id: v.string(),
  fullName: optionalText,
  currentTitle: optionalText,
  companyName: optionalText,
  linkedinUrl: v.string(),
  status: v.string(),
});
const reviewLeadValidator = v.object({
  id: v.string(),
  fullName: optionalText,
  profileUrl: v.string(),
  requestedAt: optionalText,
});
const checkpointValidator = v.object({
  topProfileUrl: optionalText,
  topConnectedOn: optionalText,
  lastReviewedAt: optionalText,
});
const dashboardValidator = v.object({
  scout: v.object({ username: v.string() }),
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
  usage: usageValidator,
  hasSentConnectionRequest: v.boolean(),
  activeLead: v.union(leadValidator, v.null()),
});

const oldRequestValidator = v.object({
  leadId: v.string(),
  fullName: optionalText,
  profileUrl: v.string(),
  requestedAt: v.string(),
  ageDays: v.number(),
});

const followupTaskValidator = v.object({
  id: v.string(),
  leadId: v.string(),
  fullName: optionalText,
  profileUrl: v.string(),
  step: v.number(),
  dueAt: v.string(),
  status: v.string(),
  messageText: v.string(),
  isDue: v.boolean(),
});

const dailyTaskValidator = v.object({
  taskKey: v.string(),
  label: v.string(),
  helpText: v.string(),
  completed: v.boolean(),
});

const qualificationLeadValidator = v.object({
  leadId: v.string(),
  fullName: optionalText,
  currentTitle: optionalText,
  companyName: optionalText,
  profileUrl: v.string(),
  qualificationStatus: v.string(),
  hasRecentPost: v.union(v.boolean(), v.null()),
  icpScore: v.number(),
  icpReason: v.string(),
  note: optionalText,
});

const scoutOperationsValidator = v.object({
  generatedAt: v.string(),
  oldRequests: v.array(oldRequestValidator),
  followups: v.array(followupTaskValidator),
  dailyTasks: v.array(dailyTaskValidator),
  leadsToCheck: v.array(qualificationLeadValidator),
  openEscalations: v.number(),
});

export const getDashboard = action({
  args: {},
  returns: dashboardValidator,
  handler: async (ctx): Promise<ScoutDashboard> => {
    const scout: ScoutIdentity = await ctx.runQuery(
      internal.scoutIdentity.requireScout,
      {},
    );
    const database = getPool();
    const settings = await getOrCreateSettings(scout.operatorId);
    const [countResult, usage, activeResult] = await Promise.all([
      database.query(
        `SELECT
           count(*)::FLOAT8 AS total,
           count(*) FILTER (
             WHERE status = 'assigned' AND qualification_status <> 'not_qualified'
           )::FLOAT8 AS fresh,
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
      getOrCreateDailyUsage(scout.operatorId, settings),
      database.query(
        `SELECT
           l.id::STRING AS id,
           l.full_name,
           l.current_title,
           l.company_name,
           coalesce(a.resolved_linkedin_url, l.linkedin_url) AS linkedin_url,
           a.status
         FROM lead_assignments AS a
         INNER JOIN leads AS l ON l.id = a.lead_id
         WHERE a.operator_id = $1
           AND a.status IN ('viewed', 'engaged')
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
      usage,
      hasSentConnectionRequest: counts.connectionRequested > 0,
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
         coalesce(a.resolved_linkedin_url, l.linkedin_url) AS linkedin_url,
         a.status
       FROM lead_assignments AS a
       INNER JOIN leads AS l ON l.id = a.lead_id
       WHERE a.operator_id = $1
         AND a.status IN ('viewed', 'engaged')
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
          WHERE operator_id = $1
            AND status = 'assigned'
            AND qualification_status <> 'not_qualified'
          ORDER BY
            CASE WHEN qualification_status = 'qualified' THEN 0 ELSE 1 END,
            assigned_at,
            lead_id
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

export const recordProfileVisit = action({
  args: { leadId: v.string(), resolvedLinkedinUrl: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const resolvedUrl = normalizeLinkedInProfileUrl(args.resolvedLinkedinUrl);
    const database = getPool();
    const result = await database.query(
      `UPDATE lead_assignments
          SET resolved_linkedin_url = $3,
              status = CASE WHEN status = 'assigned' THEN 'viewed' ELSE status END,
              viewed_at = coalesce(viewed_at, now()),
              updated_at = now()
        WHERE lead_id = $1::UUID
          AND operator_id = $2
          AND status IN ('assigned', 'viewed', 'engaged')
      RETURNING lead_id`,
      [args.leadId, scout.operatorId, resolvedUrl],
    );
    if (!result.rows[0]) throw new Error("This lead is not available to visit.");
    await database.query(
      `INSERT INTO lead_assignment_events (lead_id, operator_id, event_type, details)
       VALUES ($1::UUID, $2, 'profile_visited', $3::JSONB)`,
      [args.leadId, scout.operatorId, JSON.stringify({ profileUrl: resolvedUrl })],
    );
    return null;
  },
});

export const recordPostActivity = action({
  args: {
    leadId: v.string(),
    profileUrl: v.string(),
    postUrl: v.string(),
    postText: v.string(),
    commentText: v.string(),
    liked: v.boolean(),
  },
  returns: usageValidator,
  handler: async (ctx, args): Promise<DailyUsage> => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const settings = await getOrCreateSettings(scout.operatorId);
    const profileUrl = normalizeLinkedInProfileUrl(args.profileUrl);
    const postUrl = normalizeLinkedInPostUrl(args.postUrl);
    const postText = args.postText.trim().slice(0, 8_000);
    const commentText = args.commentText.trim().slice(0, 2_000);
    if (!postText || !commentText) {
      throw new Error("Post activity requires the post text and submitted comment.");
    }

    const database = getPool();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const assignment = await client.query(
        `SELECT status
           FROM lead_assignments
          WHERE lead_id = $1::UUID AND operator_id = $2
          FOR UPDATE`,
        [args.leadId, scout.operatorId],
      );
      const status = String(assignment.rows[0]?.status ?? "");
      if (!["viewed", "engaged"].includes(status)) {
        throw new Error("This lead is not available for post engagement.");
      }

      const existing = await client.query(
        `SELECT liked
           FROM lead_post_activities
          WHERE operator_id = $1 AND lead_id = $2::UUID AND post_url = $3
          FOR UPDATE`,
        [scout.operatorId, args.leadId, postUrl],
      );
      const shouldCountLike = args.liked && existing.rows[0]?.liked !== true;
      await ensureDailyUsageRow(client, scout.operatorId);
      const usageResult = await client.query(
        `SELECT usage_date::STRING AS usage_date, requests_sent, likes_used
           FROM operator_daily_usage
          WHERE operator_id = $1 AND usage_date = current_date
          FOR UPDATE`,
        [scout.operatorId],
      );
      const currentLikes = Number(usageResult.rows[0]?.likes_used ?? 0);
      if (shouldCountLike && currentLikes >= configuredEngagementLimit(settings)) {
        throw new Error("Today's LinkedIn engagement limit has been reached.");
      }

      await client.query(
        `INSERT INTO lead_post_activities (
           lead_id, operator_id, profile_url, post_url, post_text,
           comment_text, liked, liked_at, commented_at, updated_at
         ) VALUES (
           $1::UUID, $2, $3, $4, $5, $6, $7,
           CASE WHEN $7 THEN now() ELSE NULL END, now(), now()
         )
         ON CONFLICT (operator_id, lead_id, post_url) DO UPDATE SET
           profile_url = excluded.profile_url,
           post_text = excluded.post_text,
           comment_text = excluded.comment_text,
           liked = lead_post_activities.liked OR excluded.liked,
           liked_at = coalesce(lead_post_activities.liked_at, excluded.liked_at),
           commented_at = now(),
           updated_at = now()`,
        [
          args.leadId,
          scout.operatorId,
          profileUrl,
          postUrl,
          postText,
          commentText,
          args.liked,
        ],
      );
      if (shouldCountLike) {
        await client.query(
          `UPDATE operator_daily_usage
              SET likes_used = likes_used + 1, updated_at = now()
            WHERE operator_id = $1 AND usage_date = current_date`,
          [scout.operatorId],
        );
      }
      await client.query(
        `UPDATE lead_assignments
            SET status = 'engaged',
                engaged_at = coalesce(engaged_at, now()),
                recent_post_checked_at = coalesce(recent_post_checked_at, now()),
                has_recent_post = true,
                resolved_linkedin_url = $3,
                updated_at = now()
          WHERE lead_id = $1::UUID AND operator_id = $2`,
        [args.leadId, scout.operatorId, profileUrl],
      );
      await insertEvent(client, args.leadId, scout.operatorId, "post_engaged", {
        profileUrl,
        postUrl,
        comment: commentText,
        liked: args.liked,
      });
      await client.query("COMMIT");
      return getOrCreateDailyUsage(scout.operatorId, settings);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
});

export const reserveConnectionRequest = action({
  args: { leadId: v.string() },
  returns: usageValidator,
  handler: async (ctx, args): Promise<DailyUsage> => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const settings = await getOrCreateSettings(scout.operatorId);
    const database = getPool();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const assignment = await client.query(
        `SELECT status, connection_request_reserved_on::STRING AS reserved_on
           FROM lead_assignments
          WHERE lead_id = $1::UUID AND operator_id = $2
          FOR UPDATE`,
        [args.leadId, scout.operatorId],
      );
      const row = assignment.rows[0];
      if (!row || row.status !== "engaged") {
        throw new Error("The lead must complete engagement before connecting.");
      }
      await ensureDailyUsageRow(client, scout.operatorId);
      const usageResult = await client.query(
        `SELECT current_date::STRING AS usage_date, requests_sent, likes_used
           FROM operator_daily_usage
          WHERE operator_id = $1 AND usage_date = current_date
          FOR UPDATE`,
        [scout.operatorId],
      );
      if (String(row.reserved_on ?? "") !== String(usageResult.rows[0]?.usage_date)) {
        if (
          Number(usageResult.rows[0]?.requests_sent ?? 0) >=
          settings.connectionDailyLimit
        ) {
          throw new Error("Today's LinkedIn connection-request limit has been reached.");
        }
        await client.query(
          `UPDATE operator_daily_usage
              SET requests_sent = requests_sent + 1, updated_at = now()
            WHERE operator_id = $1 AND usage_date = current_date`,
          [scout.operatorId],
        );
        await client.query(
          `UPDATE lead_assignments
              SET connection_request_reserved_on = current_date, updated_at = now()
            WHERE lead_id = $1::UUID AND operator_id = $2`,
          [args.leadId, scout.operatorId],
        );
      }
      await client.query("COMMIT");
      return getOrCreateDailyUsage(scout.operatorId, settings);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
});

export const releaseConnectionRequest = action({
  args: { leadId: v.string() },
  returns: usageValidator,
  handler: async (ctx, args): Promise<DailyUsage> => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const settings = await getOrCreateSettings(scout.operatorId);
    const database = getPool();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const released = await client.query(
        `UPDATE lead_assignments
            SET connection_request_reserved_on = NULL, updated_at = now()
          WHERE lead_id = $1::UUID
            AND operator_id = $2
            AND status = 'engaged'
            AND connection_request_reserved_on = current_date
        RETURNING lead_id`,
        [args.leadId, scout.operatorId],
      );
      if (released.rows[0]) {
        await client.query(
          `UPDATE operator_daily_usage
              SET requests_sent = greatest(0, requests_sent - 1), updated_at = now()
            WHERE operator_id = $1 AND usage_date = current_date`,
          [scout.operatorId],
        );
      }
      await client.query("COMMIT");
      return getOrCreateDailyUsage(scout.operatorId, settings);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
});

export const completeConnectionRequest = action({
  args: { leadId: v.string(), profileUrl: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const profileUrl = normalizeLinkedInProfileUrl(args.profileUrl);
    const database = getPool();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE lead_assignments
            SET status = 'connection_requested',
                connection_requested_at = coalesce(connection_requested_at, now()),
                resolved_linkedin_url = $3,
                updated_at = now()
          WHERE lead_id = $1::UUID
            AND operator_id = $2
            AND status = 'engaged'
            AND connection_request_reserved_on = current_date
        RETURNING lead_id`,
        [args.leadId, scout.operatorId, profileUrl],
      );
      if (!result.rows[0]) {
        throw new Error("No reserved connection-request slot exists for this lead.");
      }
      await insertEvent(
        client,
        args.leadId,
        scout.operatorId,
        "connection_requested",
        { profileUrl },
      );
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

export const getConnectionReviewPlan = action({
  args: {},
  returns: v.object({
    shouldReview: v.boolean(),
    cutoffDate: optionalText,
    checkpoint: checkpointValidator,
    pendingLeads: v.array(reviewLeadValidator),
    contactLeads: v.array(reviewLeadValidator),
  }),
  handler: async (ctx): Promise<ConnectionReviewPlan> => {
    const scout: ScoutIdentity = await ctx.runQuery(
      internal.scoutIdentity.requireScout,
      {},
    );
    const database = getPool();
    const [history, pending, contact, checkpoint] = await Promise.all([
      database.query(
        `SELECT count(*)::FLOAT8 AS count
           FROM lead_assignments
          WHERE operator_id = $1 AND connection_requested_at IS NOT NULL`,
        [scout.operatorId],
      ),
      database.query(
        `SELECT
           l.id::STRING AS id,
           l.full_name,
           coalesce(a.resolved_linkedin_url, l.linkedin_url) AS profile_url,
           a.connection_requested_at::STRING AS requested_at
         FROM lead_assignments AS a
         INNER JOIN leads AS l ON l.id = a.lead_id
         WHERE a.operator_id = $1 AND a.status = 'connection_requested'
         ORDER BY a.connection_requested_at, a.lead_id
         LIMIT 1000`,
        [scout.operatorId],
      ),
      database.query(
        `SELECT
           l.id::STRING AS id,
           l.full_name,
           coalesce(a.resolved_linkedin_url, l.linkedin_url) AS profile_url,
           a.connection_requested_at::STRING AS requested_at
         FROM lead_assignments AS a
         INNER JOIN leads AS l ON l.id = a.lead_id
         WHERE a.operator_id = $1 AND a.status = 'accepted'
         ORDER BY a.accepted_at, a.lead_id
         LIMIT 1000`,
        [scout.operatorId],
      ),
      database.query(
        `SELECT
           top_profile_url,
           top_connected_on::STRING AS top_connected_on,
           last_reviewed_at::STRING AS last_reviewed_at
         FROM operator_connection_review_checkpoints
         WHERE operator_id = $1`,
        [scout.operatorId],
      ),
    ]);
    const pendingLeads = pending.rows.map(mapReviewLead);
    const contactLeads = contact.rows.map(mapReviewLead);
    const checkpointRow = checkpoint.rows[0] ?? {};
    const cutoffDate = pendingLeads
      .map((lead) => lead.requestedAt?.slice(0, 10) ?? null)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;
    return {
      shouldReview: Number(history.rows[0]?.count ?? 0) > 0,
      cutoffDate,
      checkpoint: {
        topProfileUrl: nullableString(checkpointRow.top_profile_url),
        topConnectedOn: nullableString(checkpointRow.top_connected_on),
        lastReviewedAt: nullableString(checkpointRow.last_reviewed_at),
      },
      pendingLeads,
      contactLeads,
    };
  },
});

export const recordConnectionReview = action({
  args: {
    connections: v.array(
      v.object({
        profileUrl: v.string(),
        name: v.string(),
        connectedOn: v.string(),
      }),
    ),
    top: v.union(
      v.object({ profileUrl: v.string(), connectedOn: v.string() }),
      v.null(),
    ),
  },
  returns: v.object({
    acceptedLeads: v.array(reviewLeadValidator),
    matched: v.number(),
  }),
  handler: async (ctx, args) => {
    if (args.connections.length > 250) {
      throw new Error("A connection review can inspect at most 250 profiles.");
    }
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const database = getPool();
    const client = await database.connect();
    const acceptedLeads: ReviewLead[] = [];
    try {
      await client.query("BEGIN");
      const pending = await client.query(
        `SELECT
           l.id::STRING AS id,
           l.full_name,
           l.first_name,
           l.linkedin_url,
           a.resolved_linkedin_url,
           a.connection_requested_at::STRING AS requested_at
         FROM lead_assignments AS a
         INNER JOIN leads AS l ON l.id = a.lead_id
         WHERE a.operator_id = $1 AND a.status = 'connection_requested'
         ORDER BY a.connection_requested_at, a.lead_id
         LIMIT 1000
         FOR UPDATE`,
        [scout.operatorId],
      );
      const byProfile = new Map<string, Record<string, unknown>>();
      for (const row of pending.rows as Array<Record<string, unknown>>) {
        for (const value of [row.resolved_linkedin_url, row.linkedin_url]) {
          const normalized = tryNormalizeLinkedInProfileUrl(value);
          if (normalized) byProfile.set(normalized, row);
        }
      }
      const matchedLeadIds = new Set<string>();
      for (const connection of args.connections) {
        const profileUrl = normalizeLinkedInProfileUrl(connection.profileUrl);
        const row = byProfile.get(profileUrl);
        const leadId = row ? String(row.id) : "";
        if (!row || matchedLeadIds.has(leadId)) continue;
        const connectedOn = validateDateKey(connection.connectedOn);
        await client.query(
          `UPDATE lead_assignments
              SET status = 'accepted',
                  accepted_at = coalesce(accepted_at, $3::DATE::TIMESTAMPTZ),
                  resolved_linkedin_url = $4,
                  updated_at = now()
            WHERE lead_id = $1::UUID AND operator_id = $2`,
          [leadId, scout.operatorId, connectedOn, profileUrl],
        );
        await insertEvent(client, leadId, scout.operatorId, "accepted", {
          profileUrl,
          connectedOn,
          source: "linkedin_connections_review",
        });
        await createFollowupTasks(
          client,
          leadId,
          scout.operatorId,
          nullableString(row.first_name) ?? firstNameFrom(row.full_name),
        );
        matchedLeadIds.add(leadId);
        acceptedLeads.push({
          id: leadId,
          fullName: nullableString(row.full_name),
          profileUrl,
          requestedAt: nullableString(row.requested_at),
        });
      }

      if (args.top) {
        const topProfileUrl = normalizeLinkedInProfileUrl(args.top.profileUrl);
        const topConnectedOn = validateDateKey(args.top.connectedOn);
        await client.query(
          `UPSERT INTO operator_connection_review_checkpoints (
             operator_id, top_profile_url, top_connected_on, last_reviewed_at, updated_at
           ) VALUES ($1, $2, $3::DATE, now(), now())`,
          [scout.operatorId, topProfileUrl, topConnectedOn],
        );
      } else {
        await client.query(
          `INSERT INTO operator_connection_review_checkpoints (
             operator_id, top_profile_url, top_connected_on, last_reviewed_at, updated_at
           ) VALUES ($1, NULL, NULL, now(), now())
           ON CONFLICT (operator_id) DO UPDATE SET
             last_reviewed_at = now(),
             updated_at = now()`,
          [scout.operatorId],
        );
      }
      await client.query("COMMIT");
      return { acceptedLeads, matched: acceptedLeads.length };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
});

export const recordContactInfo = action({
  args: {
    leadId: v.string(),
    profileUrl: v.string(),
    email: optionalText,
  },
  returns: v.object({ status: v.string(), email: optionalText }),
  handler: async (
    ctx,
    args,
  ): Promise<{ status: string; email: string | null }> => {
    const scout: ScoutIdentity = await ctx.runQuery(
      internal.scoutIdentity.requireScout,
      {},
    );
    const profileUrl = normalizeLinkedInProfileUrl(args.profileUrl);
    const email = args.email?.trim().toLowerCase() || null;
    if (email && !isValidEmail(email)) {
      throw new Error("LinkedIn returned an invalid email address.");
    }
    const database = getPool();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT a.status, a.email AS legacy_email, l.original_email
           FROM lead_assignments AS a
           INNER JOIN leads AS l ON l.id = a.lead_id
          WHERE a.lead_id = $1::UUID AND a.operator_id = $2
          FOR UPDATE`,
        [args.leadId, scout.operatorId],
      );
      const row = current.rows[0];
      if (!row || !["accepted", "email_collected"].includes(String(row.status))) {
        throw new Error("Only an accepted assigned lead can expose contact info.");
      }
      const existingEmail = nullableString(row.original_email) || nullableString(row.legacy_email);
      const finalEmail = email || existingEmail;
      const nextStatus = finalEmail ? "email_collected" : "accepted";
      if (finalEmail) {
        await client.query(
          `UPDATE leads
              SET original_email = coalesce(original_email, $2),
                  original_email_collected_at = coalesce(original_email_collected_at, now()),
                  updated_at = now()
            WHERE id = $1::UUID`,
          [args.leadId, finalEmail],
        );
      }
      await client.query(
        `UPDATE lead_assignments
            SET status = $3,
                resolved_linkedin_url = $4,
                email = coalesce($5, email),
                email_collected_at = CASE
                  WHEN $5 IS NOT NULL THEN coalesce(email_collected_at, now())
                  ELSE email_collected_at
                END,
                updated_at = now()
          WHERE lead_id = $1::UUID AND operator_id = $2`,
        [args.leadId, scout.operatorId, nextStatus, profileUrl, finalEmail],
      );
      await insertEvent(
        client,
        args.leadId,
        scout.operatorId,
        "contact_info_checked",
        { profileUrl, emailFound: Boolean(finalEmail) },
      );
      if (email && !existingEmail) {
        await insertEvent(
          client,
          args.leadId,
          scout.operatorId,
          "email_collected",
          { profileUrl, email },
        );
        await client.query(
          `INSERT INTO crm_delivery_outbox (lead_id, operator_id, status, updated_at)
           VALUES ($1::UUID, $2, 'pending', now())
           ON CONFLICT (lead_id, operator_id) DO UPDATE SET
             status = CASE
               WHEN crm_delivery_outbox.status = 'sent' THEN 'sent'
               ELSE 'pending'
             END,
             last_error = CASE
               WHEN crm_delivery_outbox.status = 'sent' THEN crm_delivery_outbox.last_error
               ELSE NULL
             END,
             updated_at = now()`,
          [args.leadId, scout.operatorId],
        );
      }
      await client.query("COMMIT");
      return { status: nextStatus, email: finalEmail };
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
    email: optionalText,
    error: optionalText,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (["connection_requested", "accepted", "email_collected"].includes(args.status)) {
      throw new Error(
        "This status is recorded by the quota, connection-review, or contact-info workflow.",
      );
    }
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
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
      const current = String(currentResult.rows[0]?.status ?? "");
      if (!current) throw new Error("This lead is not assigned to you.");
      if (!isAllowedTransition(current, args.status)) {
        throw new Error(`Cannot move a lead from ${current} to ${args.status}.`);
      }
      await client.query(
        `UPDATE lead_assignments
            SET status = $3,
                updated_at = now(),
                engaged_at = CASE WHEN $3 = 'engaged' THEN coalesce(engaged_at, now()) ELSE engaged_at END,
                recent_post_checked_at = CASE
                  WHEN $3 = 'skipped' AND $5 THEN coalesce(recent_post_checked_at, now())
                  ELSE recent_post_checked_at
                END,
                has_recent_post = CASE
                  WHEN $3 = 'skipped' AND $5 THEN false
                  ELSE has_recent_post
                END,
                last_error = CASE WHEN $3 = 'failed' THEN $4 ELSE last_error END,
                last_error_at = CASE WHEN $3 = 'failed' THEN now() ELSE last_error_at END
          WHERE lead_id = $1::UUID AND operator_id = $2`,
        [
          args.leadId,
          scout.operatorId,
          args.status,
          args.error?.slice(0, 1000) ?? null,
          args.status === "skipped" && /no recent posts/i.test(args.error ?? ""),
        ],
      );
      await insertEvent(client, args.leadId, scout.operatorId, args.status, {
        error: args.status === "failed" ? args.error?.slice(0, 1000) : null,
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

export const getScoutOperations = action({
  args: {},
  returns: scoutOperationsValidator,
  handler: async (ctx): Promise<ScoutOperations> => {
    const scout: ScoutIdentity = await ctx.runQuery(
      internal.scoutIdentity.requireScout,
      {},
    );
    const database = getPool();
    await ensureDailyTasks(scout.operatorId);
    const [oldResult, followupResult, taskResult, leadResult, escalationResult] =
      await Promise.all([
        database.query(
          `SELECT
             l.id::STRING AS lead_id,
             l.full_name,
             coalesce(a.resolved_linkedin_url, l.linkedin_url) AS profile_url,
             a.connection_requested_at::STRING AS requested_at,
             (current_date - a.connection_requested_at::DATE)::FLOAT8 AS age_days
           FROM lead_assignments AS a
           INNER JOIN leads AS l ON l.id = a.lead_id
           WHERE a.operator_id = $1
             AND a.status = 'connection_requested'
             AND a.connection_requested_at <= now() - INTERVAL '30 days'
           ORDER BY a.connection_requested_at, a.lead_id
           LIMIT 100`,
          [scout.operatorId],
        ),
        database.query(
          `SELECT
             t.id::STRING AS id,
             t.lead_id::STRING AS lead_id,
             l.full_name,
             coalesce(a.resolved_linkedin_url, l.linkedin_url) AS profile_url,
             t.step::FLOAT8 AS step,
             t.due_at::STRING AS due_at,
             t.status,
             t.message_text,
             t.due_at <= now() AS is_due
           FROM lead_followup_tasks AS t
           INNER JOIN leads AS l ON l.id = t.lead_id
           INNER JOIN lead_assignments AS a
             ON a.lead_id = t.lead_id AND a.operator_id = t.operator_id
           WHERE t.operator_id = $1 AND t.status = 'pending'
           ORDER BY t.due_at, t.step, t.id
           LIMIT 50`,
          [scout.operatorId],
        ),
        database.query(
          `SELECT task_key, label, help_text, completed
             FROM operator_daily_tasks
            WHERE operator_id = $1 AND task_date = current_date
            ORDER BY task_key`,
          [scout.operatorId],
        ),
        database.query(
          `SELECT
             l.id::STRING AS lead_id,
             l.full_name,
             l.current_title,
             l.company_name,
             l.company_size,
             coalesce(a.resolved_linkedin_url, l.linkedin_url) AS profile_url,
             a.qualification_status,
             a.has_recent_post,
             a.icp_score,
             a.qualification_note
           FROM lead_assignments AS a
           INNER JOIN leads AS l ON l.id = a.lead_id
           WHERE a.operator_id = $1
             AND a.status = 'assigned'
             AND a.qualification_status = 'pending'
           ORDER BY a.assigned_at, a.lead_id
           LIMIT 12`,
          [scout.operatorId],
        ),
        database.query(
          `SELECT count(*)::FLOAT8 AS count
             FROM scout_escalations
            WHERE operator_id = $1 AND status = 'open'`,
          [scout.operatorId],
        ),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      oldRequests: oldResult.rows.map((row) => ({
        leadId: String(row.lead_id),
        fullName: nullableString(row.full_name),
        profileUrl: normalizeLinkedInProfileUrl(row.profile_url),
        requestedAt: String(row.requested_at),
        ageDays: Number(row.age_days ?? 30),
      })),
      followups: followupResult.rows.map((row) => ({
        id: String(row.id),
        leadId: String(row.lead_id),
        fullName: nullableString(row.full_name),
        profileUrl: normalizeLinkedInProfileUrl(row.profile_url),
        step: Number(row.step),
        dueAt: String(row.due_at),
        status: String(row.status),
        messageText: String(row.message_text),
        isDue: Boolean(row.is_due),
      })),
      dailyTasks: taskResult.rows.map((row) => ({
        taskKey: String(row.task_key),
        label: String(row.label),
        helpText: String(row.help_text),
        completed: Boolean(row.completed),
      })),
      leadsToCheck: leadResult.rows.map((row) => {
        const score = scoreIcp(row.current_title, row.company_size);
        return {
          leadId: String(row.lead_id),
          fullName: nullableString(row.full_name),
          currentTitle: nullableString(row.current_title),
          companyName: nullableString(row.company_name),
          profileUrl: normalizeLinkedInProfileUrl(row.profile_url),
          qualificationStatus: String(row.qualification_status),
          hasRecentPost:
            typeof row.has_recent_post === "boolean" ? row.has_recent_post : null,
          icpScore: Number(row.icp_score ?? score.value),
          icpReason: score.reason,
          note: nullableString(row.qualification_note),
        };
      }),
      openEscalations: Number(escalationResult.rows[0]?.count ?? 0),
    };
  },
});

export const setDailyTask = action({
  args: { taskKey: v.string(), completed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    if (!DAILY_TASKS.some((task) => task.key === args.taskKey)) {
      throw new Error("This checklist item does not exist.");
    }
    await ensureDailyTasks(scout.operatorId);
    await getPool().query(
      `UPDATE operator_daily_tasks
          SET completed = $3,
              completed_at = CASE WHEN $3 THEN now() ELSE NULL END,
              updated_at = now()
        WHERE operator_id = $1 AND task_date = current_date AND task_key = $2`,
      [scout.operatorId, args.taskKey, args.completed],
    );
    return null;
  },
});

export const markOldRequestWithdrawn = action({
  args: { leadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const database = getPool();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE lead_assignments
            SET status = 'withdrawn',
                withdrawn_at = now(),
                connection_request_reserved_on = NULL,
                updated_at = now()
          WHERE lead_id = $1::UUID
            AND operator_id = $2
            AND status = 'connection_requested'
            AND connection_requested_at <= now() - INTERVAL '30 days'
        RETURNING lead_id`,
        [args.leadId, scout.operatorId],
      );
      if (!result.rows[0]) {
        throw new Error("This request is not ready for the 30-day review.");
      }
      await insertEvent(client, args.leadId, scout.operatorId, "request_withdrawn", {
        source: "manual_30_day_review",
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

export const completeFollowupTask = action({
  args: {
    taskId: v.string(),
    outcome: v.union(
      v.literal("sent"),
      v.literal("skipped"),
      v.literal("replied"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const database = getPool();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const taskResult = await client.query(
        `SELECT lead_id::STRING AS lead_id, step
           FROM lead_followup_tasks
          WHERE id = $1::UUID AND operator_id = $2 AND status = 'pending'
          FOR UPDATE`,
        [args.taskId, scout.operatorId],
      );
      const task = taskResult.rows[0];
      if (!task) throw new Error("This follow-up is no longer open.");
      if (args.outcome === "replied") {
        await client.query(
          `UPDATE lead_followup_tasks
              SET status = 'cancelled', completed_at = now(), updated_at = now()
            WHERE lead_id = $1::UUID AND operator_id = $2 AND status = 'pending'`,
          [task.lead_id, scout.operatorId],
        );
        await client.query(
          `UPDATE lead_assignments
              SET replied_at = coalesce(replied_at, now()), updated_at = now()
            WHERE lead_id = $1::UUID AND operator_id = $2`,
          [task.lead_id, scout.operatorId],
        );
        await insertEvent(client, task.lead_id, scout.operatorId, "lead_replied", {
          followupStep: Number(task.step),
        });
      } else {
        await client.query(
          `UPDATE lead_followup_tasks
              SET status = $3, completed_at = now(), updated_at = now()
            WHERE id = $1::UUID AND operator_id = $2`,
          [args.taskId, scout.operatorId, args.outcome],
        );
        await insertEvent(
          client,
          task.lead_id,
          scout.operatorId,
          args.outcome === "sent" ? "followup_sent" : "followup_skipped",
          { followupStep: Number(task.step) },
        );
      }
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

export const setLeadQualification = action({
  args: {
    leadId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("qualified"),
      v.literal("not_qualified"),
    ),
    hasRecentPost: v.union(v.boolean(), v.null()),
    note: optionalText,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const note = args.note?.trim().slice(0, 500) || null;
    const database = getPool();
    const current = await database.query(
      `SELECT l.current_title, l.company_size
         FROM lead_assignments AS a
         INNER JOIN leads AS l ON l.id = a.lead_id
        WHERE a.lead_id = $1::UUID AND a.operator_id = $2 AND a.status = 'assigned'`,
      [args.leadId, scout.operatorId],
    );
    if (!current.rows[0]) throw new Error("This lead is no longer waiting for review.");
    const score = scoreIcp(
      current.rows[0].current_title,
      current.rows[0].company_size,
    );
    await database.query(
      `UPDATE lead_assignments
          SET qualification_status = $3,
              qualification_note = $4,
              has_recent_post = $5,
              recent_post_checked_at = CASE
                WHEN $5::BOOL IS NULL THEN recent_post_checked_at
                ELSE now()
              END,
              icp_score = $6,
              updated_at = now()
        WHERE lead_id = $1::UUID AND operator_id = $2 AND status = 'assigned'`,
      [
        args.leadId,
        scout.operatorId,
        args.status,
        note,
        args.hasRecentPost,
        score.value,
      ],
    );
    await database.query(
      `INSERT INTO lead_assignment_events (lead_id, operator_id, event_type, details)
       VALUES ($1::UUID, $2, 'lead_checked', $3::JSONB)`,
      [
        args.leadId,
        scout.operatorId,
        JSON.stringify({
          status: args.status,
          hasRecentPost: args.hasRecentPost,
          icpScore: score.value,
          note,
        }),
      ],
    );
    return null;
  },
});

export const createEscalation = action({
  args: {
    leadId: v.union(v.string(), v.null()),
    subject: v.string(),
    message: v.string(),
  },
  returns: v.object({ id: v.string() }),
  handler: async (ctx, args): Promise<{ id: string }> => {
    const scout: ScoutIdentity = await ctx.runQuery(
      internal.scoutIdentity.requireScout,
      {},
    );
    const subject = args.subject.trim().slice(0, 120);
    const message = args.message.trim().slice(0, 2_000);
    if (!subject || !message) throw new Error("Add a short subject and message.");
    if (args.leadId) {
      const assigned = await getPool().query(
        `SELECT 1 FROM lead_assignments WHERE lead_id = $1::UUID AND operator_id = $2`,
        [args.leadId, scout.operatorId],
      );
      if (!assigned.rows[0]) throw new Error("This lead is not assigned to you.");
    }
    const result = await getPool().query(
      `INSERT INTO scout_escalations (operator_id, lead_id, subject, message)
       VALUES ($1, $2::UUID, $3, $4)
       RETURNING id::STRING AS id`,
      [scout.operatorId, args.leadId, subject, message],
    );
    return { id: String(result.rows[0].id) };
  },
});

export const updateSettings = action({
  args: {
    postEngagements: v.number(),
    linkedinPremium: v.boolean(),
    premiumVerified: v.boolean(),
    connectionDailyLimit: v.number(),
    onboardingCompleted: v.boolean(),
    includeNote: v.boolean(),
  },
  returns: settingsValidator,
  handler: async (ctx, args): Promise<ScoutSettings> => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const connectionMaximum = args.linkedinPremium ? 40 : 20;
    const engagementMaximum = args.linkedinPremium ? 250 : 150;
    if (args.linkedinPremium && !args.premiumVerified) {
      throw new Error(
        "LinkedIn Premium must be verified against the signed-in account before it can be selected.",
      );
    }
    const connectionDailyLimit = clampInteger(
      args.connectionDailyLimit,
      1,
      connectionMaximum,
    );
    const postMaximum = Math.min(
      10,
      Math.floor(engagementMaximum / connectionDailyLimit),
    );
    const settings: ScoutSettings = {
      postEngagements: clampInteger(args.postEngagements, 1, postMaximum),
      linkedinPremium: args.linkedinPremium,
      linkedinPremiumVerified:
        args.linkedinPremium && args.premiumVerified,
      connectionDailyLimit,
      engagementDailyLimit: engagementMaximum,
      onboardingCompleted: args.onboardingCompleted,
      includeNote: args.linkedinPremium && args.includeNote,
    };
    const database = getPool();
    await database.query(
      `UPSERT INTO operator_settings (
         operator_id,
         post_engagements,
         linkedin_premium,
         linkedin_premium_verified_at,
         connection_daily_limit,
         engagement_daily_limit,
         onboarding_completed,
         include_note,
         updated_at
       ) VALUES ($1, $2, $3, CASE WHEN $3 THEN now() ELSE NULL END, $4, $5, $6, $7, now())`,
      [
        scout.operatorId,
        settings.postEngagements,
        settings.linkedinPremium,
        settings.connectionDailyLimit,
        settings.engagementDailyLimit,
        settings.onboardingCompleted,
        settings.includeNote,
      ],
    );
    return settings;
  },
});

export const resetOnboarding = action({
  args: {},
  returns: settingsValidator,
  handler: async (ctx): Promise<ScoutSettings> => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const settings: ScoutSettings = {
      postEngagements: 3,
      linkedinPremium: false,
      linkedinPremiumVerified: false,
      connectionDailyLimit: 20,
      engagementDailyLimit: 150,
      onboardingCompleted: false,
      includeNote: false,
    };
    const database = getPool();
    await database.query(
      `UPSERT INTO operator_settings (
         operator_id,
         post_engagements,
         linkedin_premium,
         linkedin_premium_verified_at,
         connection_daily_limit,
         engagement_daily_limit,
         onboarding_completed,
         include_note,
         updated_at
       ) VALUES ($1, $2, false, NULL, $3, $4, false, false, now())`,
      [
        scout.operatorId,
        settings.postEngagements,
        settings.connectionDailyLimit,
        settings.engagementDailyLimit,
      ],
    );
    return settings;
  },
});

export const reportError = action({
  args: { leadId: v.union(v.string(), v.null()), message: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    const database = getPool();
    const message = args.message.trim().slice(0, 1000) || "Unknown extension error";
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
  args: { postText: v.string() },
  returns: v.object({ draft: v.string(), threadId: v.string(), model: v.string() }),
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
    return requestCodexGateway<{
      draft: string;
      threadId: string;
      model: string;
    }>("/v1/drafts", {
      method: "POST",
      timeoutMs: 125_000,
      body: {
        requestId: randomUUID(),
        scoutId: scout.userId,
        postText,
      },
    });
  },
});

const DAILY_TASKS = [
  {
    key: "01_leads",
    label: "Finish today’s lead list",
    help: "Work through the leads and limits shown above.",
  },
  {
    key: "02_veblen_post",
    label: "Support Veblen’s latest post",
    help: "Follow the page, then like and repost the latest company post.",
  },
  {
    key: "03_event",
    label: "Work on the next Veblen event",
    help: "Register for the event and send today’s planned invites.",
  },
  {
    key: "04_callum_post",
    label: "Support Callum’s latest post",
    help: "Like it and leave a useful comment.",
  },
  {
    key: "05_report",
    label: "Send today’s numbers",
    help: "Report new connections, saved emails, and anything blocking you.",
  },
] as const;

async function ensureDailyTasks(operatorId: string) {
  const database = getPool();
  await Promise.all(
    DAILY_TASKS.map((task) =>
      database.query(
        `INSERT INTO operator_daily_tasks (
           operator_id, task_date, task_key, label, help_text
         ) VALUES ($1, current_date, $2, $3, $4)
         ON CONFLICT (operator_id, task_date, task_key) DO NOTHING`,
        [operatorId, task.key, task.label, task.help],
      ),
    ),
  );
}

async function createFollowupTasks(
  client: PoolClient,
  leadId: string,
  operatorId: string,
  firstName: string | null,
) {
  const name = firstName?.trim() || "there";
  const messages = [
    `Hi ${name}, thanks for connecting. I help Callum with research at Veblen Director Programme. It’s great to connect.`,
    `Hi ${name}, I wanted to follow up. We speak with leaders who want to grow their board-level skills and network. Is that something you are working on this year?`,
    `Hi ${name}, Callum would be happy to share more about the Veblen Director Programme. Would you like me to introduce you?`,
  ];
  await client.query(
    `INSERT INTO lead_followup_tasks (
       lead_id, operator_id, step, due_at, message_text
     ) VALUES
       ($1::UUID, $2, 1, now(), $3),
       ($1::UUID, $2, 2, now() + INTERVAL '2 days', $4),
       ($1::UUID, $2, 3, now() + INTERVAL '3 days', $5)
     ON CONFLICT (lead_id, operator_id, step) DO NOTHING`,
    [leadId, operatorId, ...messages],
  );
}

function firstNameFrom(value: unknown) {
  const name = nullableString(value)?.trim();
  return name ? name.split(/\s+/)[0] : null;
}

function scoreIcp(titleValue: unknown, companySizeValue: unknown) {
  const title = String(titleValue ?? "").toLowerCase();
  const companySize = String(companySizeValue ?? "").toLowerCase();
  let value = 45;
  let reason = "Check the role before using this lead.";
  if (!title.trim()) {
    value = 30;
    reason = "The job title is missing.";
  } else if (
    /\b(founder|owner|chief|ceo|cfo|coo|cto|president|chair|managing director)\b/.test(
      title,
    )
  ) {
    value = 92;
    reason = "This looks like a senior decision-maker.";
  } else if (/\b(vice president|vp|director|head|partner)\b/.test(title)) {
    value = 84;
    reason = "This looks like a senior leader.";
  } else if (/\b(senior manager|general manager|manager|lead)\b/.test(title)) {
    value = 68;
    reason = "This may be a good mid-level leader.";
  }
  if (/\b(1|2)-10\b|self-employed/.test(companySize)) {
    value = Math.max(0, value - 6);
    reason += " The company may be very small.";
  }
  return { value: Math.min(100, value), reason };
}

async function getOrCreateSettings(operatorId: string): Promise<ScoutSettings> {
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
       linkedin_premium,
       linkedin_premium_verified_at IS NOT NULL AS linkedin_premium_verified,
       connection_daily_limit::FLOAT8 AS connection_daily_limit,
       engagement_daily_limit::FLOAT8 AS engagement_daily_limit,
       onboarding_completed,
       include_note
     FROM operator_settings
     WHERE operator_id = $1`,
    [operatorId],
  );
  const row = result.rows[0] ?? {};
  return {
    postEngagements: Number(row.post_engagements ?? 3),
    linkedinPremium: Boolean(row.linkedin_premium),
    linkedinPremiumVerified: Boolean(row.linkedin_premium_verified),
    connectionDailyLimit: Number(row.connection_daily_limit ?? 20),
    engagementDailyLimit: Number(row.engagement_daily_limit ?? 150),
    onboardingCompleted: Boolean(row.onboarding_completed),
    includeNote: Boolean(row.include_note),
  };
}

async function ensureDailyUsageRow(client: PoolClient, operatorId: string) {
  await client.query(
    `INSERT INTO operator_daily_usage (operator_id, usage_date)
     VALUES ($1, current_date)
     ON CONFLICT (operator_id, usage_date) DO NOTHING`,
    [operatorId],
  );
}

async function getOrCreateDailyUsage(
  operatorId: string,
  settings: ScoutSettings,
): Promise<DailyUsage> {
  const database = getPool();
  await database.query(
    `INSERT INTO operator_daily_usage (operator_id, usage_date)
     VALUES ($1, current_date)
     ON CONFLICT (operator_id, usage_date) DO NOTHING`,
    [operatorId],
  );
  const result = await database.query(
    `SELECT usage_date::STRING AS usage_date, requests_sent, likes_used
       FROM operator_daily_usage
      WHERE operator_id = $1 AND usage_date = current_date`,
    [operatorId],
  );
  return mapDailyUsage(result.rows[0] ?? {}, settings);
}

function mapDailyUsage(
  row: Record<string, unknown>,
  settings: ScoutSettings,
): DailyUsage {
  const requestsSent = Number(row.requests_sent ?? 0);
  const likesUsed = Number(row.likes_used ?? 0);
  const engagementLimit = configuredEngagementLimit(settings);
  return {
    date: String(row.usage_date ?? new Date().toISOString().slice(0, 10)),
    requestsSent,
    likesUsed,
    requestLimit: settings.connectionDailyLimit,
    engagementLimit,
    requestRemaining: Math.max(0, settings.connectionDailyLimit - requestsSent),
    engagementRemaining: Math.max(0, engagementLimit - likesUsed),
  };
}

function configuredEngagementLimit(settings: ScoutSettings) {
  return Math.min(
    settings.engagementDailyLimit,
    settings.connectionDailyLimit * settings.postEngagements,
  );
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

function mapLead(row: Record<string, unknown>): ScoutLead {
  return {
    id: String(row.id),
    fullName: nullableString(row.full_name),
    currentTitle: nullableString(row.current_title),
    companyName: nullableString(row.company_name),
    linkedinUrl: String(row.linkedin_url ?? ""),
    status: String(row.status ?? "assigned"),
  };
}

function mapReviewLead(row: Record<string, unknown>): ReviewLead {
  return {
    id: String(row.id),
    fullName: nullableString(row.full_name),
    profileUrl: normalizeLinkedInProfileUrl(row.profile_url),
    requestedAt: nullableString(row.requested_at),
  };
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function clampInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) throw new Error("Settings must be valid numbers.");
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function isValidEmail(value: string | null): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function isAllowedTransition(current: string, next: string) {
  if (next === "failed" || next === "skipped") {
    return ["assigned", "viewed", "engaged"].includes(current);
  }
  return current === "viewed" && next === "engaged";
}

function normalizeLinkedInProfileUrl(value: unknown) {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "https:" || !/(^|\.)linkedin\.com$/i.test(url.hostname)) {
    throw new Error("A valid HTTPS LinkedIn profile URL is required.");
  }
  const match = url.pathname.match(/^\/in\/([^/]+)/i);
  if (!match) throw new Error("The LinkedIn URL must use the /in/profile format.");
  return `https://www.linkedin.com/in/${match[1]}`;
}

function tryNormalizeLinkedInProfileUrl(value: unknown) {
  try {
    return normalizeLinkedInProfileUrl(value);
  } catch {
    return null;
  }
}

function normalizeLinkedInPostUrl(value: unknown) {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "https:" || !/(^|\.)linkedin\.com$/i.test(url.hostname)) {
    throw new Error("A valid HTTPS LinkedIn post URL is required.");
  }
  if (!/^\/(feed\/update\/|posts\/)/i.test(url.pathname)) {
    throw new Error("The post URL is not a supported LinkedIn post permalink.");
  }
  return `https://www.linkedin.com${url.pathname.replace(/\/+$/, "")}`;
}

function validateDateKey(value: string) {
  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Connected-on dates must use YYYY-MM-DD.");
  }
  return date;
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
