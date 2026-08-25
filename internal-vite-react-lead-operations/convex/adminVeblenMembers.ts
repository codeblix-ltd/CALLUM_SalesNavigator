"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { getPool } from "./lib/cockroach";

const nullableText = v.union(v.string(), v.null());
const matchValidator = v.object({
  leadId: v.string(),
  leadName: nullableText,
  leadLinkedInUrl: v.string(),
  originalEmail: nullableText,
  workEmail: nullableText,
  memberId: v.string(),
  memberName: v.string(),
  memberEmail: nullableText,
  memberLinkedInUrl: nullableText,
  memberProfileUrl: v.string(),
  matchType: v.string(),
  assignedTo: nullableText,
  assignmentStatus: nullableText,
});

export const getMatches = action({
  args: {
    search: v.union(v.string(), v.null()),
    page: v.number(),
    pageSize: v.number(),
  },
  returns: v.object({
    generatedAt: v.string(),
    members: v.number(),
    memberLinkedInUrls: v.number(),
    memberEmails: v.number(),
    matchedLeads: v.number(),
    assignedMatches: v.number(),
    total: v.number(),
    page: v.number(),
    pageSize: v.number(),
    pageCount: v.number(),
    matches: v.array(matchValidator),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adminIdentity.requireAdmin, {});
    const search = (args.search ?? "").trim();
    if (search && search.length < 3) throw new Error("Search must be at least 3 characters.");
    const pageSize = Math.min(100, Math.max(10, Math.floor(args.pageSize)));
    const requestedPage = Math.max(1, Math.floor(args.page));
    const searchValue = search ? `%${search}%` : null;
    const database = getPool();
    const searchClause = `AND (
      $1::STRING IS NULL
      OR concat_ws(' ', l.full_name, l.linkedin_url, l.original_email, l.work_email, vm.name, vm.email, vm.linkedin_url) ILIKE $1
    )`;

    const [summaryResult, totalResult] = await Promise.all([
      database.query(
        `SELECT
           (SELECT count(*)::FLOAT8 FROM veblen_members) AS members,
           (SELECT count(*)::FLOAT8 FROM veblen_members WHERE linkedin_url IS NOT NULL) AS member_linkedin_urls,
           (SELECT count(*)::FLOAT8 FROM veblen_members WHERE normalized_email IS NOT NULL) AS member_emails,
           count(vx.lead_id)::FLOAT8 AS matched_leads,
           count(vx.lead_id) FILTER (WHERE a.lead_id IS NOT NULL)::FLOAT8 AS assigned_matches
         FROM veblen_lead_matches AS vx
         LEFT JOIN lead_assignments AS a ON a.lead_id = vx.lead_id`,
      ),
      database.query(
        `SELECT count(*)::FLOAT8 AS total
           FROM veblen_lead_matches AS vx
           INNER JOIN leads AS l ON l.id = vx.lead_id
           INNER JOIN veblen_members AS vm ON vm.member_id = vx.member_id
           LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
          WHERE true ${searchClause}`,
        [searchValue],
      ),
    ]);

    const total = Number(totalResult.rows[0]?.total ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const result = await database.query(
      `SELECT
         l.id::STRING AS lead_id,
         l.full_name AS lead_name,
         l.linkedin_url AS lead_linkedin_url,
         l.original_email,
         l.work_email,
         vm.member_id,
         vm.name AS member_name,
         vm.email AS member_email,
         vm.linkedin_url AS member_linkedin_url,
         vm.profile_url AS member_profile_url,
         vx.match_type,
         a.operator_id AS assigned_to,
         a.status AS assignment_status
       FROM veblen_lead_matches AS vx
       INNER JOIN leads AS l ON l.id = vx.lead_id
       INNER JOIN veblen_members AS vm ON vm.member_id = vx.member_id
       LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
       WHERE true ${searchClause}
        ORDER BY assigned_to IS NOT NULL DESC, lower(coalesce(lead_name, member_name)), lead_id
        LIMIT $2 OFFSET $3`,
      [searchValue, pageSize, (page - 1) * pageSize],
    );
    const summary = summaryResult.rows[0] ?? {};

    return {
      generatedAt: new Date().toISOString(),
      members: Number(summary.members ?? 0),
      memberLinkedInUrls: Number(summary.member_linkedin_urls ?? 0),
      memberEmails: Number(summary.member_emails ?? 0),
      matchedLeads: Number(summary.matched_leads ?? 0),
      assignedMatches: Number(summary.assigned_matches ?? 0),
      total,
      page,
      pageSize,
      pageCount,
      matches: result.rows.map((row) => ({
        leadId: String(row.lead_id),
        leadName: nullableString(row.lead_name),
        leadLinkedInUrl: String(row.lead_linkedin_url ?? ""),
        originalEmail: nullableString(row.original_email),
        workEmail: nullableString(row.work_email),
        memberId: String(row.member_id),
        memberName: String(row.member_name),
        memberEmail: nullableString(row.member_email),
        memberLinkedInUrl: nullableString(row.member_linkedin_url),
        memberProfileUrl: String(row.member_profile_url),
        matchType: String(row.match_type),
        assignedTo: nullableString(row.assigned_to),
        assignmentStatus: nullableString(row.assignment_status),
      })),
    };
  },
});

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
