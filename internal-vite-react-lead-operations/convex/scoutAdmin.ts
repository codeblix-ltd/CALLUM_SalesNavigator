"use node";

import { modifyAccountCredentials } from "@convex-dev/auth/server";
import { randomBytes } from "node:crypto";
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

export const resetScoutPassword = action({
  args: {
    operatorId: v.string(),
    provisioningKey: v.string(),
  },
  returns: v.object({
    username: v.string(),
    password: v.string(),
  }),
  handler: async (ctx, args) => {
    const expected = process.env.SCOUT_PROVISIONING_KEY;
    if (!expected || args.provisioningKey !== expected) {
      throw new Error("Scout administration is not authorized.");
    }
    const username = normalizeUsername(args.operatorId);
    await ctx.runQuery(internal.scoutIdentity.assertActiveScoutByOperator, {
      operatorId: username,
    });
    const password = `Ca${randomBytes(18).toString("base64url")}7`;
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: {
        id: `${username}@scout.callum.invalid`,
        secret: password,
      },
    });
    return { username, password };
  },
});

function normalizeUsername(value: string) {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
    throw new Error(
      "Username must be 3-40 characters using letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return username;
}
