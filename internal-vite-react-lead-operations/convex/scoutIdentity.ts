import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const requireScout = internalQuery({
  args: {},
  returns: v.object({
    userId: v.id("users"),
    username: v.string(),
    operatorId: v.string(),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Sign in is required.");
    }
    const user = await ctx.db.get(userId);
    if (!user || user.role !== "scout" || !user.active) {
      throw new Error("This scout account is not active.");
    }
    return {
      userId,
      username: user.name ?? user.operatorId,
      operatorId: user.operatorId,
    };
  },
});

export const assertActiveScoutByOperator = internalQuery({
  args: {
    operatorId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_operator_id", (query) =>
        query.eq("operatorId", args.operatorId),
      )
      .unique();
    if (!user || !user.active || user.role !== "scout") {
      throw new Error(`Active scout not found: ${args.operatorId}`);
    }
    return null;
  },
});
