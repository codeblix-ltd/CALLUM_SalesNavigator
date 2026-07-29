"use node";

import pg from "pg";

let pool: pg.Pool | null = null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.COCKROACH_DATABASE_URL;
  if (!connectionString) {
    throw new Error("COCKROACH_DATABASE_URL is not configured.");
  }
  pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 3,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    options: "--statement_timeout=15000",
  });
  return pool;
}
