import pg from "pg";

const nicheToDelete = parseNicheArg(process.argv.slice(2));
if (!nicheToDelete) {
  console.error("❌ Error: Specify a niche using --niche \"Niche Name\"");
  process.exit(1);
}

const databaseUrl = process.env.COCKROACH_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("COCKROACH_DATABASE_URL is missing from .env.local");
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
});

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log(`Deleting niche "${nicheToDelete}"...`);

    // 1. Remove niche associations
    const nicheLinks = await client.query(
      "DELETE FROM lead_niches WHERE niche = $1 RETURNING lead_id",
      [nicheToDelete]
    );

    // 2. Remove import history for this niche
    await client.query("DELETE FROM lead_imports WHERE niche = $1", [nicheToDelete]);

    // 3. Delete from niches table
    await client.query("DELETE FROM niches WHERE name = $1", [nicheToDelete]);

    // 4. Delete leads that no longer belong to ANY niche (orphaned leads)
    const deletedLeads = await client.query(
      "DELETE FROM leads WHERE id NOT IN (SELECT DISTINCT lead_id FROM lead_niches)"
    );

    // 5. Update global total lead stats
    await client.query(
      `UPSERT INTO lead_stats (key, total_count, updated_at)
       SELECT 'all', count(*), now() FROM leads`
    );

    await client.query("COMMIT");

    console.log(`✅ Niche "${nicheToDelete}" deleted!`);
    console.log(`🗑️ Removed ${deletedLeads.rowCount.toLocaleString()} leads from the database.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}

function parseNicheArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--niche" && argv[i + 1]) {
      return argv[i + 1].trim();
    }
  }
  return "";
}