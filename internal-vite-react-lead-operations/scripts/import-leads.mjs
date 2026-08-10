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

const DEFAULT_MAX_RETRIES = 12;
const MAX_RETRY_DELAY_MS = 30_000;

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
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// pg emits an error when an idle connection dies. Without a listener Node
// treats that as an uncaught error and exits, which used to interrupt imports.
pool.on("error", (error) => {
  console.warn(`Database connection dropped while idle: ${error.message}`);
});

if (args.deferSearchIndex) {
  await withRetry(
    () => dropSearchIndex(),
    "defer the lead search index",
    args.maxRetries,
  );
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
      await withRetry(
        () => restoreSearchIndex(),
        "rebuild the lead search index",
        args.maxRetries,
      );
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
  const existing = await withRetry(
    () => pool.query(
      `SELECT id, status, processed_rows
         FROM lead_imports
        WHERE sha256 = $1 AND niche = $2`,
      [digest, niche],
    ),
    "load the import checkpoint",
    args.maxRetries,
  );

  if (existing.rows[0]?.status === "completed" && !force) {
    console.log(`Skipping ${sourceFile}; this file and niche are already complete.`);
    return;
  }

  const resumeRows = force
    ? 0
    : Math.max(0, Number(existing.rows[0]?.processed_rows ?? 0));

  const importResult = await withRetry(
    () => pool.query(
      `INSERT INTO lead_imports
        (source_file, niche, sha256, file_bytes, status, processed_rows, error_message, started_at, completed_at)
       VALUES ($1, $2, $3, $4, 'importing', $5, NULL, now(), NULL)
       ON CONFLICT (sha256, niche) DO UPDATE SET
         source_file = excluded.source_file,
         file_bytes = excluded.file_bytes,
         status = 'importing',
         processed_rows = excluded.processed_rows,
         error_message = NULL,
         started_at = now(),
         completed_at = NULL
       RETURNING id`,
      [sourceFile, niche, digest, fileStat.size, resumeRows],
    ),
    "start or resume the import",
    args.maxRetries,
  );
  const importId = importResult.rows[0].id;
  let processedRows = resumeRows;
  console.log(
    `Importing ${sourceFile} into niche "${niche}" using ${mode === "copy" ? "fast COPY" : "batched UPSERT"} mode...`,
  );
  if (resumeRows > 0) {
    console.log(
      `Resuming after ${resumeRows.toLocaleString()} safely committed rows.`,
    );
  }

  try {
    if (mode === "copy") {
      processedRows = await copyAndMergeFile(
        filePath,
        sourceFile,
        importId,
        niche,
        copyChunkSize,
        resumeRows,
        args.maxRetries,
      );
    } else {
      let batch = [];
      let skippedRows = 0;
      for await (const lead of readLeads(filePath, sourceFile)) {
        if (skippedRows < resumeRows) {
          skippedRows += 1;
          continue;
        }
        batch.push(lead);
        if (batch.length >= batchSize) {
          const nextProcessedRows = processedRows + batch.length;
          await withRetry(
            () => upsertBatch(batch, niche, importId, nextProcessedRows),
            `commit rows ${(processedRows + 1).toLocaleString()}-${nextProcessedRows.toLocaleString()}`,
            args.maxRetries,
          );
          processedRows = nextProcessedRows;
          batch = [];
          console.log(`  ${processedRows.toLocaleString()} rows committed`);
        }
      }
      if (batch.length > 0) {
        const nextProcessedRows = processedRows + batch.length;
        await withRetry(
          () => upsertBatch(batch, niche, importId, nextProcessedRows),
          `commit rows ${(processedRows + 1).toLocaleString()}-${nextProcessedRows.toLocaleString()}`,
          args.maxRetries,
        );
        processedRows = nextProcessedRows;
        console.log(`  ${processedRows.toLocaleString()} rows committed`);
      }
    }

    await withRetry(
      () => finalizeImport(importId, niche, processedRows),
      "finalize the import",
      args.maxRetries,
    );
    console.log(`Completed ${sourceFile}: ${processedRows.toLocaleString()} rows.`);
  } catch (error) {
    try {
      await withRetry(
        () => markImportFailed(importId, processedRows, error),
        "save the failed import checkpoint",
        args.maxRetries,
      );
    } catch (checkpointError) {
      console.warn(`Could not mark the import as failed: ${checkpointError.message}`);
    }
    throw error;
  }
}

async function copyAndMergeFile(
  filePath,
  sourceFile,
  importId,
  niche,
  copyChunkSize,
  resumeRows,
  maxRetries,
) {
  let chunk = [];
  let processedRows = resumeRows;
  let mergedProfiles = 0;
  let skippedRows = 0;

  await withRetry(
    () => clearStaging(pool, importId),
    "prepare the import staging area",
    maxRetries,
  );

  for await (const lead of readLeads(filePath, sourceFile)) {
    if (skippedRows < resumeRows) {
      skippedRows += 1;
      continue;
    }
    chunk.push(lead);
    if (chunk.length < copyChunkSize) continue;

    const nextProcessedRows = processedRows + chunk.length;
    mergedProfiles += await withRetry(
      () => commitCopyChunk(chunk, importId, niche, nextProcessedRows),
      `commit rows ${(processedRows + 1).toLocaleString()}-${nextProcessedRows.toLocaleString()}`,
      maxRetries,
    );
    processedRows = nextProcessedRows;
    chunk = [];
    console.log(
      `  ${processedRows.toLocaleString()} rows committed / ${mergedProfiles.toLocaleString()} profile merges this run`,
    );
  }

  if (chunk.length > 0) {
    const nextProcessedRows = processedRows + chunk.length;
    mergedProfiles += await withRetry(
      () => commitCopyChunk(chunk, importId, niche, nextProcessedRows),
      `commit rows ${(processedRows + 1).toLocaleString()}-${nextProcessedRows.toLocaleString()}`,
      maxRetries,
    );
    processedRows = nextProcessedRows;
    console.log(
      `  ${processedRows.toLocaleString()} rows committed / ${mergedProfiles.toLocaleString()} profile merges this run`,
    );
  }

  return processedRows;
}

async function commitCopyChunk(leads, importId, niche, processedRows) {
  const client = await pool.connect();
  let clientError = null;
  const onClientError = (error) => {
    clientError = error;
  };
  client.on("error", onClientError);

  try {
    await client.query("BEGIN");
    await copyChunkToStaging(client, leads, importId);
    const mergedProfiles = await mergeStagedChunk(client, importId, niche);
    await clearStaging(client, importId);
    await client.query(
      "UPDATE lead_imports SET processed_rows = $2 WHERE id = $1",
      [importId, processedRows],
    );
    await client.query("COMMIT");
    return mergedProfiles;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A dead connection cannot roll back, and the database will discard its
      // open transaction. The whole chunk is safe to retry.
    }
    throw error;
  } finally {
    client.removeListener("error", onClientError);
    client.release(clientError ? true : undefined);
  }
}

async function copyChunkToStaging(client, leads, importId) {
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
  }
}

async function mergeStagedChunk(client, importId, niche) {
  const updates = LEAD_COLUMNS
    .filter((column) => !["profile_key", "source_row"].includes(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(",\n       ");

  const upsertResult = await client.query(
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
       updated_at = now()`,
    [importId],
  );

  await client.query(
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

async function clearStaging(client, importId) {
  await client.query(
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

async function upsertBatch(leads, niche, importId, processedRows) {
  // A single INSERT ... ON CONFLICT cannot update the same key twice. LinkedIn
  // exports occasionally repeat profiles, so collapse duplicates per batch.
  leads = [...new Map(leads.map((lead) => [lead.profile_key, lead])).values()];
  const client = await pool.connect();
  let clientError = null;
  const onClientError = (error) => {
    clientError = error;
  };
  client.on("error", onClientError);

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
    await client.query(
      "UPDATE lead_imports SET processed_rows = $2 WHERE id = $1",
      [importId, processedRows],
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The database rolls back an open transaction when its connection dies.
    }
    throw error;
  } finally {
    client.removeListener("error", onClientError);
    client.release(clientError ? true : undefined);
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

async function finalizeImport(importId, niche, processedRows) {
  await refreshStats(niche);
  await pool.query(
    `UPDATE lead_imports
        SET status = 'completed',
            processed_rows = $2,
            error_message = NULL,
            completed_at = now()
      WHERE id = $1`,
    [importId, processedRows],
  );
}

async function markImportFailed(importId, processedRows, error) {
  await pool.query(
    `UPDATE lead_imports
        SET status = 'failed',
            processed_rows = greatest(processed_rows, $2),
            error_message = $3
      WHERE id = $1`,
    [importId, processedRows, String(error).slice(0, 4000)],
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

async function withRetry(operation, label, maxRetries) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableDatabaseError(error) || attempt >= maxRetries) {
        throw error;
      }

      const delayMs = retryDelayMs(attempt);
      console.warn(
        `Database issue while trying to ${label}: ${error.message}`,
      );
      console.warn(
        `Retrying in ${Math.ceil(delayMs / 1000)}s (${attempt + 1}/${maxRetries})...`,
      );
      await delay(delayMs);
    }
  }
}

function isRetryableDatabaseError(error) {
  const retryableCodes = new Set([
    "40001", // CockroachDB serialization retry
    "40003", // statement completion unknown
    "53300", // too many connections
    "57P01", // admin shutdown
    "57P02", // crash shutdown
    "57P03", // cannot connect now
    "08000",
    "08001",
    "08003",
    "08004",
    "08006",
    "08007",
    "08P01",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETDOWN",
    "ENETUNREACH",
    "EPIPE",
    "ETIMEDOUT",
  ]);
  if (retryableCodes.has(error?.code)) return true;

  const message = String(error?.message ?? error).toLowerCase();
  return [
    "connection terminated unexpectedly",
    "connection terminated",
    "connection closed",
    "connection reset",
    "connection timeout",
    "connect timeout",
    "socket hang up",
    "server closed the connection",
    "client has already been closed",
    "the database system is starting up",
    "restart transaction",
  ].some((part) => message.includes(part));
}

function retryDelayMs(attempt) {
  const exponentialDelay = Math.min(
    MAX_RETRY_DELAY_MS,
    1_000 * (2 ** attempt),
  );
  return exponentialDelay + Math.floor(Math.random() * 500);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    copyChunkSize: 5_000,
    mode: "copy",
    deferSearchIndex: false,
    force: false,
    maxRetries: DEFAULT_MAX_RETRIES,
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
        Math.min(20_000, Number(argv[++index]) || 5_000),
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
    } else if (value === "--max-retries") {
      const parsedMaxRetries = Number(argv[++index]);
      result.maxRetries = Math.max(
        0,
        Math.min(
          100,
          Number.isFinite(parsedMaxRetries)
            ? Math.trunc(parsedMaxRetries)
            : DEFAULT_MAX_RETRIES,
        ),
      );
    } else {
      result.files.push(value);
    }
  }
  return result;
}
