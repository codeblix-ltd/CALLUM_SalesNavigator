import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { parse } from "csv-parse/sync";

const REQUIRED_HEADERS = [
  "member_id",
  "name",
  "email",
  "linkedin_url",
  "profile_url",
  "email_public",
];
const BATCH_SIZE = 100;

await run().catch((error) => {
  console.error(`Veblen member sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function run() {
  const databaseUrl = process.env.COCKROACH_DATABASE_URL;
  if (!databaseUrl) throw new Error("COCKROACH_DATABASE_URL is missing from .env.local");

  const args = parseArgs(process.argv.slice(2));
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const csvPath = path.resolve(scriptDirectory, args.file || "../../veblen members.csv");
  const csvText = await readFile(csvPath, "utf8");
  const members = parseMembers(csvText);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10_000,
    options: "--statement_timeout=60000",
  });

  try {
    const preflight = await findLeadMatches(pool, members);
    console.log(
      `Preflight: ${members.length} directory members, ${preflight.matchedLeads} matching leads, ${preflight.assignedMatches} with assignment history.`,
    );
    if (args.dryRun) {
      const stored = await findStoredMatches(pool);
      console.log(
        `Stored list: ${stored.members} members, ${stored.linkedinUrls} LinkedIn URLs, ${stored.emails} public emails, ${stored.matchedLeads} matching leads.`,
      );
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let offset = 0; offset < members.length; offset += BATCH_SIZE) {
        const batch = members.slice(offset, offset + BATCH_SIZE);
        const values = [];
        const rows = batch.map((member, rowIndex) => {
          values.push(
            member.memberId,
            member.name,
            member.email,
            member.normalizedEmail,
            member.linkedinUrl,
            member.profileUrl,
            member.emailPublic,
          );
          const base = rowIndex * 7;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
        });
        await client.query(
          `INSERT INTO veblen_members
            (member_id, name, email, normalized_email, linkedin_url, profile_url, email_public)
           VALUES ${rows.join(",\n")}
           ON CONFLICT (member_id) DO UPDATE SET
             name = excluded.name,
             email = excluded.email,
             normalized_email = excluded.normalized_email,
             linkedin_url = excluded.linkedin_url,
             profile_url = excluded.profile_url,
             email_public = excluded.email_public,
             updated_at = now()`,
          values,
        );
      }

      await client.query("DELETE FROM veblen_lead_matches");
      const memberIds = members.map((member) => member.memberId);
      const removed = await client.query(
        "DELETE FROM veblen_members WHERE NOT (member_id = ANY($1::STRING[]))",
        [memberIds],
      );
      for (let offset = 0; offset < preflight.matches.length; offset += BATCH_SIZE) {
        const batch = preflight.matches.slice(offset, offset + BATCH_SIZE);
        const values = [];
        const rows = batch.map((match, rowIndex) => {
          values.push(match.leadId, match.memberId, match.matchType);
          const base = rowIndex * 3;
          return `($${base + 1}::UUID, $${base + 2}, $${base + 3})`;
        });
        await client.query(
          `INSERT INTO veblen_lead_matches (lead_id, member_id, match_type)
           VALUES ${rows.join(",\n")}`,
          values,
        );
      }
      await client.query("COMMIT");
      console.log(
        `Synced ${members.length} Veblen members and ${preflight.matches.length} protected leads; removed ${removed.rowCount ?? 0} stale directory rows.`,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const verified = await findStoredMatches(pool);
    if (
      verified.members !== members.length ||
      verified.matchedLeads !== preflight.matchedLeads ||
      verified.assignedMatches !== preflight.assignedMatches
    ) {
      throw new Error("Stored Veblen verification does not match the read-only preflight.");
    }
    console.log(
      `Verified: ${verified.members} members, ${verified.linkedinUrls} LinkedIn URLs, ${verified.emails} public emails, ${verified.matchedLeads} matching leads.`,
    );
  } finally {
    await pool.end();
  }
}

async function findLeadMatches(pool, members) {
  const linkedInUrls = members.map((member) => member.linkedinUrl).filter(Boolean);
  const emails = members.map((member) => member.normalizedEmail).filter(Boolean);
  const result = await pool.query(
    `SELECT
       l.id::STRING AS lead_id,
       l.linkedin_url,
       l.work_email_resolved_linkedin_url,
       a.resolved_linkedin_url,
       l.original_email,
       l.work_email,
       a.email AS assignment_email,
       (a.lead_id IS NOT NULL) AS assigned
     FROM leads AS l
     LEFT JOIN lead_assignments AS a ON a.lead_id = l.id
     WHERE rtrim(replace(lower(l.linkedin_url), 'https://www.linkedin.com/', 'https://linkedin.com/'), '/') = ANY($1::STRING[])
        OR rtrim(replace(lower(coalesce(l.work_email_resolved_linkedin_url, '')), 'https://www.linkedin.com/', 'https://linkedin.com/'), '/') = ANY($1::STRING[])
        OR rtrim(replace(lower(coalesce(a.resolved_linkedin_url, '')), 'https://www.linkedin.com/', 'https://linkedin.com/'), '/') = ANY($1::STRING[])
        OR lower(coalesce(l.original_email, '')) = ANY($2::STRING[])
        OR lower(coalesce(l.work_email, '')) = ANY($2::STRING[])
        OR lower(coalesce(a.email, '')) = ANY($2::STRING[])`,
    [linkedInUrls, emails],
  );
  const membersByLinkedIn = new Map();
  const membersByEmail = new Map();
  for (const member of members) {
    if (member.linkedinUrl && !membersByLinkedIn.has(member.linkedinUrl)) {
      membersByLinkedIn.set(member.linkedinUrl, member);
    }
    if (member.normalizedEmail && !membersByEmail.has(member.normalizedEmail)) {
      membersByEmail.set(member.normalizedEmail, member);
    }
  }
  const matches = result.rows.map((row) => {
    const linkedinMember = [
      row.linkedin_url,
      row.work_email_resolved_linkedin_url,
      row.resolved_linkedin_url,
    ]
      .map(normalizeCandidateLinkedInUrl)
      .map((value) => membersByLinkedIn.get(value))
      .find(Boolean);
    const emailMember = [row.original_email, row.work_email, row.assignment_email]
      .map(normalizeCandidateEmail)
      .map((value) => membersByEmail.get(value))
      .find(Boolean);
    const member = linkedinMember || emailMember;
    if (!member) throw new Error(`Could not resolve Veblen member for lead ${row.lead_id}.`);
    return {
      leadId: String(row.lead_id),
      memberId: member.memberId,
      matchType: linkedinMember && emailMember?.memberId === linkedinMember.memberId
        ? "LinkedIn + email"
        : linkedinMember
          ? "LinkedIn"
          : "Email",
      assigned: row.assigned === true,
    };
  });
  return {
    matchedLeads: matches.length,
    assignedMatches: matches.filter((match) => match.assigned).length,
    matches,
  };
}

async function findStoredMatches(pool) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::FLOAT8 FROM veblen_members) AS members,
       (SELECT count(*)::FLOAT8 FROM veblen_members WHERE linkedin_url IS NOT NULL) AS linkedin_urls,
       (SELECT count(*)::FLOAT8 FROM veblen_members WHERE normalized_email IS NOT NULL) AS emails,
       count(vx.lead_id)::FLOAT8 AS matched_leads,
       count(vx.lead_id) FILTER (WHERE a.lead_id IS NOT NULL)::FLOAT8 AS assigned_matches
     FROM veblen_lead_matches AS vx
     LEFT JOIN lead_assignments AS a ON a.lead_id = vx.lead_id`,
  );
  return {
    members: Number(result.rows[0]?.members ?? 0),
    linkedinUrls: Number(result.rows[0]?.linkedin_urls ?? 0),
    emails: Number(result.rows[0]?.emails ?? 0),
    matchedLeads: Number(result.rows[0]?.matched_leads ?? 0),
    assignedMatches: Number(result.rows[0]?.assigned_matches ?? 0),
  };
}

function normalizeCandidateLinkedInUrl(value) {
  try {
    return normalizeLinkedInUrl(value);
  } catch {
    return null;
  }
}

function normalizeCandidateEmail(value) {
  try {
    return normalizeEmail(value);
  } catch {
    return null;
  }
}

function parseMembers(csvText) {
  let headers = [];
  const records = parse(csvText, {
    bom: true,
    columns: (values) => {
      headers = values;
      return values;
    },
    skip_empty_lines: true,
    trim: true,
  });
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`CSV is missing columns: ${missing.join(", ")}`);
  if (records.length < 1 || records.length > 10_000) throw new Error("CSV must contain between 1 and 10,000 members.");

  const seenIds = new Set();
  return records.map((record, index) => {
    const memberId = clean(record.member_id);
    const name = clean(record.name);
    const profileUrl = normalizeVeblenProfileUrl(record.profile_url);
    const linkedinUrl = normalizeLinkedInUrl(record.linkedin_url);
    const emailPublic = clean(record.email_public).toLowerCase() === "true";
    const normalizedEmail = emailPublic ? normalizeEmail(record.email) : null;
    if (!/^[a-z0-9]{8}$/i.test(memberId)) throw new Error(`Row ${index + 2} has an invalid member_id.`);
    if (!name) throw new Error(`Row ${index + 2} is missing a name.`);
    if (seenIds.has(memberId)) throw new Error(`Row ${index + 2} repeats member_id ${memberId}.`);
    seenIds.add(memberId);
    return {
      memberId,
      name,
      email: normalizedEmail,
      normalizedEmail,
      linkedinUrl,
      profileUrl,
      emailPublic,
    };
  });
}

function normalizeLinkedInUrl(value) {
  const text = clean(value);
  if (!text) return null;
  const url = new URL(text);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const match = url.pathname.match(/^\/in\/([^/]+)/i);
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) {
    throw new Error(`Invalid LinkedIn profile URL: ${text}`);
  }
  if (match) return `https://linkedin.com/in/${match[1].toLowerCase()}`;

  // Two directory members use LinkedIn's old one-segment vanity format. Treat
  // that as a personal profile; account tools and company pages are not leads.
  const legacyMatch = url.pathname.match(/^\/([^/]+)\/?$/);
  if (legacyMatch) return `https://linkedin.com/in/${legacyMatch[1].toLowerCase()}`;
  return null;
}

function normalizeVeblenProfileUrl(value) {
  const text = clean(value);
  const url = new URL(text);
  if (url.hostname !== "members.veblendirectors.com" || !/^\/u\/[a-z0-9]{8}$/i.test(url.pathname)) {
    throw new Error(`Invalid Veblen profile URL: ${text}`);
  }
  return `https://members.veblendirectors.com${url.pathname}`;
}

function normalizeEmail(value) {
  const email = clean(value).toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Invalid public email: ${email}`);
  return email;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(values) {
  const parsed = { dryRun: false, file: "" };
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (token === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (token === "--file") {
      parsed.file = values[index + 1] || "";
      index += 1;
      if (!parsed.file) throw new Error("--file requires a path.");
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }
  return parsed;
}
