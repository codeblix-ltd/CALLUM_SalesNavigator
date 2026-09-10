import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { aiKind, jobReceipt, JOB_TIMEOUT_MS, RESULT_CACHE_MS } from "./scoutAiTypes";

export const reserve = internalMutation({
  args: { userId: v.id("users"), operatorId: v.string(), kind: aiKind,
    fingerprint: v.string(), generation: v.string(), request: v.string() },
  returns: jobReceipt,
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobs = await ctx.db.query("scoutAiJobs").withIndex("by_user", q => q.eq("userId", args.userId)).take(3);
    const slot = jobs.find(job => job.kind === args.kind);
    if (slot && slot.expiresAt > now && slot.fingerprint === args.fingerprint) {
      return { jobId: slot._id, generation: slot.generation };
    }
    if (jobs.some(job => job.status === "pending" && job.expiresAt > now)) {
      throw new Error("An AI check is already running for this scout. Wait for it to finish before retrying.");
    }
    const windowStart = Math.floor(now / RESULT_CACHE_MS) * RESULT_CACHE_MS;
    const starts = jobs.reduce((total, job) => total + (job.windowStart === windowStart ? job.starts : 0), 0);
    const configured = Number(process.env.SCOUT_AI_MAX_JOBS_PER_HOUR || 120);
    const limit = Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : 120;
    if (starts >= limit) throw new Error("The scout AI hourly limit has been reached. Pause and try again next hour.");
    const fields = { ...args, status: "pending" as const, expiresAt: now + JOB_TIMEOUT_MS,
      windowStart, starts: (slot?.windowStart === windowStart ? slot.starts : 0) + 1 };
    let jobId;
    if (slot) {
      jobId = slot._id;
      await ctx.db.patch(jobId, { ...fields, result: undefined, error: undefined });
    } else {
      jobId = await ctx.db.insert("scoutAiJobs", fields);
    }
    await ctx.scheduler.runAfter(0, internal.scoutAi.run, { jobId, generation: args.generation });
    return { jobId, generation: args.generation };
  },
});

export const get = query({
  args: { jobId: v.id("scoutAiJobs"), generation: v.string() },
  returns: v.object({ status: v.union(v.literal("pending"), v.literal("complete"), v.literal("failed")),
    result: v.optional(v.string()), error: v.optional(v.string()), expiresAt: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!user || user.role !== "scout" || !user.active) throw new Error("Sign in is required.");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("AI job is not available.");
    if (job.generation !== args.generation) return { status: "failed" as const, error: "This AI job was replaced. Please retry." };
    // Let the client compare the deadline: cached queries do not advance with time.
    return { status: job.status, result: job.result, error: job.error, expiresAt: job.expiresAt };
  },
});

export const readWork = internalQuery({
  args: { jobId: v.id("scoutAiJobs"), generation: v.string() },
  returns: v.union(v.null(), v.object({ userId: v.id("users"), operatorId: v.string(), kind: aiKind, request: v.string(), expiresAt: v.number() })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.generation !== args.generation || job.status !== "pending") return null;
    const user = await ctx.db.get(job.userId);
    if (!user?.active || user.role !== "scout" || user.operatorId !== job.operatorId) throw new Error("This scout account is not active.");
    return { userId: job.userId, operatorId: job.operatorId, kind: job.kind, request: job.request!, expiresAt: job.expiresAt };
  },
});

export const finish = internalMutation({
  args: { jobId: v.id("scoutAiJobs"), generation: v.string(), result: v.optional(v.string()), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.generation !== args.generation || job.status !== "pending") return null;
    await ctx.db.patch(job._id, { status: args.error ? "failed" : "complete", request: undefined,
      result: args.result, error: args.error, expiresAt: Date.now() + (args.error ? 30_000 : RESULT_CACHE_MS) });
    return null;
  },
});
