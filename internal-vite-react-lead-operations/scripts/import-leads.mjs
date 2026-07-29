import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { parse } from "csv-parse";
import pg from "pg";
import { from as copyFrom } from "pg-copy-streams";

const EXPECTED_HEADERS = [
  "FullName",
  "FirstName",
  "LastName",
  "Domain",
  "CompanyName",
  "CurrentTitle",
  "LinkedinURL",
  "GeographicRegion",
  "CompanyIndustry",
  "CompanySize",
  "CompanyLinkedin",
  "EmployeeCount",
  "CompanyLocation",
  "FoundedYear",
  "ConnectionDegree",
  "Premium",
  "CompanyDescription",
  "Summary",
];

const LEAD_COLUMNS = [
  "profile_key",
  "full_name",
  "first_name",
  "last_name",
  "domain",
  "company_name",
  "current_title",
  "linkedin_url",
  "geographic_region",
  "company_industry",
  "company_size",
  "company_linkedin",
  "employee_count",
  "company_location",
  "founded_year",
  "connection_degree",
  "premium",
  "company_description",
  "summary",
  "search_text",
  "source_file",
  "source_row",
];

const args = parseArguments(process.argv.slice(2));
const databaseUrl = process.env.COCKROACH_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("COCKROACH_DATABASE_URL is missing from .env.local");
}
if (!args.niche) {
  throw new Error("Pass a niche with --niche \"Your niche\"");
}
if (args.files.length === 0) {
  throw new Error("Pass at least one CSV file path.");
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
});

if (args.deferSearchIndex) {
  await dropSearchIndex();
}

try {
  for (const file of args.files) {
    await importFile(
      path.resolve(file),
      args.niche,
      args.batchSize,
      args.copyChunkSize,
      args.mode,
      args.force,
    );
  }
} finally {
  try {
    if (args.deferSearchIndex) {
      await restoreSearchIndex();
    }
  } finally {
    await pool.end();
  }
}

async function importFile(
  filePath,
  niche,
  batchSize,
  copyChunkSize,
  mode,
  force,
) {
  const fileStat = await stat(filePath);
  const digest = await hashFile(filePath);
  const sourceFile = path.basename(filePath);
  const existing = await pool.query(
    `SELECT id, status, processed_rows
       FROM lead_imports
      WHERE sha256 = $1 AND niche = $2`,
    [digest, niche],
  );

  if (existing.rows[0]?.status === "completed" && !force) {
    console.log(`Skipping ${sourceFile}; this file and niche are already complete.`);
    return;
  }

  const importResult = await pool.query(
    `INSERT INTO lead_imports
      (source_file, niche, sha256, file_bytes, status, processed_rows, error_message, started_at, completed_at)
     VALUES ($1, $2, $3, $4, 'importing', 0, NULL, now(), NULL)
     ON CONFLICT (sha256, niche) DO UPDATE SET
       source_file = excluded.source_file,
       file_bytes = excluded.file_bytes,
       status = 'importing',
       processed_rows = 0,
       error_message = NULL,
       started_at = now(),
       completed_at = NULL
     RETURNING id`,
    [sourceFile, niche, digest, fileStat.size],
  );
  const importId = importResult.rows[0].id;
  let processedRows = 0;
  console.log(
    `Importing ${sourceFile} into niche "${niche}" using ${mode === "copy" ? "fast COPY" : "batched UPSERT"} mode...`,
  );

  try {
    if (mode === "copy") {
      await clearStaging(importId);
      processedRows = await copyAndMergeFile(
        filePath,
        sourceFile,
        importId,
        niche,
        copyChunkSize,
      );
    } else {
      let batch = [];
      for await (const lead of readLeads(filePath, sourceFile)) {
        batch.push(lead);
        if (batch.length >= batchSize) {
          await upsertBatch(batch, niche, importId);
          processedRows += batch.length;
          batch = [];
          if (processedRows % (batchSize * 10) === 0) {
            await recordProgress(importId, processedRows);
            console.log(`  ${processedRows.toLocaleString()} rows processed`);
          }
        }
      }
      if (batch.length > 0) {
        await upsertBatch(batch, niche, importId);
        processedRows += batch.length;
      }
    }

    await refreshStats(niche);
    await pool.query(
      `UPDATE lead_imports
          SET status = 'completed', processed_rows = $2, completed_at = now()
        WHERE id = $1`,
      [importId, processedRows],
    );
    console.log(`Completed ${sourceFile}: ${processedRows.toLocaleString()} rows.`);
  } catch (error) {
    await pool.query(
      `UPDATE lead_imports
          SET status = 'failed', processed_rows = $2, error_message = $3
        WHERE id = $1`,
      [importId, processedRows, String(error).slice(0, 4000)],
    );
    throw error;
  }
}

async function copyAndMergeFile(
  filePath,
  sourceFile,
  importId,
  niche,
  copyChunkSize,
) {
  let chunk = [];
  let processedRows = 0;
  let mergedProfiles = 0;

  for await (const lead of readLeads(filePath, sourceFile)) {
    chunk.push(lead);
    if (chunk.length < copyChunkSize) continue;

    await copyChunkToStaging(chunk, importId);
    mergedProfiles += await mergeStagedChunk(importId, niche);
    processedRows += chunk.length;
    chunk = [];
    await clearStaging(importId);
    await recordProgress(importId, processedRows);
    console.log(
      `  ${processedRows.toLocaleString()} rows processed / ${mergedProfiles.toLocaleString()} profile merges`,
    );
  }

  if (chunk.length > 0) {
    await copyChunkToStaging(chunk, importId);
    mergedProfiles += await mergeStagedChunk(importId, niche);
    processedRows += chunk.length;
    await clearStaging(importId);
    await recordProgress(importId, processedRows);
    console.log(
      `  ${processedRows.toLocaleString()} rows processed / ${mergedProfiles.toLocaleString()} profile merges`,
    );
  }

  return processedRows;
}

async function copyChunkToStaging(leads, importId) {
  const client = await pool.connect();
  const copyColumns = ["import_id", ...LEAD_COLUMNS];
  let copyStream;

  try {
    copyStream = client.query(
      copyFrom(
        `COPY lead_import_staging (${copyColumns.join(", ")})
         FROM STDIN WITH (FORMAT CSV, NULL '\\N')`,
      ),
    );

    for (const lead of leads) {
      const row = [
        importId,
        ...LEAD_COLUMNS.map((column) => lead[column]),
      ];
      if (!copyStream.write(`${row.map(toCsvValue).join(",")}\n`)) {
        await once(copyStream, "drain");
      }
    }
    copyStream.end();
    await finished(copyStream);
  } catch (error) {
    copyStream?.destroy(error);
    throw error;
  } finally {
    client.release();
  }
}

async function mergeStagedChunk(importId, niche) {
  const updates = LEAD_COLUMNS
    .filter((column) => !["profile_key", "source_row"].includes(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(",\n       ");

  const upsertResult = await pool.query(
    `WITH ranked AS (
       SELECT
         ${LEAD_COLUMNS.map((column) => `s.${column}`).join(",\n         ")},
         row_number() OVER (
           PARTITION BY s.profile_key
           ORDER BY s.source_row DESC
         ) AS duplicate_rank
       FROM lead_import_staging AS s
       WHERE s.import_id = $1
     )
     INSERT INTO leads (${LEAD_COLUMNS.join(", ")})
     SELECT ${LEAD_COLUMNS.join(", ")}
       FROM ranked
      WHERE duplicate_rank = 1
     ON CONFLICT (profile_key) DO UPDATE SET
       ${updates},
       updated_at = now()
     RETURNING profile_key`,
    [importId],
  );

  await pool.query(
    `WITH batch_keys AS (
       SELECT profile_key
         FROM lead_import_staging
        WHERE import_id = $1
        GROUP BY profile_key
     )
     INSERT INTO lead_niches (niche, lead_id, first_seen_import_id)
     SELECT $2, l.id, $1
       FROM leads AS l
       INNER JOIN batch_keys AS b ON b.profile_key = l.profile_key
     ON CONFLICT (niche, lead_id) DO NOTHING`,
    [importId, niche],
  );

  return upsertResult.rowCount ?? 0;
}

async function clearStaging(importId) {
  await pool.query(
    "DELETE FROM lead_import_staging WHERE import_id = $1",
    [importId],
  );
}

async function dropSearchIndex() {
  console.log("Temporarily deferring the lead search index for bulk loading...");
  await pool.query(
    "DROP INDEX IF EXISTS leads@leads_search_text_trgm_idx",
  );
}

async function restoreSearchIndex() {
  console.log("Rebuilding the lead search index...");
  await pool.query(
    `CREATE INDEX IF NOT EXISTS leads_search_text_trgm_idx
       ON leads USING GIN (search_text gin_trgm_ops)`,
  );
  console.log("Lead search index is ready.");
}

async function upsertBatch(leads, niche, importId) {
  // A single INSERT ... ON CONFLICT cannot update the same key twice. LinkedIn
  // exports occasionally repeat profiles, so collapse duplicates per batch.
  leads = [...new Map(leads.map((lead) => [lead.profile_key, lead])).values()];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const values = [];
    const rowsSql = leads.map((lead, rowIndex) => {
      const offset = rowIndex * LEAD_COLUMNS.length;
      values.push(...LEAD_COLUMNS.map((column) => lead[column]));
      return `(${LEAD_COLUMNS.map((_, index) => `$${offset + index + 1}`).join(", ")})`;
    });
    const updates = LEAD_COLUMNS
      .filter((column) => !["profile_key", "source_row"].includes(column))
      .map((column) => `${column} = excluded.${column}`)
      .join(",\n       ");

    const result = await client.query(
      `INSERT INTO leads (${LEAD_COLUMNS.join(", ")})
       VALUES ${rowsSql.join(",\n")}
       ON CONFLICT (profile_key) DO UPDATE SET
         ${updates},
         updated_at = now()
       RETURNING id, profile_key`,
      values,
    );

    const nicheValues = [];
    const nicheRows = result.rows.map((row, index) => {
      const offset = index * 3;
      nicheValues.push(niche, row.id, importId);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
    });
    await client.query(
      `INSERT INTO lead_niches (niche, lead_id, first_seen_import_id)
       VALUES ${nicheRows.join(", ")}
       ON CONFLICT (niche, lead_id) DO NOTHING`,
      nicheValues,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function* readLeads(filePath, sourceFile) {
  let sourceRow = 1;
  const parser = createReadStream(filePath).pipe(
    parse({
      bom: true,
      columns: (headers) => {
        const missing = EXPECTED_HEADERS.filter((header) => !headers.includes(header));
        if (missing.length > 0) {
          throw new Error(`CSV is missing columns: ${missing.join(", ")}`);
        }
        return headers;
      },
      skip_empty_lines: true,
      relax_column_count: true,
      trim: false,
    }),
  );

  for await (const row of parser) {
    sourceRow += 1;
    const lead = mapLead(row, sourceFile, sourceRow);
    if (lead) yield lead;
  }
}

function toCsvValue(value) {
  if (value === null || value === undefined) return "\\N";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function refreshStats(niche) {
  await pool.query(
    `UPSERT INTO lead_stats (key, total_count, updated_at)
     SELECT 'all', count(*), now() FROM leads`,
  );
  await pool.query(
    `UPSERT INTO niches (name, lead_count, updated_at)
     SELECT $1, count(*), now()
       FROM lead_niches
      WHERE niche = $1`,
    [niche],
  );
}

async function recordProgress(importId, processedRows) {
  await pool.query(
    "UPDATE lead_imports SET processed_rows = $2 WHERE id = $1",
    [importId, processedRows],
  );
}

function mapLead(row, sourceFile, sourceRow) {
  const linkedinUrl = normalizeLinkedInUrl(row.LinkedinURL);
  const identity = linkedinUrl ||
    [row.FullName, row.CompanyName, row.CurrentTitle, row.GeographicRegion]
      .map(clean)
      .join("|")
      .toLowerCase();
  if (!identity.replace(/\|/g, "")) return null;

  const textFields = [
    row.FullName,
    row.FirstName,
    row.LastName,
    row.CompanyName,
    row.CurrentTitle,
    row.GeographicRegion,
    row.CompanyIndustry,
    row.CompanyLocation,
    row.CompanyDescription,
    row.Summary,
  ];

  return {
    profile_key: createHash("sha256").update(identity).digest("hex"),
    full_name: nullable(row.FullName),
    first_name: nullable(row.FirstName),
    last_name: nullable(row.LastName),
    domain: nullable(row.Domain),
    company_name: nullable(row.CompanyName),
    current_title: nullable(row.CurrentTitle),
    linkedin_url: linkedinUrl || "",
    geographic_region: nullable(row.GeographicRegion),
    company_industry: nullable(row.CompanyIndustry),
    company_size: nullable(row.CompanySize),
    company_linkedin: nullable(row.CompanyLinkedin),
    employee_count: integerOrNull(row.EmployeeCount),
    company_location: nullable(row.CompanyLocation),
    founded_year: integerOrNull(row.FoundedYear),
    connection_degree: nullable(row.ConnectionDegree),
    premium: booleanOrNull(row.Premium),
    company_description: nullable(row.CompanyDescription),
    summary: nullable(row.Summary),
    search_text: textFields.map(clean).filter(Boolean).join(" ").toLowerCase(),
    source_file: sourceFile,
    source_row: sourceRow,
  };
}

function normalizeLinkedInUrl(value) {
  const cleaned = clean(value);
  if (!cleaned) return "";
  try {
    const parsed = new URL(cleaned);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return cleaned;
    let pathName = parsed.pathname.replace(/\/+$/, "");
    if (pathName.toLowerCase().startsWith("/in/")) {
      pathName = pathName.split(",", 1)[0];
    }
    return `https://linkedin.com${pathName}`;
  } catch {
    return cleaned;
  }
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nullable(value) {
  const result = clean(value);
  return result || null;
}

function integerOrNull(value) {
  const normalized = clean(value).replace(/[,\s]/g, "");
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanOrNull(value) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return null;
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  return null;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function parseArguments(argv) {
  const result = {
    files: [],
    niche: "",
    batchSize: 200,
    copyChunkSize: 2_000,
    mode: "copy",
    deferSearchIndex: false,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--niche") {
      result.niche = clean(argv[++index]).slice(0, 120);
    } else if (value === "--batch-size") {
      result.batchSize = Math.max(25, Math.min(500, Number(argv[++index]) || 200));
    } else if (value === "--copy-chunk-size") {
      result.copyChunkSize = Math.max(
        250,
        Math.min(5_000, Number(argv[++index]) || 2_000),
      );
    } else if (value === "--mode") {
      const mode = clean(argv[++index]).toLowerCase();
      if (!["copy", "batched"].includes(mode)) {
        throw new Error('--mode must be either "copy" or "batched".');
      }
      result.mode = mode;
    } else if (value === "--defer-search-index") {
      result.deferSearchIndex = true;
    } else if (value === "--force") {
      result.force = true;
    } else {
      result.files.push(value);
    }
  }
  return result;
}
