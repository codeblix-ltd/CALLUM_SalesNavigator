import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const password = process.env.CRDB_PASSWORD;
if (!password) {
  throw new Error("Run with CRDB_PASSWORD set in the process environment.");
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env.local");
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const values = new Map();

for (const line of existing.split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator > 0 && !line.trimStart().startsWith("#")) {
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
}

const encodedPassword = encodeURIComponent(password);
const databaseUrl =
  `postgresql://esl:${encodedPassword}` +
  "@draco-quokka-30499.j77.aws-us-east-1.cockroachlabs.cloud:26257/" +
  "defaultdb?sslmode=verify-full";
const shouldRotateToken = process.env.ROTATE_LEADS_API_TOKEN === "1";
const accessToken = !shouldRotateToken && values.get("LEADS_API_TOKEN")
  ? values.get("LEADS_API_TOKEN")
  : randomBytes(32).toString("base64url");

values.set("COCKROACH_DATABASE_URL", databaseUrl);
values.set("LEADS_API_TOKEN", accessToken);

const preservedComments = existing
  .split(/\r?\n/)
  .filter((line) => line.trimStart().startsWith("#"));
const output = [
  ...preservedComments,
  ...[...values.entries()].map(([key, value]) => `${key}=${value}`),
  "",
].join("\n");

writeFileSync(envPath, output, { encoding: "utf8", mode: 0o600 });

const convexCli = path.join(projectRoot, "node_modules", "convex", "bin", "main.js");
for (const [name, value] of [
  ["COCKROACH_DATABASE_URL", databaseUrl],
  ["LEADS_API_TOKEN", accessToken],
]) {
  execFileSync(process.execPath, [convexCli, "env", "set", name, value], {
    cwd: projectRoot,
    stdio: ["ignore", "inherit", "inherit"],
  });
}

console.log(
  shouldRotateToken
    ? "Server secrets are configured and the lead access token was rotated."
    : "Server secrets are configured locally and in Convex.",
);
