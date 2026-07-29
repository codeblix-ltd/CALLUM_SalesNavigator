import pg from "pg";

const databaseUrl = process.env.COCKROACH_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("COCKROACH_DATABASE_URL is missing from .env.local");
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
});

try {
  await client.connect();
  console.log("Clearing all lead records, niches, imports, and stats...");
  await client.query(`
    TRUNCATE TABLE lead_assignment_events, lead_assignments, operator_settings, lead_niches, lead_imports, leads, niches CASCADE;
    UPSERT INTO lead_stats (key, total_count, updated_at) VALUES ('all', 0, now());
  `);
  console.log("Database reset complete! Total lead count is now 0.");
} catch (error) {
  console.error("Failed to reset database:", error);
} finally {
  await client.end();
}
