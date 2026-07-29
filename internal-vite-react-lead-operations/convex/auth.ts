import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { DataModel } from "./_generated/dataModel";

const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,39}$/;

const ScoutPassword = Password<DataModel>({
  profile(params) {
    const username = normalizeUsername(params.username);
    const flow = String(params.flow ?? "");

    if (flow === "signUp") {
      const expected = process.env.SCOUT_PROVISIONING_KEY;
      const received = String(params.provisioningKey ?? "");
      if (!expected || received !== expected) {
        throw new ConvexError("Scout provisioning is not authorized.");
      }
    }

    return {
      email: `${username}@scout.callum.invalid`,
      name: username,
      role: "scout",
      operatorId: username,
      active: true,
    };
  },
  validatePasswordRequirements(password) {
    if (
      password.length < 14 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password)
    ) {
      throw new ConvexError(
        "Password must be at least 14 characters and include upper-case, lower-case, and numeric characters.",
      );
    }
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [ScoutPassword],
  session: {
    totalDurationMs: 1000 * 60 * 60 * 24 * 30,
    inactiveDurationMs: 1000 * 60 * 60 * 24 * 7,
  },
  signIn: {
    maxFailedAttempsPerHour: 8,
  },
  callbacks: {
    async beforeSessionCreation(ctx, { userId }) {
      const user = await ctx.db.get(userId);
      if (!user || !user.active || user.role !== "scout") {
        throw new ConvexError("This scout account is disabled.");
      }
    },
  },
});

function normalizeUsername(value: unknown) {
  const username = String(value ?? "").trim().toLowerCase();
  if (!usernamePattern.test(username)) {
    throw new ConvexError(
      "Username must be 3-40 characters using letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return username;
}
