import type { PoolClient } from "pg";

function normalizedLinkedInSql(valueSql: string) {
  return `rtrim(
    replace(
      replace(
        replace(
          lower(split_part(split_part(coalesce(${valueSql}, ''), '?', 1), '#', 1)),
          'https://www.linkedin.com/',
          'https://linkedin.com/'
        ),
        'http://www.linkedin.com/',
        'https://linkedin.com/'
      ),
      'http://linkedin.com/',
      'https://linkedin.com/'
    ),
    '/'
  )`;
}

function normalizedEmailSql(valueSql: string) {
  return `lower(nullif(trim(coalesce(${valueSql}, '')), ''))`;
}

export function veblenLinkedInMatchPredicateSql(
  memberAlias = "vm",
  leadAlias = "l",
  assignmentAlias?: string,
) {
  const linkedinCandidates = [
    normalizedLinkedInSql(`${leadAlias}.linkedin_url`),
    normalizedLinkedInSql(`${leadAlias}.work_email_resolved_linkedin_url`),
  ];
  if (assignmentAlias) {
    linkedinCandidates.push(normalizedLinkedInSql(`${assignmentAlias}.resolved_linkedin_url`));
  }

  return `(${memberAlias}.linkedin_url IS NOT NULL AND ${memberAlias}.linkedin_url IN (${linkedinCandidates.join(", ")}))`;
}

export function veblenEmailMatchPredicateSql(
  memberAlias = "vm",
  leadAlias = "l",
  assignmentAlias?: string,
) {
  const emailCandidates = [
    normalizedEmailSql(`${leadAlias}.original_email`),
    normalizedEmailSql(`${leadAlias}.work_email`),
  ];
  if (assignmentAlias) emailCandidates.push(normalizedEmailSql(`${assignmentAlias}.email`));
  return `(${memberAlias}.normalized_email IS NOT NULL AND ${memberAlias}.normalized_email IN (${emailCandidates.join(", ")}))`;
}

export function veblenMatchPredicateSql(
  memberAlias = "vm",
  leadAlias = "l",
  assignmentAlias?: string,
) {
  return `(
    ${veblenLinkedInMatchPredicateSql(memberAlias, leadAlias, assignmentAlias)}
    OR
    ${veblenEmailMatchPredicateSql(memberAlias, leadAlias, assignmentAlias)}
  )`;
}

export function veblenMatchExistsSql(leadAlias = "l", _assignmentAlias?: string) {
  return `EXISTS (
    SELECT 1
      FROM veblen_lead_matches AS vx
     WHERE vx.lead_id = ${leadAlias}.id
  )`;
}

export async function upsertVeblenLeadMatches(client: PoolClient, leadIds: string[]) {
  const uniqueIds = [...new Set(leadIds)].filter(Boolean);
  if (uniqueIds.length === 0) return 0;
  const matchPredicate = veblenMatchPredicateSql("vm", "l", "a");
  const result = await client.query(
    `INSERT INTO veblen_lead_matches (lead_id, member_id, match_type, matched_at, updated_at)
     SELECT lead_id, member_id, match_type, now(), now()
       FROM (
         SELECT
           l.id AS lead_id,
           vm.member_id,
           CASE
             WHEN ${veblenLinkedInMatchPredicateSql("vm", "l", "a")}
              AND ${veblenEmailMatchPredicateSql("vm", "l", "a")} THEN 'LinkedIn + email'
             WHEN ${veblenLinkedInMatchPredicateSql("vm", "l", "a")} THEN 'LinkedIn'
             ELSE 'Email'
           END AS match_type,
           row_number() OVER (
             PARTITION BY l.id
             ORDER BY
               CASE WHEN ${veblenLinkedInMatchPredicateSql("vm", "l", "a")} THEN 0 ELSE 1 END,
               vm.member_id
           ) AS match_rank
         FROM leads AS l
         LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
         INNER JOIN veblen_members AS vm ON ${matchPredicate}
         WHERE l.id = ANY($1::UUID[])
       ) AS ranked
      WHERE match_rank = 1
     ON CONFLICT (lead_id) DO UPDATE SET
       member_id = excluded.member_id,
       match_type = excluded.match_type,
       updated_at = now()
     RETURNING lead_id`,
    [uniqueIds],
  );
  return result.rowCount ?? 0;
}
