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

async function access(ctx: QueryCtx, id: import("./_generated/dataModel").Id<"bugReports">) {
  const userId = await getAuthUserId(ctx);
  const user = userId ? await ctx.db.get(userId) : null;
  if (!user?.active || !["admin", "scout"].includes(user.role)) throw new Error("Sign in is required.");
  const report = await ctx.db.get(id);
  if (!report || (user.role !== "admin" && report.reporterId !== userId)) throw new Error("Report is not available.");
  return { report, user };
}

export const mine = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!user?.active || user.role !== "scout") throw new Error("Sign in is required.");
    const result = await ctx.db.query("bugReports").withIndex("by_reporter", q => q.eq("reporterId", userId!)).order("desc").paginate({ ...args.paginationOpts, numItems: Math.min(20, args.paginationOpts.numItems) });
    return { ...result, page: result.page.map(r => ({ _id: r._id, description: r.description, status: r.status, updatedAt: r.updatedAt, occurredAt: r.occurredAt, messages: r.messages ?? [], screenshotCount: r.screenshots.length })) };
  },
});

export const reply = mutation({
  args: { id: v.id("bugReports"), clientId: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { report, user } = await access(ctx, args.id);
    const text = args.text.trim();
    if (!text || text.length > 2000 || !/^[\da-f-]{36}$/i.test(args.clientId)) throw new Error("Write a reply of up to 2,000 characters.");
    const messages = report.messages ?? [];
    const author = user.role === "admin" ? "support" as const : "scout" as const;
    if (messages.some(m => m.clientId === args.clientId && m.author === author)) return null;
    if (messages.length >= 100) throw new Error("This conversation is full. Please open a new report.");
    if (messages.filter(m => m.author === author && m.sentAt > Date.now() - 60_000).length >= 5) throw new Error("Please wait a minute before sending another reply.");
    await ctx.db.patch(report._id, { messages: [...messages, { clientId: args.clientId, author, text, sentAt: Date.now() }], updatedAt: Date.now(), ...(author === "scout" && report.status === "resolved" ? { status: "open" as const } : {}) });
    return null;
  },
});

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
    const { report } = await access(ctx, id);
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
