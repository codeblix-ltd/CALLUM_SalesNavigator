import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { reportDocument, reportFields, reportStatus } from "./bugReportTypes";

async function admin(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx);
  const user = id ? await ctx.db.get(id) : null;
  if (!user?.active || user.role !== "admin") throw new Error("Administrator sign-in is required.");
}

export const existing = internalQuery({
  args: { reporterId: v.id("users"), clientId: v.string() }, returns: v.union(v.id("bugReports"), v.null()),
  handler: async (ctx, args) => (await ctx.db.query("bugReports").withIndex("by_reporter_client", q => q.eq("reporterId", args.reporterId).eq("clientId", args.clientId)).unique())?._id ?? null,
});

export const save = internalMutation({
  args: reportFields, returns: v.object({ id: v.id("bugReports"), inserted: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.reporterId);
    if (!user?.active || user.role !== "scout") throw new Error("Sign in is required.");
    const existing = await ctx.db.query("bugReports").withIndex("by_reporter_client", q => q.eq("reporterId", args.reporterId).eq("clientId", args.clientId)).unique();
    if (existing) return { id: existing._id, inserted: false };
    const recent = await ctx.db.query("bugReports").withIndex("by_reporter", q => q.eq("reporterId", args.reporterId)).order("desc").take(10);
    if (recent.length === 10 && recent[9]._creationTime > Date.now() - 3600000) throw new Error("You have sent 10 reports this hour. Please try again later.");
    return { id: await ctx.db.insert("bugReports", args), inserted: true };
  },
});

export const list = query({
  args: { status: v.optional(reportStatus), paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(reportDocument), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    await admin(ctx);
    const rows = args.status ? ctx.db.query("bugReports").withIndex("by_status", q => q.eq("status", args.status!)) : ctx.db.query("bugReports");
    const result = await rows.order("desc").paginate({ ...args.paginationOpts, numItems: Math.min(30, args.paginationOpts.numItems) });
    return { page: result.page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

export const images = query({
  args: { id: v.id("bugReports") }, returns: v.array(v.union(v.string(), v.null())),
  handler: async (ctx, { id }) => {
    await admin(ctx);
    const report = await ctx.db.get(id);
    return report ? Promise.all(report.screenshots.map(id => ctx.storage.getUrl(id))) : [];
  },
});

export const update = mutation({
  args: { id: v.id("bugReports"), status: reportStatus, adminNote: v.string() }, returns: v.null(),
  handler: async (ctx, { id, status, adminNote }) => {
    await admin(ctx);
    if (adminNote.length > 5000) throw new Error("Keep the note under 5,000 characters.");
    await ctx.db.patch(id, { status, adminNote, updatedAt: Date.now() });
    return null;
  },
});
