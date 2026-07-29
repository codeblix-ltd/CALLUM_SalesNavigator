import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.COCKROACH_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("COCKROACH_DATABASE_URL is missing from .env.local");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(scriptDirectory, "..", "database", "schema.sql");
const schema = await readFile(schemaPath, "utf8");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
});

try {
  await client.connect();
  await client.query(schema);
  const result = await client.query(
    "SELECT current_database() AS database_name, version() AS version",
  );
  console.log(`Schema ready in ${result.rows[0].database_name}.`);
} finally {
  await client.end();
}
