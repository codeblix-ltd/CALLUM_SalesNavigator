import pg from "pg";

await run().catch((error) => {
  console.error(
    `Assignment failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.COCKROACH_DATABASE_URL;
  const convexUrl = process.env.VITE_CONVEX_URL;
  const provisioningKey = process.env.SCOUT_PROVISIONING_KEY;
  if (!databaseUrl || !convexUrl || !provisioningKey) {
    throw new Error(
      "COCKROACH_DATABASE_URL, VITE_CONVEX_URL, or SCOUT_PROVISIONING_KEY is missing. Run npm run setup:secrets.",
    );
  }

  const operatorId = normalizeUsername(args.username);
  const niche = String(args.niche).trim();
  const requested = Number(args.count);
  if (
    !Number.isSafeInteger(requested) ||
    requested < 1 ||
    requested > 1_000_000
  ) {
    throw new Error("--count must be an integer between 1 and 1,000,000.");
  }

  await callConvexAction(convexUrl, "scoutAdmin:assertScout", {
    operatorId,
    provisioningKey,
  });

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: true },
    max: 2,
    connectionTimeoutMillis: 10_000,
    options: "--statement_timeout=60000",
  });

  let assigned = 0;
  let emptyAttempts = 0;
  try {
    const nicheResult = await pool.query(
      "SELECT lead_count::FLOAT8 AS lead_count FROM niches WHERE name = $1",
      [niche],
    );
    if (!nicheResult.rows[0]) {
      throw new Error(`Niche not found: ${niche}`);
    }

    while (assigned < requested) {
      const batchSize = Math.min(2_000, requested - assigned);
      const result = await pool.query(
        `INSERT INTO lead_assignments (lead_id, operator_id, status)
         SELECT ln.lead_id, $2, 'assigned'
           FROM lead_niches AS ln
           LEFT JOIN lead_assignments AS existing ON existing.lead_id = ln.lead_id
          WHERE ln.niche = $1 AND existing.lead_id IS NULL
          ORDER BY ln.lead_id
          LIMIT $3
         ON CONFLICT (lead_id) DO NOTHING
         RETURNING lead_id`,
        [niche, operatorId, batchSize],
      );
      const inserted = result.rowCount ?? 0;
      assigned += inserted;
      if (inserted === 0) {
        emptyAttempts += 1;
        if (emptyAttempts >= 3) break;
      } else {
        emptyAttempts = 0;
      }
    }

    const remainingResult = await pool.query(
      `SELECT count(*)::FLOAT8 AS count
         FROM lead_niches AS ln
         LEFT JOIN lead_assignments AS a ON a.lead_id = ln.lead_id
        WHERE ln.niche = $1 AND a.lead_id IS NULL`,
      [niche],
    );
    const remaining = Number(remainingResult.rows[0]?.count ?? 0);

    console.log(
      `Assigned ${assigned.toLocaleString("en-US")} previously-unassigned leads from "${niche}" to "${operatorId}".`,
    );
    console.log(
      `${remaining.toLocaleString("en-US")} unassigned leads remain in this niche.`,
    );
    if (assigned < requested) {
      console.log(
        `Requested ${requested.toLocaleString("en-US")}, but the niche did not have enough unassigned leads.`,
      );
    }
  } finally {
    await pool.end();
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`);
    }
    parsed[key] = value;
    index += 1;
  }
  if (!parsed.username || !parsed.niche || !parsed.count) {
    throw new Error(
      'Usage: npm run leads:assign -- --username scout01 --niche "Niche name" --count 10000',
    );
  }
  return parsed;
}

function normalizeUsername(value) {
  const username = String(value).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
    throw new Error("Invalid scout username.");
  }
  return username;
}

async function callConvexAction(url, actionPath, actionArgs) {
  const response = await fetch(`${url}/api/action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Convex-Client": "callum-lead-assignment-cli-0.2.0",
    },
    body: JSON.stringify({
      path: actionPath,
      format: "convex_encoded_json",
      args: [actionArgs],
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status !== "success") {
    const message = String(
      payload?.errorMessage ?? `Convex request failed (${response.status}).`,
    )
      .replace(/^.*?Uncaught (?:Error|ConvexError):\s*/s, "")
      .replace(/^(?:Uncaught (?:Error|ConvexError):\s*)+/, "")
      .split("\n")[0];
    throw new Error(message);
  }
}
