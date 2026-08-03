import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";

const adminValidator = v.object({
  username: v.string(),
});

const scoutValidator = v.object({
  username: v.string(),
  operatorId: v.string(),
  active: v.boolean(),
});

export const currentAdmin = query({
  args: {},
  returns: v.union(adminValidator, v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (!user || !user.active || user.role !== "admin") return null;
    return { username: user.name ?? "Callum" };
  },
});

export const requireAdmin = internalQuery({
  args: {},
  returns: adminValidator,
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Administrator sign-in is required.");
    }
    const user = await ctx.db.get(userId);
    if (!user || !user.active || user.role !== "admin") {
      throw new Error("This account cannot access the admin workspace.");
    }
    return { username: user.name ?? "Callum" };
  },
});

export const listScouts = internalQuery({
  args: {},
  returns: v.object({
    scouts: v.array(scoutValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("by_role", (query) => query.eq("role", "scout"))
      .take(501);
    return {
      scouts: rows.slice(0, 500).map((user) => ({
        username: user.name ?? user.operatorId,
        operatorId: user.operatorId,
        active: user.active,
      })),
      truncated: rows.length > 500,
    };
  },
});
