import { v } from "convex/values";

export const reportStatus = v.union(v.literal("open"), v.literal("investigating"), v.literal("resolved"));
export const reportMessage = v.object({ clientId: v.string(), author: v.union(v.literal("scout"), v.literal("support")), text: v.string(), sentAt: v.number(), screenshots: v.optional(v.array(v.id("_storage"))) });
export const reportContext = v.object({
  version: v.string(), browser: v.string(), timezone: v.string(),
  pageUrl: v.string(), runStatus: v.string(), runStep: v.string(), lead: v.string(),
  pauseKind: v.optional(v.string()), pauseStage: v.optional(v.string()),
  pausePageUrl: v.optional(v.string()), pauseExpectedUrl: v.optional(v.string()),
  pauseOccurredAt: v.optional(v.string()),
  leadIssueKind: v.optional(v.string()), leadIssueStage: v.optional(v.string()),
  leadIssuePageUrl: v.optional(v.string()), leadIssueExpectedUrl: v.optional(v.string()),
  leadIssueOccurredAt: v.optional(v.string()),
});
export const reportFields = {
  reporterId: v.id("users"), reporter: v.string(), operatorId: v.string(),
  clientId: v.string(), description: v.string(), occurredAt: v.number(),
  context: reportContext, screenshots: v.array(v.id("_storage")),
  status: reportStatus, adminNote: v.string(), updatedAt: v.number(),
  messages: v.optional(v.array(reportMessage)),
};
export const reportDocument = v.object({ _id: v.id("bugReports"), _creationTime: v.number(), ...reportFields });
