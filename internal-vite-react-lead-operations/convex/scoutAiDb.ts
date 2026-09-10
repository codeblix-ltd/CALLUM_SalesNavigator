"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { getPool } from "./lib/cockroach";
import { firstNameFrom, profileText } from "./lib/scoutAiLogic";
import { languageArgs, noteArgs, languageResult } from "./scoutAiTypes";
function nullableString(value: unknown): string | null { return value === null || value === undefined ? null : String(value); }

// Only called by the authenticated job worker; SQL never waits for AI.
export const prepareLanguage = internalAction({
 args: { ...languageArgs, operatorId: v.string() },
 returns: v.object({ samples: v.array(v.object({id: v.string(), text: v.string()})), cached: v.union(v.null(), v.object({results: v.array(languageResult)})) }),
 handler: async (_ctx, args) => {
    if (args.samples.length < 1 || args.samples.length > 3) {
      throw new Error("Language checks require between one and three samples.");
    }
    const seenIds = new Set<string>();
    const samples = args.samples.map((sample) => {
      const id = sample.id.trim().slice(0, 100);
      const text = sample.text.trim().slice(0, 8_000);
      if (!id || seenIds.has(id)) {
        throw new Error("Language sample ids must be unique.");
      }
      if (text.length < 12) {
        throw new Error("Language samples must contain at least 12 characters.");
      }
      seenIds.add(id);
      return { id, text };
    });

    const database = getPool();
    const leadResult = await database.query(
      `SELECT
         l.profile_language,
         l.profile_language_status,
         l.profile_language_confidence,
         l.profile_language_checked_at
       FROM lead_assignments AS a
       INNER JOIN leads AS l ON l.id = a.lead_id
       WHERE a.lead_id = $1::UUID
         AND a.operator_id = $2
         AND a.status IN ('assigned', 'viewed', 'engaged', 'failed')
       LIMIT 1`,
      [args.leadId, args.operatorId],
    );
    const lead = leadResult.rows[0];
    if (!lead) throw new Error("This lead is no longer available for a language check.");

    if (
      args.context === "profile" &&
      samples.length === 1 &&
      ["english", "non_english", "uncertain"].includes(
        String(lead.profile_language_status || ""),
      ) &&
      lead.profile_language_checked_at &&
      Date.now() - new Date(lead.profile_language_checked_at).getTime() <
        90 * 24 * 60 * 60 * 1_000
    ) {
      return { samples, cached: {
        results: [
          {
            id: samples[0].id,
            status: lead.profile_language_status,
            languageCode: nullableString(lead.profile_language) || "und",
            confidence: Math.max(
              0,
              Math.min(1, Number(lead.profile_language_confidence) || 0),
            ),
          },
        ],

      } };
    }

 return { samples, cached: null };
 }
});
export const prepareNote = internalAction({
 args: { ...noteArgs, operatorId: v.string() },
 returns: v.object({postText: v.string(), firstName: v.string()}),
 handler: async (_ctx, args) => {
    const database = getPool();
    const leadResult = await database.query(
      `SELECT l.first_name, l.full_name, l.current_title, l.company_name
         FROM lead_assignments AS a
         INNER JOIN leads AS l ON l.id = a.lead_id
        WHERE a.lead_id = $1::UUID AND a.operator_id = $2
        LIMIT 1`,
      [args.leadId, args.operatorId],
    );
    const lead = leadResult.rows[0];
    if (!lead) throw new Error("This lead is no longer assigned to this scout.");

    const fullName =
      profileText(args.profile.fullName, 200) ||
      nullableString(lead.full_name) ||
      "LinkedIn member";
    const profile = {
      fullName,
      headline: profileText(args.profile.headline, 500),
      location: profileText(args.profile.location, 200),
      about: profileText(args.profile.about, 2_000),
      currentRole:
        profileText(args.profile.currentRole, 500) ||
        nullableString(lead.current_title),
      currentCompany:
        profileText(args.profile.currentCompany, 500) ||
        nullableString(lead.company_name),
    };
    const profileLines = [
      ["Name", profile.fullName],
      ["Headline", profile.headline],
      ["Location", profile.location],
      ["Current role", profile.currentRole],
      ["Current company", profile.currentCompany],
      ["About", profile.about],
    ].filter((entry): entry is [string, string] => Boolean(entry[1]));
    if (profileLines.length < 2) {
      throw new Error(
        "There is not enough profile detail to create a personal connection note.",
      );
    }

 return { postText: "LinkedIn profile summary for a connection request:\n" + profileLines.map(([label, value]) => label + ": " + value).join("\n"), firstName: nullableString(lead.first_name) || firstNameFrom(fullName) || "there" };
 }
});
export const saveProfileLanguage = internalAction({
 args: { leadId: v.string(), operatorId: v.string(), result: languageResult },
 returns: v.null(),
 handler: async (_ctx, { leadId, operatorId, result }) => {
  await getPool().query(`UPDATE leads SET profile_language = $2, profile_language_status = $3, profile_language_confidence = $4, profile_language_checked_at = now(), updated_at = now()
    WHERE id = $1::UUID AND EXISTS (SELECT 1 FROM lead_assignments WHERE lead_id = $1::UUID AND operator_id = $5)`,
    [leadId, result.languageCode, result.status, result.confidence, operatorId]);
  return null;
 }
});
