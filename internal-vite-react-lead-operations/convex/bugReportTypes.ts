import { v } from "convex/values";

export const reportStatus = v.union(v.literal("open"), v.literal("investigating"), v.literal("resolved"));
export const reportContext = v.object({
  version: v.string(), browser: v.string(), timezone: v.string(),
  pageUrl: v.string(), runStatus: v.string(), runStep: v.string(), lead: v.string(),
});
export const reportFields = {
  reporterId: v.id("users"), reporter: v.string(), operatorId: v.string(),
  clientId: v.string(), description: v.string(), occurredAt: v.number(),
  context: reportContext, screenshots: v.array(v.id("_storage")),
  status: reportStatus, adminNote: v.string(), updatedAt: v.number(),
};
export const reportDocument = v.object({ _id: v.id("bugReports"), _creationTime: v.number(), ...reportFields });
