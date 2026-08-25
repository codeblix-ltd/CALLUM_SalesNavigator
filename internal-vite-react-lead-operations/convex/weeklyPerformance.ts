import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalQuery, mutation } from "./_generated/server";

const extraKpiValidator = v.object({
  label: v.string(),
  value: v.number(),
});

const reviewValidator = v.object({
  operatorId: v.string(),
  additionalEmails: v.number(),
  managerPoints: v.number(),
  extraKpis: v.array(extraKpiValidator),
  note: v.union(v.string(), v.null()),
  evidenceUrl: v.union(v.string(), v.null()),
  evidenceFileName: v.union(v.string(), v.null()),
  updatedBy: v.string(),
  updatedAt: v.number(),
});

export const listForWeek = internalQuery({
  args: { weekStart: v.string() },
  returns: v.array(reviewValidator),
  handler: async (ctx, args) => {
    const weekStart = normalizeWeekStart(args.weekStart);
    const rows = await ctx.db
      .query("weeklyScoutReviews")
      .withIndex("by_week", (query) => query.eq("weekStart", weekStart))
      .collect();
    return Promise.all(rows.map(async (row) => ({
      operatorId: row.operatorId,
      additionalEmails: row.additionalEmails,
      managerPoints: row.managerPoints,
      extraKpis: row.extraKpis,
      note: row.note ?? null,
      evidenceUrl: row.evidenceStorageId
        ? await ctx.storage.getUrl(row.evidenceStorageId)
        : null,
      evidenceFileName: row.evidenceFileName ?? null,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    })));
  },
});

export const generateEvidenceUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const saveReview = mutation({
  args: {
    weekStart: v.string(),
    operatorId: v.string(),
    additionalEmails: v.number(),
    managerPoints: v.number(),
    extraKpis: v.array(extraKpiValidator),
    note: v.optional(v.string()),
    evidenceStorageId: v.optional(v.id("_storage")),
    evidenceFileName: v.optional(v.string()),
  },
  returns: v.object({ saved: v.boolean() }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const weekStart = normalizeWeekStart(args.weekStart);
    const operatorId = args.operatorId.trim();
    if (!operatorId) throw new ConvexError("Choose a scout.");
    const scout = await ctx.db
      .query("users")
      .withIndex("by_operator_id", (query) => query.eq("operatorId", operatorId))
      .unique();
    if (!scout || scout.role !== "scout") {
      throw new ConvexError("This scout account no longer exists.");
    }
    const additionalEmails = boundedInteger(args.additionalEmails, 0, 100_000, "Additional emails");
    const managerPoints = boundedInteger(args.managerPoints, -100, 100, "Manager points");
    const extraKpis = args.extraKpis
      .map((item) => ({
        label: item.label.trim().slice(0, 40),
        value: boundedInteger(item.value, 0, 1_000_000, "KPI value"),
      }))
      .filter((item) => item.label)
      .slice(0, 6);
    const note = args.note?.trim().slice(0, 1_000) || undefined;
    const existing = await ctx.db
      .query("weeklyScoutReviews")
      .withIndex("by_week_operator", (query) =>
        query.eq("weekStart", weekStart).eq("operatorId", operatorId))
      .unique();
    const evidenceStorageId = args.evidenceStorageId ?? existing?.evidenceStorageId;
    const evidenceFileName = args.evidenceStorageId
      ? args.evidenceFileName?.trim().slice(0, 180)
      : existing?.evidenceFileName;
    if (args.evidenceStorageId && existing?.evidenceStorageId && existing.evidenceStorageId !== args.evidenceStorageId) {
      await ctx.storage.delete(existing.evidenceStorageId);
    }
    const record = {
      weekStart,
      operatorId,
      additionalEmails,
      managerPoints,
      extraKpis,
      note,
      evidenceStorageId,
      evidenceFileName,
      updatedBy: admin.username,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, record);
    else await ctx.db.insert("weeklyScoutReviews", record);
    return { saved: true };
  },
});

export const removeEvidence = mutation({
  args: { weekStart: v.string(), operatorId: v.string() },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const weekStart = normalizeWeekStart(args.weekStart);
    const existing = await ctx.db
      .query("weeklyScoutReviews")
      .withIndex("by_week_operator", (query) =>
        query.eq("weekStart", weekStart).eq("operatorId", args.operatorId.trim()))
      .unique();
    if (!existing?.evidenceStorageId) return { removed: false };
    await ctx.storage.delete(existing.evidenceStorageId);
    await ctx.db.patch(existing._id, {
      evidenceStorageId: undefined,
      evidenceFileName: undefined,
      updatedBy: admin.username,
      updatedAt: Date.now(),
    });
    return { removed: true };
  },
});

async function requireAdmin(ctx: MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError("Administrator sign-in is required.");
  const user = await ctx.db.get(userId);
  if (!user || !user.active || user.role !== "admin") {
    throw new ConvexError("This account cannot edit weekly scout results.");
  }
  return { username: user.name ?? "Admin" };
}

function normalizeWeekStart(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConvexError("Choose a valid week.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new ConvexError("Choose a valid week.");
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function boundedInteger(value: number, min: number, max: number, label: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConvexError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}
