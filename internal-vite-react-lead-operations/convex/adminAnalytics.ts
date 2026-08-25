"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { getPool } from "./lib/cockroach";

const rangeValidator = v.union(
  v.literal("7d"),
  v.literal("30d"),
  v.literal("90d"),
  v.literal("all"),
);

const summaryValidator = v.object({
  totalScouts: v.number(),
  activeScouts: v.number(),
  scoutsWithActivity: v.number(),
  totalLeads: v.number(),
  assignedLeads: v.number(),
  availableLeads: v.number(),
  freshLeads: v.number(),
  viewedLeads: v.number(),
  engagedLeads: v.number(),
  requestsSent: v.number(),
  pendingRequests: v.number(),
  acceptedLeads: v.number(),
  emailsExtracted: v.number(),
  skippedLeads: v.number(),
  failedLeads: v.number(),
  acceptanceRate: v.number(),
  emailYield: v.number(),
});

const scoutMetricsValidator = v.object({
  username: v.string(),
  operatorId: v.string(),
  active: v.boolean(),
  hasAccount: v.boolean(),
  assigned: v.number(),
  fresh: v.number(),
  viewed: v.number(),
  engaged: v.number(),
  requests: v.number(),
  pending: v.number(),
  accepted: v.number(),
  emails: v.number(),
  skipped: v.number(),
  failed: v.number(),
  activityCount: v.number(),
  acceptanceRate: v.number(),
  emailYield: v.number(),
  lastActive: v.union(v.string(), v.null()),
});

const trendPointValidator = v.object({
  at: v.string(),
  engaged: v.number(),
  requests: v.number(),
  accepted: v.number(),
  emails: v.number(),
});

const activityValidator = v.object({
  id: v.string(),
  operatorId: v.string(),
  eventType: v.string(),
  leadName: v.union(v.string(), v.null()),
  detail: v.union(v.string(), v.null()),
  url: v.union(v.string(), v.null()),
  at: v.string(),
});

const postActivityValidator = v.object({
  id: v.string(),
  operatorId: v.string(),
  leadName: v.union(v.string(), v.null()),
  profileUrl: v.string(),
  postUrl: v.string(),
  commentText: v.string(),
  liked: v.boolean(),
  at: v.string(),
});

const weeklyKpiValidator = v.object({
  label: v.string(),
  value: v.number(),
});

const weeklyScoutValidator = v.object({
  rank: v.number(),
  username: v.string(),
  operatorId: v.string(),
  active: v.boolean(),
  workedLeads: v.number(),
  comments: v.number(),
  likes: v.number(),
  requests: v.number(),
  accepted: v.number(),
  trackedEmails: v.number(),
  additionalEmails: v.number(),
  totalEmails: v.number(),
  managerPoints: v.number(),
  extraKpis: v.array(weeklyKpiValidator),
  note: v.union(v.string(), v.null()),
  evidenceUrl: v.union(v.string(), v.null()),
  evidenceFileName: v.union(v.string(), v.null()),
  lastActive: v.union(v.string(), v.null()),
  score: v.number(),
});

const weeklyCommentValidator = v.object({
  id: v.string(),
  operatorId: v.string(),
  username: v.string(),
  leadName: v.union(v.string(), v.null()),
  commentText: v.string(),
  postUrl: v.string(),
  at: v.string(),
});

const scoutAssignedLeadValidator = v.object({
  id: v.string(),
  fullName: v.union(v.string(), v.null()),
  currentTitle: v.union(v.string(), v.null()),
  companyName: v.union(v.string(), v.null()),
  profileUrl: v.string(),
  status: v.string(),
  originalEmail: v.union(v.string(), v.null()),
  workEmail: v.union(v.string(), v.null()),
  assignedAt: v.string(),
  viewedAt: v.union(v.string(), v.null()),
  engagedAt: v.union(v.string(), v.null()),
  connectionRequestedAt: v.union(v.string(), v.null()),
  acceptedAt: v.union(v.string(), v.null()),
  emailCollectedAt: v.union(v.string(), v.null()),
});

const scoutAssignedLeadsValidator = v.object({
  generatedAt: v.string(),
  total: v.number(),
  page: v.number(),
  pageSize: v.number(),
  pageCount: v.number(),
  leads: v.array(scoutAssignedLeadValidator),
});

const operationsSummaryValidator = v.object({
  oldRequests: v.number(),
  followupsDue: v.number(),
  followupsPending: v.number(),
  checklistDone: v.number(),
  checklistTotal: v.number(),
  leadsToCheck: v.number(),
  openEscalations: v.number(),
  crmPending: v.number(),
  crmFailed: v.number(),
  crmSent: v.number(),
});

const escalationValidator = v.object({
  id: v.string(),
  operatorId: v.string(),
  leadName: v.union(v.string(), v.null()),
  subject: v.string(),
  message: v.string(),
  createdAt: v.string(),
});

const crmRowValidator = v.object({
  id: v.string(),
  operatorId: v.string(),
  leadName: v.union(v.string(), v.null()),
  email: v.string(),
  status: v.string(),
  attemptCount: v.number(),
  lastError: v.union(v.string(), v.null()),
  createdAt: v.string(),
});

const adminOldRequestValidator = v.object({
  operatorId: v.string(),
  leadName: v.union(v.string(), v.null()),
  profileUrl: v.string(),
  requestedAt: v.string(),
  ageDays: v.number(),
});

type Range = "7d" | "30d" | "90d" | "all";

type ScoutAccount = {
  username: string;
  operatorId: string;
  active: boolean;
};

type ScoutMetric = ReturnType<typeof emptyMetric> & {
  username: string;
  operatorId: string;
  active: boolean;
  hasAccount: boolean;
  activityCount: number;
  lastActive: string | null;
  acceptanceRate: number;
  emailYield: number;
};

type AnalyticsResult = {
  range: Range;
  rangeLabel: string;
  generatedAt: string;
  scoutsTruncated: boolean;
  summary: {
    totalScouts: number;
    activeScouts: number;
    scoutsWithActivity: number;
    totalLeads: number;
    assignedLeads: number;
    availableLeads: number;
    freshLeads: number;
    viewedLeads: number;
    engagedLeads: number;
    requestsSent: number;
    pendingRequests: number;
    acceptedLeads: number;
    emailsExtracted: number;
    skippedLeads: number;
    failedLeads: number;
    acceptanceRate: number;
    emailYield: number;
  };
  scouts: ScoutMetric[];
  trend: Array<{
    at: string;
    engaged: number;
    requests: number;
    accepted: number;
    emails: number;
  }>;
  recentActivity: Array<{
    id: string;
    operatorId: string;
    eventType: string;
    leadName: string | null;
    detail: string | null;
    url: string | null;
    at: string;
  }>;
  postActivities: Array<{
    id: string;
    operatorId: string;
    leadName: string | null;
    profileUrl: string;
    postUrl: string;
    commentText: string;
    liked: boolean;
    at: string;
  }>;
};

type MetricRow = {
  operator_id: unknown;
  assigned: unknown;
  fresh: unknown;
  viewed: unknown;
  engaged: unknown;
  requests: unknown;
  pending: unknown;
  accepted: unknown;
  emails: unknown;
  skipped: unknown;
  failed: unknown;
};

type EventRow = {
  operator_id: unknown;
  activity_count: unknown;
  last_active: unknown;
};

type WeeklyReview = {
  operatorId: string;
  additionalEmails: number;
  managerPoints: number;
  extraKpis: Array<{ label: string; value: number }>;
  note: string | null;
  evidenceUrl: string | null;
  evidenceFileName: string | null;
  updatedBy: string;
  updatedAt: number;
};

export const getOverview = action({
  args: { range: rangeValidator },
  returns: v.object({
    range: rangeValidator,
    rangeLabel: v.string(),
    generatedAt: v.string(),
    scoutsTruncated: v.boolean(),
    summary: summaryValidator,
    scouts: v.array(scoutMetricsValidator),
    trend: v.array(trendPointValidator),
    recentActivity: v.array(activityValidator),
    postActivities: v.array(postActivityValidator),
  }),
  handler: async (ctx, args): Promise<AnalyticsResult> => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const scoutAccounts: { scouts: ScoutAccount[]; truncated: boolean } = await ctx.runQuery(
      internal.adminIdentity.listScouts,
      {},
    );
    const since = rangeStart(args.range);
    const bucket = args.range === "all" ? "month" : "day";
    const database = getPool();
    const [
      inventoryResult,
      metricResult,
      eventResult,
      trendResult,
      recentResult,
      postResult,
    ] =
      await Promise.all([
        database.query(
          `SELECT total_count::FLOAT8 AS total
             FROM lead_stats
            WHERE key = 'all'`,
        ),
        database.query(
          `SELECT
             operator_id,
             count(*)::FLOAT8 AS assigned,
             count(*) FILTER (
               WHERE status = 'assigned'
                 AND viewed_at IS NULL
                 AND engaged_at IS NULL
                 AND connection_requested_at IS NULL
                 AND accepted_at IS NULL
                 AND email_collected_at IS NULL
                 AND email IS NULL
             )::FLOAT8 AS fresh,
             count(*) FILTER (
               WHERE (
                 viewed_at IS NOT NULL
                 OR status IN ('viewed', 'engaged', 'connected', 'connection_requested', 'accepted', 'email_collected')
               )
                 AND (
                   $1::TIMESTAMPTZ IS NULL
                   OR viewed_at >= $1::TIMESTAMPTZ
                   OR (viewed_at IS NULL AND assigned_at >= $1::TIMESTAMPTZ)
                 )
             )::FLOAT8 AS viewed,
             count(*) FILTER (
               WHERE (
                 engaged_at IS NOT NULL
                 OR connection_requested_at IS NOT NULL
                 OR accepted_at IS NOT NULL
                 OR email_collected_at IS NOT NULL
                 OR email IS NOT NULL
                 OR status IN ('engaged', 'connected', 'connection_requested', 'accepted', 'email_collected')
               )
                 AND (
                   $1::TIMESTAMPTZ IS NULL
                   OR engaged_at >= $1::TIMESTAMPTZ
                   OR connection_requested_at >= $1::TIMESTAMPTZ
                   OR accepted_at >= $1::TIMESTAMPTZ
                   OR email_collected_at >= $1::TIMESTAMPTZ
                   OR (engaged_at IS NULL AND connection_requested_at IS NULL AND accepted_at IS NULL AND email_collected_at IS NULL AND assigned_at >= $1::TIMESTAMPTZ)
                 )
             )::FLOAT8 AS engaged,
             count(*) FILTER (
               WHERE (
                 connection_requested_at IS NOT NULL
                 OR accepted_at IS NOT NULL
                 OR email_collected_at IS NOT NULL
                 OR email IS NOT NULL
                 OR status IN ('connection_requested', 'accepted', 'email_collected')
               )
                 AND (
                   $1::TIMESTAMPTZ IS NULL
                   OR connection_requested_at >= $1::TIMESTAMPTZ
                   OR accepted_at >= $1::TIMESTAMPTZ
                   OR email_collected_at >= $1::TIMESTAMPTZ
                   OR (connection_requested_at IS NULL AND accepted_at IS NULL AND email_collected_at IS NULL AND assigned_at >= $1::TIMESTAMPTZ)
                 )
             )::FLOAT8 AS requests,
             count(*) FILTER (
               WHERE status = 'connection_requested'
                 AND accepted_at IS NULL
                 AND email_collected_at IS NULL
                 AND email IS NULL
             )::FLOAT8 AS pending,
             count(*) FILTER (
               WHERE (
                 accepted_at IS NOT NULL
                 OR email_collected_at IS NOT NULL
                 OR email IS NOT NULL
                 OR status IN ('accepted', 'email_collected')
               )
                 AND (
                   $1::TIMESTAMPTZ IS NULL
                   OR accepted_at >= $1::TIMESTAMPTZ
                   OR email_collected_at >= $1::TIMESTAMPTZ
                   OR (accepted_at IS NULL AND email_collected_at IS NULL AND assigned_at >= $1::TIMESTAMPTZ)
                 )
             )::FLOAT8 AS accepted,
             count(*) FILTER (
               WHERE (email_collected_at IS NOT NULL OR email IS NOT NULL)
                 AND (
                   $1::TIMESTAMPTZ IS NULL
                   OR email_collected_at >= $1::TIMESTAMPTZ
                   OR (email_collected_at IS NULL AND assigned_at >= $1::TIMESTAMPTZ)
                 )
             )::FLOAT8 AS emails,
             count(*) FILTER (
               WHERE status = 'skipped'
                 AND ($1::TIMESTAMPTZ IS NULL OR updated_at >= $1::TIMESTAMPTZ)
             )::FLOAT8 AS skipped,
             count(*) FILTER (
               WHERE status = 'failed'
                 AND ($1::TIMESTAMPTZ IS NULL OR updated_at >= $1::TIMESTAMPTZ)
             )::FLOAT8 AS failed
           FROM lead_assignments
           GROUP BY operator_id`,
          [since],
        ),
        database.query(
          `SELECT
             operator_id,
             count(*) FILTER (
               WHERE $1::TIMESTAMPTZ IS NULL OR created_at >= $1::TIMESTAMPTZ
             )::FLOAT8 AS activity_count,
             max(created_at)::STRING AS last_active
           FROM lead_assignment_events
           GROUP BY operator_id`,
          [since],
        ),
        database.query(
          `SELECT * FROM (
             SELECT
               date_trunc('${bucket}', created_at)::STRING AS at,
               count(*) FILTER (WHERE event_type = 'engaged')::FLOAT8 AS engaged,
               count(*) FILTER (WHERE event_type = 'connection_requested')::FLOAT8 AS requests,
               count(*) FILTER (WHERE event_type = 'accepted')::FLOAT8 AS accepted,
               count(*) FILTER (WHERE event_type = 'email_collected')::FLOAT8 AS emails
             FROM lead_assignment_events
             WHERE ($1::TIMESTAMPTZ IS NULL OR created_at >= $1::TIMESTAMPTZ)
               AND event_type IN (
                 'engaged', 'connection_requested', 'accepted', 'email_collected'
               )
             GROUP BY date_trunc('${bucket}', created_at)
             ORDER BY date_trunc('${bucket}', created_at) DESC
             LIMIT $2
           ) AS latest
           ORDER BY at ASC`,
          [since, args.range === "all" ? 24 : 90],
        ),
        database.query(
          `SELECT
             e.id::STRING AS id,
             e.operator_id,
             e.event_type,
             l.full_name,
             coalesce(e.details->>'comment', e.details->>'message', e.details->>'error') AS detail,
             coalesce(e.details->>'postUrl', e.details->>'profileUrl') AS url,
             e.created_at::STRING AS at
           FROM lead_assignment_events AS e
           INNER JOIN leads AS l ON l.id = e.lead_id
           WHERE ($1::TIMESTAMPTZ IS NULL OR e.created_at >= $1::TIMESTAMPTZ)
           ORDER BY e.created_at DESC
           LIMIT 80`,
          [since],
        ),
        database.query(
          `SELECT
             p.id::STRING AS id,
             p.operator_id,
             l.full_name,
             p.profile_url,
             p.post_url,
             p.comment_text,
             p.liked,
             p.commented_at::STRING AS at
           FROM lead_post_activities AS p
           INNER JOIN leads AS l ON l.id = p.lead_id
           WHERE ($1::TIMESTAMPTZ IS NULL OR p.commented_at >= $1::TIMESTAMPTZ)
           ORDER BY p.commented_at DESC
           LIMIT 200`,
          [since],
        ),
      ]);

    const metricByOperator = new Map<string, ReturnType<typeof mapMetric>>();
    for (const row of metricResult.rows as MetricRow[]) {
      metricByOperator.set(String(row.operator_id), mapMetric(row));
    }
    const eventsByOperator = new Map<
      string,
      { activityCount: number; lastActive: string | null }
    >();
    for (const row of eventResult.rows as EventRow[]) {
      eventsByOperator.set(String(row.operator_id), {
        activityCount: toNumber(row.activity_count),
        lastActive: nullableString(row.last_active),
      });
    }

    const accountByOperator = new Map<string, ScoutAccount>(
      scoutAccounts.scouts.map((scout) => [scout.operatorId, scout]),
    );
    const operatorIds = new Set<string>([
      ...accountByOperator.keys(),
      ...metricByOperator.keys(),
    ]);
    const scouts: ScoutMetric[] = [...operatorIds].map((operatorId) => {
      const account = accountByOperator.get(operatorId);
      const metric = metricByOperator.get(operatorId) ?? emptyMetric();
      const events = eventsByOperator.get(operatorId) ?? {
        activityCount: 0,
        lastActive: null,
      };
      return {
        username: account?.username ?? operatorId,
        operatorId,
        active: account?.active ?? false,
        hasAccount: Boolean(account),
        ...metric,
        ...events,
        acceptanceRate: rate(metric.accepted, metric.requests),
        emailYield: rate(metric.emails, metric.accepted),
      };
    });
    scouts.sort((left, right) =>
      right.activityCount - left.activityCount ||
      left.username.localeCompare(right.username),
    );

    const totals = scouts.reduce(
      (result, scout) => ({
        assigned: result.assigned + scout.assigned,
        fresh: result.fresh + scout.fresh,
        viewed: result.viewed + scout.viewed,
        engaged: result.engaged + scout.engaged,
        requests: result.requests + scout.requests,
        pending: result.pending + scout.pending,
        accepted: result.accepted + scout.accepted,
        emails: result.emails + scout.emails,
        skipped: result.skipped + scout.skipped,
        failed: result.failed + scout.failed,
      }),
      emptyMetric(),
    );
    const totalLeads = toNumber(inventoryResult.rows[0]?.total);

    return {
      range: args.range,
      rangeLabel: labelForRange(args.range),
      generatedAt: new Date().toISOString(),
      scoutsTruncated: scoutAccounts.truncated,
      summary: {
        totalScouts: scoutAccounts.scouts.length,
        activeScouts: scoutAccounts.scouts.filter((scout) => scout.active).length,
        scoutsWithActivity: scouts.filter((scout) => scout.activityCount > 0).length,
        totalLeads,
        assignedLeads: totals.assigned,
        availableLeads: Math.max(0, totalLeads - totals.assigned),
        freshLeads: totals.fresh,
        viewedLeads: totals.viewed,
        engagedLeads: totals.engaged,
        requestsSent: totals.requests,
        pendingRequests: totals.pending,
        acceptedLeads: totals.accepted,
        emailsExtracted: totals.emails,
        skippedLeads: totals.skipped,
        failedLeads: totals.failed,
        acceptanceRate: rate(totals.accepted, totals.requests),
        emailYield: rate(totals.emails, totals.accepted),
      },
      scouts,
      trend: trendResult.rows.map((row) => ({
        at: String(row.at),
        engaged: toNumber(row.engaged),
        requests: toNumber(row.requests),
        accepted: toNumber(row.accepted),
        emails: toNumber(row.emails),
      })),
      recentActivity: recentResult.rows.map((row) => ({
        id: String(row.id),
        operatorId: String(row.operator_id),
        eventType: String(row.event_type),
        leadName: nullableString(row.full_name),
        detail: nullableString(row.detail),
        url: nullableString(row.url),
        at: String(row.at),
      })),
      postActivities: postResult.rows.map((row) => ({
        id: String(row.id),
        operatorId: String(row.operator_id),
        leadName: nullableString(row.full_name),
        profileUrl: String(row.profile_url),
        postUrl: String(row.post_url),
        commentText: String(row.comment_text),
        liked: Boolean(row.liked),
        at: String(row.at),
      })),
    };
  },
});

export const getWeeklyPerformance = action({
  args: { weekStart: v.string() },
  returns: v.object({
    weekStart: v.string(),
    weekEnd: v.string(),
    weekLabel: v.string(),
    generatedAt: v.string(),
    scoreFormula: v.string(),
    scouts: v.array(weeklyScoutValidator),
    comments: v.array(weeklyCommentValidator),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const scoutAccounts: { scouts: ScoutAccount[]; truncated: boolean } = await ctx.runQuery(
      internal.adminIdentity.listScouts,
      {},
    );
    const weekStart = normalizeWeekStart(args.weekStart);
    const weekEndDate = new Date(`${weekStart}T00:00:00.000Z`);
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);
    const weekEnd = weekEndDate.toISOString().slice(0, 10);
    const weekStartAt = `${weekStart}T00:00:00+04:00`;
    const weekEndAt = `${weekEnd}T00:00:00+04:00`;
    const reviews: WeeklyReview[] = await ctx.runQuery(
      internal.weeklyPerformance.listForWeek,
      { weekStart },
    );
    const database = getPool();
    const [leadResult, postResult, commentResult, activityResult] = await Promise.all([
      database.query(
        `SELECT
           operator_id,
           count(*) FILTER (
             WHERE viewed_at >= $1::TIMESTAMPTZ AND viewed_at < $2::TIMESTAMPTZ
                OR engaged_at >= $1::TIMESTAMPTZ AND engaged_at < $2::TIMESTAMPTZ
                OR connection_requested_at >= $1::TIMESTAMPTZ AND connection_requested_at < $2::TIMESTAMPTZ
                OR accepted_at >= $1::TIMESTAMPTZ AND accepted_at < $2::TIMESTAMPTZ
                OR email_collected_at >= $1::TIMESTAMPTZ AND email_collected_at < $2::TIMESTAMPTZ
           )::FLOAT8 AS worked_leads,
           count(*) FILTER (
             WHERE connection_requested_at >= $1::TIMESTAMPTZ
               AND connection_requested_at < $2::TIMESTAMPTZ
           )::FLOAT8 AS requests,
           count(*) FILTER (
             WHERE accepted_at >= $1::TIMESTAMPTZ
               AND accepted_at < $2::TIMESTAMPTZ
           )::FLOAT8 AS accepted,
           count(*) FILTER (
             WHERE email_collected_at >= $1::TIMESTAMPTZ
               AND email_collected_at < $2::TIMESTAMPTZ
           )::FLOAT8 AS emails
         FROM lead_assignments
         GROUP BY operator_id`,
        [weekStartAt, weekEndAt],
      ),
      database.query(
        `SELECT
           operator_id,
           count(*) FILTER (
             WHERE commented_at >= $1::TIMESTAMPTZ AND commented_at < $2::TIMESTAMPTZ
           )::FLOAT8 AS comments,
           count(*) FILTER (
             WHERE liked AND liked_at >= $1::TIMESTAMPTZ AND liked_at < $2::TIMESTAMPTZ
           )::FLOAT8 AS likes
         FROM lead_post_activities
         GROUP BY operator_id`,
        [weekStartAt, weekEndAt],
      ),
      database.query(
        `SELECT
           p.id::STRING AS id,
           p.operator_id,
           l.full_name,
           p.comment_text,
           p.post_url,
           p.commented_at::STRING AS at
         FROM lead_post_activities AS p
         INNER JOIN leads AS l ON l.id = p.lead_id
         WHERE p.commented_at >= $1::TIMESTAMPTZ
           AND p.commented_at < $2::TIMESTAMPTZ
         ORDER BY p.commented_at DESC
         LIMIT 500`,
        [weekStartAt, weekEndAt],
      ),
      database.query(
        `SELECT operator_id, max(created_at)::STRING AS last_active
         FROM lead_assignment_events
         WHERE created_at >= $1::TIMESTAMPTZ AND created_at < $2::TIMESTAMPTZ
         GROUP BY operator_id`,
        [weekStartAt, weekEndAt],
      ),
    ]);
    const leadByOperator = new Map(leadResult.rows.map((row) => [String(row.operator_id), row]));
    const postByOperator = new Map(postResult.rows.map((row) => [String(row.operator_id), row]));
    const activityByOperator = new Map(activityResult.rows.map((row) => [String(row.operator_id), row]));
    const reviewByOperator = new Map(reviews.map((review) => [review.operatorId, review]));
    const usernameByOperator = new Map(
      scoutAccounts.scouts.map((scout) => [scout.operatorId, scout.username]),
    );
    const scouts = scoutAccounts.scouts.map((scout) => {
      const lead = leadByOperator.get(scout.operatorId) ?? {};
      const post = postByOperator.get(scout.operatorId) ?? {};
      const activity = activityByOperator.get(scout.operatorId) ?? {};
      const review = reviewByOperator.get(scout.operatorId);
      const comments = toNumber(post.comments);
      const likes = toNumber(post.likes);
      const requests = toNumber(lead.requests);
      const accepted = toNumber(lead.accepted);
      const trackedEmails = toNumber(lead.emails);
      const additionalEmails = review?.additionalEmails ?? 0;
      const totalEmails = trackedEmails + additionalEmails;
      const managerPoints = review?.managerPoints ?? 0;
      const extraKpiPoints = (review?.extraKpis ?? []).reduce((total, item) => total + item.value, 0);
      return {
        rank: 0,
        username: scout.username,
        operatorId: scout.operatorId,
        active: scout.active,
        workedLeads: toNumber(lead.worked_leads),
        comments,
        likes,
        requests,
        accepted,
        trackedEmails,
        additionalEmails,
        totalEmails,
        managerPoints,
        extraKpis: review?.extraKpis ?? [],
        note: review?.note ?? null,
        evidenceUrl: review?.evidenceUrl ?? null,
        evidenceFileName: review?.evidenceFileName ?? null,
        lastActive: nullableString(activity.last_active),
        score: Math.max(0, comments + likes + requests * 2 + accepted * 4 + totalEmails * 5 + extraKpiPoints + managerPoints),
      };
    });
    scouts.sort((left, right) =>
      right.score - left.score
      || right.totalEmails - left.totalEmails
      || right.accepted - left.accepted
      || right.comments - left.comments
      || left.username.localeCompare(right.username),
    );
    scouts.forEach((scout, index) => {
      scout.rank = index + 1;
    });
    return {
      weekStart,
      weekEnd,
      weekLabel: weekLabel(weekStart, weekEnd),
      generatedAt: new Date().toISOString(),
      scoreFormula: "1 point per comment, like, or other KPI result; 2 per request; 4 per acceptance; 5 per email; plus manager points",
      scouts,
      comments: commentResult.rows.map((row) => ({
        id: String(row.id),
        operatorId: String(row.operator_id),
        username: usernameByOperator.get(String(row.operator_id)) ?? String(row.operator_id),
        leadName: nullableString(row.full_name),
        commentText: String(row.comment_text),
        postUrl: String(row.post_url),
        at: String(row.at),
      })),
    };
  },
});

export const getScoutAssignedLeads = action({
  args: {
    operatorId: v.string(),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  returns: scoutAssignedLeadsValidator,
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const operatorId = args.operatorId.trim();
    if (!operatorId) throw new Error("A scout is required.");
    const pageSize = Math.min(50, Math.max(10, Math.floor(args.pageSize ?? 25)));
    const requestedPage = Math.max(1, Math.floor(args.page ?? 1));
    const database = getPool();
    const countResult = await database.query(
      `SELECT count(*)::FLOAT8 AS total
         FROM lead_assignments
        WHERE operator_id = $1`,
      [operatorId],
    );
    const total = toNumber(countResult.rows[0]?.total);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const result = await database.query(
      `SELECT
         l.id::STRING AS id,
         l.full_name,
         l.current_title,
         l.company_name,
         coalesce(a.resolved_linkedin_url, l.linkedin_url) AS profile_url,
         CASE
           WHEN coalesce(l.original_email, a.email) IS NOT NULL OR a.email_collected_at IS NOT NULL
             THEN 'email_collected'
           WHEN a.accepted_at IS NOT NULL OR a.status IN ('accepted', 'email_collected')
             THEN 'accepted'
           WHEN a.connection_requested_at IS NOT NULL OR a.status IN ('connected', 'connection_requested')
             THEN 'connection_requested'
           WHEN a.engaged_at IS NOT NULL OR a.status = 'engaged' THEN 'engaged'
           WHEN a.viewed_at IS NOT NULL OR a.status = 'viewed' THEN 'viewed'
           ELSE a.status
         END AS status,
         coalesce(l.original_email, a.email) AS original_email,
         l.work_email,
         a.assigned_at::STRING AS assigned_at,
         a.viewed_at::STRING AS viewed_at,
         a.engaged_at::STRING AS engaged_at,
         a.connection_requested_at::STRING AS connection_requested_at,
         a.accepted_at::STRING AS accepted_at,
         a.email_collected_at::STRING AS email_collected_at
       FROM lead_assignments AS a
       INNER JOIN leads AS l ON l.id = a.lead_id
      WHERE a.operator_id = $1
      ORDER BY a.assigned_at DESC, a.lead_id
      LIMIT $2 OFFSET $3`,
      [operatorId, pageSize, (page - 1) * pageSize],
    );
    return {
      generatedAt: new Date().toISOString(),
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
        status: String(row.status ?? "assigned"),
        originalEmail: nullableString(row.original_email),
        workEmail: nullableString(row.work_email),
        assignedAt: String(row.assigned_at),
        viewedAt: nullableString(row.viewed_at),
        engagedAt: nullableString(row.engaged_at),
        connectionRequestedAt: nullableString(row.connection_requested_at),
        acceptedAt: nullableString(row.accepted_at),
        emailCollectedAt: nullableString(row.email_collected_at),
      })),
    };
  },
});

export const getOperations = action({
  args: {},
  returns: v.object({
    generatedAt: v.string(),
    summary: operationsSummaryValidator,
    escalations: v.array(escalationValidator),
    crmRows: v.array(crmRowValidator),
    oldRequests: v.array(adminOldRequestValidator),
  }),
  handler: async (ctx) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const database = getPool();
    const [
      leadSummary,
      followupSummary,
      checklistSummary,
      escalationSummary,
      crmSummary,
      escalations,
      crmRows,
      oldRequests,
    ] = await Promise.all([
      database.query(
        `SELECT
           count(*) FILTER (
             WHERE status = 'connection_requested'
               AND connection_requested_at <= now() - INTERVAL '30 days'
           )::FLOAT8 AS old_requests,
           count(*) FILTER (
             WHERE status = 'assigned' AND qualification_status = 'pending'
           )::FLOAT8 AS leads_to_check
         FROM lead_assignments`,
      ),
      database.query(
        `SELECT
           count(*) FILTER (
             WHERE status = 'pending' AND due_at <= now()
           )::FLOAT8 AS due,
           count(*) FILTER (WHERE status = 'pending')::FLOAT8 AS pending
         FROM lead_followup_tasks`,
      ),
      database.query(
        `SELECT
           count(*) FILTER (WHERE completed)::FLOAT8 AS done,
           count(*)::FLOAT8 AS total
         FROM operator_daily_tasks
         WHERE task_date = current_date`,
      ),
      database.query(
        `SELECT count(*)::FLOAT8 AS count
         FROM scout_escalations
         WHERE status = 'open'`,
      ),
      database.query(
        `SELECT
           count(*) FILTER (WHERE status = 'pending')::FLOAT8 AS pending,
           count(*) FILTER (WHERE status = 'failed')::FLOAT8 AS failed,
           count(*) FILTER (WHERE status = 'sent')::FLOAT8 AS sent
         FROM crm_delivery_outbox`,
      ),
      database.query(
        `SELECT
           e.id::STRING AS id,
           e.operator_id,
           l.full_name,
           e.subject,
           e.message,
           e.created_at::STRING AS created_at
         FROM scout_escalations AS e
         LEFT JOIN leads AS l ON l.id = e.lead_id
         WHERE e.status = 'open'
         ORDER BY e.created_at DESC
         LIMIT 100`,
      ),
      database.query(
        `SELECT
           o.id::STRING AS id,
           o.operator_id,
           l.full_name,
           l.original_email AS email,
           o.status,
           o.attempt_count::FLOAT8 AS attempt_count,
           o.last_error,
           o.created_at::STRING AS created_at
         FROM crm_delivery_outbox AS o
         INNER JOIN leads AS l ON l.id = o.lead_id
         INNER JOIN lead_assignments AS a
           ON a.lead_id = o.lead_id AND a.operator_id = o.operator_id
         WHERE o.status IN ('pending', 'failed') AND l.original_email IS NOT NULL
         ORDER BY CASE WHEN o.status = 'failed' THEN 0 ELSE 1 END, o.created_at
         LIMIT 100`,
      ),
      database.query(
        `SELECT
           a.operator_id,
           l.full_name,
           coalesce(a.resolved_linkedin_url, l.linkedin_url) AS profile_url,
           a.connection_requested_at::STRING AS requested_at,
           (current_date - a.connection_requested_at::DATE)::FLOAT8 AS age_days
         FROM lead_assignments AS a
         INNER JOIN leads AS l ON l.id = a.lead_id
         WHERE a.status = 'connection_requested'
           AND a.connection_requested_at <= now() - INTERVAL '30 days'
         ORDER BY a.connection_requested_at, a.lead_id
         LIMIT 100`,
      ),
    ]);
    const leadRow = leadSummary.rows[0] ?? {};
    const followupRow = followupSummary.rows[0] ?? {};
    const checklistRow = checklistSummary.rows[0] ?? {};
    const crmRow = crmSummary.rows[0] ?? {};
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        oldRequests: toNumber(leadRow.old_requests),
        followupsDue: toNumber(followupRow.due),
        followupsPending: toNumber(followupRow.pending),
        checklistDone: toNumber(checklistRow.done),
        checklistTotal: toNumber(checklistRow.total),
        leadsToCheck: toNumber(leadRow.leads_to_check),
        openEscalations: toNumber(escalationSummary.rows[0]?.count),
        crmPending: toNumber(crmRow.pending),
        crmFailed: toNumber(crmRow.failed),
        crmSent: toNumber(crmRow.sent),
      },
      escalations: escalations.rows.map((row) => ({
        id: String(row.id),
        operatorId: String(row.operator_id),
        leadName: nullableString(row.full_name),
        subject: String(row.subject),
        message: String(row.message),
        createdAt: String(row.created_at),
      })),
      crmRows: crmRows.rows.map((row) => ({
        id: String(row.id),
        operatorId: String(row.operator_id),
        leadName: nullableString(row.full_name),
        email: String(row.email),
        status: String(row.status),
        attemptCount: toNumber(row.attempt_count),
        lastError: nullableString(row.last_error),
        createdAt: String(row.created_at),
      })),
      oldRequests: oldRequests.rows.map((row) => ({
        operatorId: String(row.operator_id),
        leadName: nullableString(row.full_name),
        profileUrl: String(row.profile_url),
        requestedAt: String(row.requested_at),
        ageDays: toNumber(row.age_days),
      })),
    };
  },
});

export const exportCleanCsv = action({
  args: {},
  returns: v.object({
    fileName: v.string(),
    csv: v.string(),
    rowCount: v.number(),
    invalidEmailsRemoved: v.number(),
  }),
  handler: async (ctx) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const result = await getPool().query(
      `SELECT
         l.linkedin_url,
         l.first_name,
         l.last_name,
         l.full_name,
         l.current_title,
         l.company_name,
         l.original_email,
         l.original_email_collected_at::STRING AS original_email_collected_at,
         l.work_email,
         l.work_email_collected_at::STRING AS work_email_collected_at,
         a.operator_id,
         a.status,
         a.accepted_at::STRING AS accepted_at
       FROM leads AS l
       LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
       WHERE l.work_email IS NOT NULL
          OR a.accepted_at IS NOT NULL
          OR a.status IN ('accepted', 'email_collected')
       ORDER BY coalesce(l.work_email_collected_at, a.accepted_at) DESC, l.id
       LIMIT 10000`,
    );
    let invalidEmailsRemoved = 0;
    const rows = result.rows.map((row) => {
      const originalEmailValue = String(row.original_email ?? "").trim().toLowerCase();
      const workEmailValue = String(row.work_email ?? "").trim().toLowerCase();
      const originalEmail = isCleanEmail(originalEmailValue) ? originalEmailValue : "";
      const workEmail = isCleanEmail(workEmailValue) ? workEmailValue : "";
      if (originalEmailValue && !originalEmail) invalidEmailsRemoved += 1;
      if (workEmailValue && !workEmail) invalidEmailsRemoved += 1;
      const names = cleanNames(row.first_name, row.last_name, row.full_name);
      return [
        String(row.linkedin_url ?? ""),
        names.firstName,
        names.lastName,
        String(row.current_title ?? ""),
        originalEmail,
        String(row.original_email_collected_at ?? "").slice(0, 10),
        workEmail,
        String(row.work_email_collected_at ?? "").slice(0, 10),
        String(row.company_name ?? ""),
        String(row.operator_id ?? ""),
        String(row.status ?? ""),
        String(row.accepted_at ?? "").slice(0, 10),
      ];
    });
    const header = [
      "LinkedIn URL",
      "First Name",
      "Last Name",
      "Headline",
      "Original Email",
      "Original Email Collected Date",
      "Work Email",
      "Work Email Collected Date",
      "Company",
      "Scout",
      "Status",
      "Accepted Date",
    ];
    return {
      fileName: `clean-leads-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: [header, ...rows].map(csvLine).join("\r\n"),
      rowCount: rows.length,
      invalidEmailsRemoved,
    };
  },
});

export const resolveEscalation = action({
  args: { escalationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const result = await getPool().query(
      `UPDATE scout_escalations
          SET status = 'resolved',
              resolved_at = now(),
              resolved_by = $2,
              updated_at = now()
        WHERE id = $1::UUID AND status = 'open'
        RETURNING id`,
      [args.escalationId, admin.username],
    );
    if (!result.rows[0]) throw new Error("This question is already closed.");
    return null;
  },
});

export const retryCrmDelivery = action({
  args: { outboxId: v.union(v.string(), v.null()) },
  returns: v.object({ attempted: v.number(), sent: v.number(), failed: v.number() }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const webhookUrl = crmWebhookUrl();
    const database = getPool();
    const result = await database.query(
      `SELECT
         o.id::STRING AS id,
         o.lead_id::STRING AS lead_id,
         o.operator_id,
         l.first_name,
         l.last_name,
         l.full_name,
         l.current_title,
         l.company_name,
         coalesce(a.resolved_linkedin_url, l.linkedin_url) AS linkedin_url,
         l.original_email,
         l.work_email,
         a.accepted_at::STRING AS accepted_at
       FROM crm_delivery_outbox AS o
       INNER JOIN leads AS l ON l.id = o.lead_id
       INNER JOIN lead_assignments AS a
         ON a.lead_id = o.lead_id AND a.operator_id = o.operator_id
       WHERE o.status IN ('pending', 'failed')
         AND ($1::UUID IS NULL OR o.id = $1::UUID)
       ORDER BY o.created_at, o.id
       LIMIT 25`,
      [args.outboxId],
    );
    let sent = 0;
    let failed = 0;
    for (const row of result.rows) {
      await database.query(
        `UPDATE crm_delivery_outbox
            SET attempt_count = attempt_count + 1,
                last_attempt_at = now(),
                updated_at = now()
          WHERE id = $1::UUID`,
        [row.id],
      );
      try {
        const originalEmail = String(row.original_email ?? "").trim().toLowerCase();
        const workEmailValue = String(row.work_email ?? "").trim().toLowerCase();
        const workEmail = isCleanEmail(workEmailValue) ? workEmailValue : null;
        if (!isCleanEmail(originalEmail)) throw new Error("The saved original email is not valid.");
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: crmWebhookHeaders(),
          body: JSON.stringify({
            id: String(row.lead_id),
            firstName: nullableString(row.first_name),
            lastName: nullableString(row.last_name),
            fullName: nullableString(row.full_name),
            title: nullableString(row.current_title),
            company: nullableString(row.company_name),
            linkedinUrl: String(row.linkedin_url),
            email: originalEmail,
            originalEmail,
            workEmail,
            scout: String(row.operator_id),
            acceptedAt: nullableString(row.accepted_at),
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          const detail = (await response.text()).trim().slice(0, 300);
          throw new Error(`CRM returned ${response.status}${detail ? `: ${detail}` : ""}`);
        }
        await database.query(
          `UPDATE crm_delivery_outbox
              SET status = 'sent', sent_at = now(), last_error = NULL, updated_at = now()
            WHERE id = $1::UUID`,
          [row.id],
        );
        sent += 1;
      } catch (error) {
        await database.query(
          `UPDATE crm_delivery_outbox
              SET status = 'failed', last_error = $2, updated_at = now()
            WHERE id = $1::UUID`,
          [row.id, String(error instanceof Error ? error.message : error).slice(0, 1000)],
        );
        failed += 1;
      }
    }
    return { attempted: result.rows.length, sent, failed };
  },
});

function mapMetric(row: MetricRow) {
  return {
    assigned: toNumber(row.assigned),
    fresh: toNumber(row.fresh),
    viewed: toNumber(row.viewed),
    engaged: toNumber(row.engaged),
    requests: toNumber(row.requests),
    pending: toNumber(row.pending),
    accepted: toNumber(row.accepted),
    emails: toNumber(row.emails),
    skipped: toNumber(row.skipped),
    failed: toNumber(row.failed),
  };
}

function emptyMetric() {
  return {
    assigned: 0,
    fresh: 0,
    viewed: 0,
    engaged: 0,
    requests: 0,
    pending: 0,
    accepted: 0,
    emails: 0,
    skipped: 0,
    failed: 0,
  };
}

function rangeStart(range: Range) {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function labelForRange(range: Range) {
  if (range === "7d") return "Last 7 days";
  if (range === "30d") return "Last 30 days";
  if (range === "90d") return "Last 90 days";
  return "All time";
}

function rate(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round(Math.min(100, (numerator / denominator) * 1000)) / 10;
}

function normalizeWeekStart(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a valid week.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Choose a valid week.");
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function weekLabel(start: string, endExclusive: string) {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${endExclusive}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(startDate)} – ${formatter.format(endDate)}`;
}

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function isCleanEmail(value: string) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function cleanNames(firstValue: unknown, lastValue: unknown, fullValue: unknown) {
  let firstName = String(firstValue ?? "").trim();
  let lastName = String(lastValue ?? "").trim();
  const fullName = String(fullValue ?? "").trim();
  if (!firstName && fullName) firstName = fullName.split(/\s+/)[0] ?? "";
  if (!lastName && fullName) {
    lastName = fullName.split(/\s+/).slice(1).join(" ");
  }
  return { firstName, lastName };
}

function csvLine(values: unknown[]) {
  return values
    .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
    .join(",");
}

function crmWebhookUrl() {
  const value = process.env.CRM_WEBHOOK_URL?.trim();
  if (!value) {
    throw new Error(
      "CRM delivery is not set up yet. Add CRM_WEBHOOK_URL, or use the clean CSV download.",
    );
  }
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("CRM_WEBHOOK_URL must use HTTPS.");
  return url.toString();
}

function crmWebhookHeaders() {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = process.env.CRM_WEBHOOK_SECRET?.trim();
  if (secret) headers.authorization = `Bearer ${secret}`;
  return headers;
}
