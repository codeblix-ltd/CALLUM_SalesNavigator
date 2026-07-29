import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Lead records stay in CockroachDB. Convex is the secure API/orchestration layer.
const { users: _defaultUsers, ...remainingAuthTables } = authTables;

export default defineSchema({
  ...remainingAuthTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    role: v.union(v.literal("scout"), v.literal("admin")),
    operatorId: v.string(),
    active: v.boolean(),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_operator_id", ["operatorId"]),
});
