"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { assertAdminAccess } from "./lib/adminAccess";
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
  args: { accessToken: v.string() },
  returns: statusValidator,
  handler: async (_ctx, args): Promise<GatewayStatus> => {
    assertAdminAccess(args.accessToken);
    return requestCodexGateway<GatewayStatus>("/v1/status");
  },
});

export const startDeviceLogin = action({
  args: { accessToken: v.string() },
  returns: loginValidator,
  handler: async (_ctx, args) => {
    assertAdminAccess(args.accessToken);
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
    accessToken: v.string(),
    loginId: v.string(),
  },
  returns: loginStatusValidator,
  handler: async (_ctx, args) => {
    assertAdminAccess(args.accessToken);
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
  args: { accessToken: v.string() },
  returns: v.null(),
  handler: async (_ctx, args) => {
    assertAdminAccess(args.accessToken);
    await requestCodexGateway<{ ok: boolean }>("/v1/auth/logout", {
      method: "POST",
    });
    return null;
  },
});
