// No "use node": network waits run in the 64 MiB runtime, not a 512 MiB SQL action.
import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requestCodexGateway } from "./lib/codexGateway";
import { composeConnectionNote, normalizeLanguageResults } from "./lib/scoutAiLogic";
import { aiKind, jobReceipt, languageArgs, noteArgs } from "./scoutAiTypes";

async function submit(ctx: ActionCtx, kind: Infer<typeof aiKind>, request: unknown): Promise<{jobId: Id<"scoutAiJobs">; generation: string}> {
  const scout = await ctx.runQuery(internal.scoutIdentity.requireScout, {});
  const serialized = JSON.stringify(request);
  if (serialized.length > 26_000) throw new Error("The AI request is too large.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return ctx.runMutation(internal.scoutAiJobs.reserve, { userId: scout.userId, operatorId: scout.operatorId,
    kind, request: serialized, fingerprint, generation: crypto.randomUUID() });
}

export const draftComment = action({
  args: { postText: v.string() }, returns: jobReceipt,
  handler: async (ctx, args) => {
    const postText = args.postText.trim();
    if (postText.length < 30 || postText.length > 8_000) throw new Error("Post text must be between 30 and 8,000 characters.");
    return submit(ctx, "comment", { postText });
  },
});
export const draftConnectionNote = action({
  args: noteArgs, returns: jobReceipt,
  handler: (ctx, args) => submit(ctx, "note", args),
});
export const classifyLanguages = action({
  args: languageArgs, returns: jobReceipt,
  handler: (ctx, args) => {
    if (args.samples.length < 1 || args.samples.length > 3) throw new Error("Language checks require between one and three samples.");
    return submit(ctx, "language", { ...args, samples: args.samples.map(sample => ({ id: sample.id.trim().slice(0, 100), text: sample.text.trim().slice(0, 8_000) })) });
  },
});

export const run = internalAction({
  args: { jobId: v.id("scoutAiJobs"), generation: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const job = await ctx.runQuery(internal.scoutAiJobs.readWork, args);
      if (!job || job.expiresAt <= Date.now()) return null;
      let result: unknown;
      const requestId = `${args.jobId}:${args.generation}`;
      if (job.kind === "language") {
        const input = JSON.parse(job.request) as Infer<ReturnType<typeof languageInput>>;
        const prepared = await ctx.runAction(internal.scoutAiDb.prepareLanguage, { ...input, operatorId: job.operatorId });
        if (prepared.cached) {
          result = { ...prepared.cached, cached: true, model: "cached" };
        } else {
          const response = await requestCodexGateway<{results: Array<{id: string; status: string; languageCode: string; confidence: number}>; model: string}>("/v1/linkedin/language-check", {
            method: "POST", timeoutMs: 570_000,
            body: { requestId, scoutId: job.userId, context: input.context, samples: prepared.samples },
          });
          const results = normalizeLanguageResults(response.results, prepared.samples);
          if (input.context === "profile") await ctx.runAction(internal.scoutAiDb.saveProfileLanguage, { leadId: input.leadId, operatorId: job.operatorId, result: results[0] });
          result = { results, cached: false, model: String(response.model || "unknown") };
        }
      } else {
        const prepared = job.kind === "note"
          ? await ctx.runAction(internal.scoutAiDb.prepareNote, { ...JSON.parse(job.request) as Infer<ReturnType<typeof noteInput>>, operatorId: job.operatorId })
          : { postText: (JSON.parse(job.request) as {postText: string}).postText, firstName: "" };
        const response = await requestCodexGateway<{draft: string; languageStatus: "english"; threadId: string; model: string}>("/v1/drafts", {
          method: "POST", timeoutMs: 570_000, body: { requestId, scoutId: job.userId, postText: prepared.postText },
        });
        if (job.kind === "note") {
          const note = composeConnectionNote(prepared.firstName, response.draft);
          if (!note || note.length > 300) throw new Error("The personal connection note was empty or too long.");
          result = { note, threadId: response.threadId, model: response.model };
        } else {
          if (response.languageStatus !== "english" || typeof response.draft !== "string" || !response.draft.trim()) throw new Error("The AI did not return a usable English comment.");
          result = response;
        }
      }
      const serialized = JSON.stringify(result);
      if (serialized.length > 16_000) throw new Error("The AI result was too large.");
      await ctx.runMutation(internal.scoutAiJobs.finish, { ...args, result: serialized });
    } catch (error) {
      await ctx.runMutation(internal.scoutAiJobs.finish, { ...args, error: (error instanceof Error ? error.message : "The AI job failed. Please retry.").slice(0, 500) });
    }
    return null;
  },
});

function languageInput() { return v.object(languageArgs); }
function noteInput() { return v.object(noteArgs); }
