import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

export const assertScout = action({
  args: {
    operatorId: v.string(),
    provisioningKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const expected = process.env.SCOUT_PROVISIONING_KEY;
    if (!expected || args.provisioningKey !== expected) {
      throw new Error("Scout administration is not authorized.");
    }
    await ctx.runQuery(internal.scoutIdentity.assertActiveScoutByOperator, {
      operatorId: args.operatorId,
    });
    return null;
  },
});
