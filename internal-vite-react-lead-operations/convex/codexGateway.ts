"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requestCodexGateway } from "./lib/codexGateway";

type Account = {
  email: string | null;
  planType: string;
};

type GatewayStatus = {
  connected: boolean;
  account: Account | null;
  model: string;
  queuedDrafts: number;
};

const accountValidator = v.object({
  email: v.union(v.string(), v.null()),
  planType: v.string(),
});
const statusValidator = v.object({
  connected: v.boolean(),
  account: v.union(accountValidator, v.null()),
  model: v.string(),
  queuedDrafts: v.number(),
});
const loginValidator = v.object({
  connected: v.boolean(),
  account: v.union(accountValidator, v.null()),
  loginId: v.union(v.string(), v.null()),
  verificationUrl: v.union(v.string(), v.null()),
  userCode: v.union(v.string(), v.null()),
});
const loginStatusValidator = v.object({
  connected: v.boolean(),
  state: v.string(),
  error: v.union(v.string(), v.null()),
  account: v.union(accountValidator, v.null()),
});

export const getStatus = action({
  args: {},
  returns: statusValidator,
  handler: async (ctx): Promise<GatewayStatus> => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    return requestCodexGateway<GatewayStatus>("/v1/status");
  },
});

export const startDeviceLogin = action({
  args: {},
  returns: loginValidator,
  handler: async (ctx) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const result = await requestCodexGateway<{
      connected: boolean;
      account?: Account | null;
      loginId?: string;
      verificationUrl?: string;
      userCode?: string;
    }>("/v1/auth/device/start", { method: "POST" });
    return {
      connected: result.connected,
      account: result.account ?? null,
      loginId: result.loginId ?? null,
      verificationUrl: result.verificationUrl ?? null,
      userCode: result.userCode ?? null,
    };
  },
});

export const getDeviceLoginStatus = action({
  args: {
    loginId: v.string(),
  },
  returns: loginStatusValidator,
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const loginId = args.loginId.trim();
    if (!loginId || loginId.length > 200) {
      throw new Error("Invalid Codex login ID.");
    }
    return requestCodexGateway<{
      connected: boolean;
      state: string;
      error: string | null;
      account: Account | null;
    }>(`/v1/auth/device/status?loginId=${encodeURIComponent(loginId)}`);
  },
});

export const logout = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    await requestCodexGateway<{ ok: boolean }>("/v1/auth/logout", {
      method: "POST",
    });
    return null;
  },
});
