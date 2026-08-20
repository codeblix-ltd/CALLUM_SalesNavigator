import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const updateScoutActive = internalMutation({
  args: {
    operatorId: v.string(),
    active: v.boolean(),
  },
  returns: v.object({
    operatorId: v.string(),
    username: v.string(),
    active: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_operator_id", (query) => query.eq("operatorId", args.operatorId))
      .unique();
    if (!user || user.role !== "scout") throw new Error("Scout account not found.");
    await ctx.db.patch(user._id, { active: args.active });
    return {
      operatorId: user.operatorId,
      username: user.name ?? user.operatorId,
      active: args.active,
    };
  },
});
