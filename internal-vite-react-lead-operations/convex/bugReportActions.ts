"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { reportContext } from "./bugReportTypes";

export const submit = action({
  args: { clientId: v.string(), description: v.string(), occurredAt: v.number(), context: reportContext, screenshots: v.array(v.string()) },
  returns: v.id("bugReports"),
  handler: async (ctx, args): Promise<Id<"bugReports">> => {
    const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
    if (!/^[\da-f-]{36}$/i.test(args.clientId)) throw new Error("Invalid report reference.");
    if (args.description.trim().length < 5 || args.description.length > 5000) throw new Error("Describe the issue in 5–5,000 characters.");
    if (!Number.isFinite(args.occurredAt) || args.occurredAt < 0 || args.occurredAt > Date.now() + 300000) throw new Error("Please check when the issue happened.");
    for (const value of Object.values(args.context)) if (value.length > 1000) throw new Error("Report details are too long.");
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
        ...args, description: args.description.trim(), screenshots,
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
