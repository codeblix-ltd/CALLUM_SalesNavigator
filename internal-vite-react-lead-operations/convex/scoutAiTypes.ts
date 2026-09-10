import { v } from "convex/values";

export const aiKind = v.union(v.literal("comment"), v.literal("note"), v.literal("language"));
export const languageArgs = {
  leadId: v.string(),
  context: v.union(v.literal("profile"), v.literal("posts"), v.literal("comment")),
  samples: v.array(v.object({ id: v.string(), text: v.string() })),
};
const text = v.union(v.string(), v.null());
export const noteArgs = {
  leadId: v.string(),
  profile: v.object({
    fullName: text, headline: text, location: text, about: text,
    currentRole: text, currentCompany: text,
  }),
};
export const languageResult = v.object({
  id: v.string(),
  status: v.union(v.literal("english"), v.literal("non_english"), v.literal("uncertain")),
  languageCode: v.string(), confidence: v.number(),
});
export const jobStatus = v.union(v.literal("pending"), v.literal("complete"), v.literal("failed"));
export const jobReceipt = v.object({ jobId: v.id("scoutAiJobs"), generation: v.string() });
export const JOB_TIMEOUT_MS = 650_000;
export const RESULT_CACHE_MS = 60 * 60 * 1_000;
