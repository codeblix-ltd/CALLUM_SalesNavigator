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
  at: v.string(),
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
    const [inventoryResult, metricResult, eventResult, trendResult, recentResult] =
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
             count(*) FILTER (WHERE status = 'assigned')::FLOAT8 AS fresh,
             count(*) FILTER (
               WHERE viewed_at IS NOT NULL
                 AND ($1::TIMESTAMPTZ IS NULL OR viewed_at >= $1::TIMESTAMPTZ)
             )::FLOAT8 AS viewed,
             count(*) FILTER (
               WHERE engaged_at IS NOT NULL
                 AND ($1::TIMESTAMPTZ IS NULL OR engaged_at >= $1::TIMESTAMPTZ)
             )::FLOAT8 AS engaged,
             count(*) FILTER (
               WHERE connection_requested_at IS NOT NULL
                 AND ($1::TIMESTAMPTZ IS NULL OR connection_requested_at >= $1::TIMESTAMPTZ)
             )::FLOAT8 AS requests,
             count(*) FILTER (WHERE status = 'connection_requested')::FLOAT8 AS pending,
             count(*) FILTER (
               WHERE accepted_at IS NOT NULL
                 AND ($1::TIMESTAMPTZ IS NULL OR accepted_at >= $1::TIMESTAMPTZ)
             )::FLOAT8 AS accepted,
             count(*) FILTER (
               WHERE email_collected_at IS NOT NULL
                 AND email IS NOT NULL
                 AND ($1::TIMESTAMPTZ IS NULL OR email_collected_at >= $1::TIMESTAMPTZ)
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
             e.created_at::STRING AS at
           FROM lead_assignment_events AS e
           INNER JOIN leads AS l ON l.id = e.lead_id
           WHERE ($1::TIMESTAMPTZ IS NULL OR e.created_at >= $1::TIMESTAMPTZ)
           ORDER BY e.created_at DESC
           LIMIT 80`,
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
        at: String(row.at),
      })),
    };
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

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}
