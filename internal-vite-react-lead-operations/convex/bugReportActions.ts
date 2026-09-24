"use node";

import { v, type Infer } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { reportContext } from "./bugReportTypes";

function checkedOccurrence(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > Date.now() + 300000) {
    throw new Error("Please check when the issue happened.");
  }
  return value;
}

function cleanedContext(value: Infer<typeof reportContext>) {
  for (const field of Object.values(value)) {
    if (typeof field === "string" && field.length > 1000) throw new Error("Report details are too long.");
  }
  const context = { ...value };
  for (const field of ["pageUrl", "pausePageUrl", "pauseExpectedUrl", "leadIssuePageUrl", "leadIssueExpectedUrl"] as const) {
    if (!context[field]) continue;
    try {
      const url = new URL(context[field]);
      const safe = field === "pageUrl"
        ? url.protocol === "https:" || url.protocol === "chrome-extension:"
        : url.protocol === "https:" && /(^|\.)linkedin\.com$/i.test(url.hostname);
      context[field] = safe
        ? url.origin + url.pathname : "";
    } catch { context[field] = ""; }
  }
  return context;
}

export const submit = action({
  args: { clientId: v.string(), description: v.string(), occurredAt: v.number(), context: reportContext, screenshots: v.array(v.string()) },
  returns: v.id("bugReports"),
  handler: async (ctx, args): Promise<Id<"bugReports">> => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    if (!/^[\da-f-]{36}$/i.test(args.clientId)) throw new Error("Invalid report reference.");
    if (args.description.trim().length < 5 || args.description.length > 5000) throw new Error("Describe the issue in 5–5,000 characters.");
    checkedOccurrence(args.occurredAt);
    const context = cleanedContext(args.context);
    if (args.screenshots.length > 3) throw new Error("Attach up to three screenshots.");
    const buffers = args.screenshots.map(data => {
      if (data.length > 1400000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("Screenshot is too large or invalid.");
      const buffer = Buffer.from(data, "base64");
      if (buffer.length > 1000000 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) throw new Error("Please attach a valid screenshot.");
      return buffer;
    });
    const previous = await ctx.runQuery(internal.bugReports.existing, { reporterId: scout.userId, clientId: args.clientId });
    if (previous) return previous;
    const screenshots: Id<"_storage">[] = [];
    try {
      for (const buffer of buffers) screenshots.push(await ctx.storage.store(new Blob([new Uint8Array(buffer)], { type: "image/jpeg" })));
      const result = await ctx.runMutation(internal.bugReports.save, {
        ...args, context, description: args.description.trim(), screenshots,
        reporterId: scout.userId, reporter: scout.username, operatorId: scout.operatorId,
        status: "open", adminNote: "", updatedAt: Date.now(),
      });
      if (!result.inserted) await Promise.all(screenshots.map(id => ctx.storage.delete(id)));
      return result.id;
    } catch (error) {
      await Promise.all(screenshots.map(id => ctx.storage.delete(id).catch(() => undefined)));
      throw error;
    }
  },
});

export const scoutReply = action({
  args: { id: v.id("bugReports"), clientId: v.string(), text: v.string(), screenshots: v.array(v.string()), occurredAt: v.optional(v.number()), context: v.optional(reportContext) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    if (!args.text.trim() || args.text.trim().length > 2000 || !/^[\da-f-]{36}$/i.test(args.clientId)) throw new Error("Write a reply of up to 2,000 characters.");
    if (args.screenshots.length > 3) throw new Error("Attach up to three screenshots.");
    const occurredAt = args.occurredAt === undefined ? undefined : checkedOccurrence(args.occurredAt);
    const context = args.context === undefined ? undefined : cleanedContext(args.context);
    const buffers = args.screenshots.map(data => {
      if (data.length > 1400000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("Screenshot is too large or invalid.");
      const buffer = Buffer.from(data, "base64");
      if (buffer.length > 1000000 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) throw new Error("Please attach a valid screenshot.");
      return buffer;
    });
    const images: Id<"_storage">[] = [];
    try {
      for (const buffer of buffers) images.push(await ctx.storage.store(new Blob([new Uint8Array(buffer)], { type: "image/jpeg" })));
      const inserted = await ctx.runMutation(internal.bugReports.saveScoutReply, { id: args.id, userId: scout.userId, clientId: args.clientId, text: args.text, screenshots: images, occurredAt, context });
      if (!inserted) await Promise.all(images.map(id => ctx.storage.delete(id)));
      return null;
    } catch (error) {
      await Promise.all(images.map(id => ctx.storage.delete(id).catch(() => undefined)));
      throw error;
    }
  },
});
