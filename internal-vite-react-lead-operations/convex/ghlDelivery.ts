"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  auditGhlOutboxRows,
  deliverGhlOutboxRows,
  ensureGhlScoutTags,
  ghlAuditBatchSize,
  ghlBatchSize,
  ghlMaxAutomaticAttempts,
  ghlRetryDelayMs,
} from "./lib/ghl";

const deliveryResultValidator = v.object({
  attempted: v.number(),
  sent: v.number(),
  failed: v.number(),
  created: v.number(),
  updated: v.number(),
  maxAttemptCount: v.number(),
  scheduled: v.boolean(),
});

export const processBatch = internalAction({
  args: {
    outboxId: v.union(v.string(), v.null()),
    includeFailed: v.boolean(),
    cascade: v.boolean(),
  },
  returns: deliveryResultValidator,
  handler: async (ctx, args) => {
    const result = await deliverGhlOutboxRows({
      outboxId: args.outboxId,
      includeFailed: args.includeFailed,
      limit: args.outboxId ? 1 : ghlBatchSize(),
    });
    let scheduled = false;

    if (args.cascade && result.attempted > 0 && result.sent > 0) {
      await ctx.scheduler.runAfter(1_000, internal.ghlDelivery.processBatch, {
        outboxId: null,
        includeFailed: args.includeFailed,
        cascade: true,
      });
      scheduled = true;
    } else if (
      args.outboxId
      && result.failed > 0
      && result.maxAttemptCount < ghlMaxAutomaticAttempts()
    ) {
      await ctx.scheduler.runAfter(
        ghlRetryDelayMs(result.maxAttemptCount),
        internal.ghlDelivery.processBatch,
        {
          outboxId: args.outboxId,
          includeFailed: true,
          cascade: false,
        },
      );
      scheduled = true;
    }

    return { ...result, scheduled };
  },
});

export const ensureScoutTags = internalAction({
  args: { operatorIds: v.array(v.string()) },
  returns: v.object({ tags: v.array(v.string()) }),
  handler: async (_ctx, args) => {
    const operatorIds = [...new Set(args.operatorIds.map((value) => value.trim()).filter(Boolean))];
    if (operatorIds.length < 1 || operatorIds.length > 100) {
      throw new Error("Provide between 1 and 100 scout usernames.");
    }
    const tags = await ensureGhlScoutTags(operatorIds);
    return { tags };
  },
});

export const auditContactLinks = internalAction({
  args: { cascade: v.boolean() },
  returns: v.object({
    attempted: v.number(),
    linked: v.number(),
    missing: v.number(),
    duplicate: v.number(),
    failed: v.number(),
    scheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await auditGhlOutboxRows(ghlAuditBatchSize());
    let scheduled = false;
    if (args.cascade && result.attempted > 0 && result.failed === 0) {
      await ctx.scheduler.runAfter(1_000, internal.ghlDelivery.auditContactLinks, {
        cascade: true,
      });
      scheduled = true;
    }
    return { ...result, scheduled };
  },
});
