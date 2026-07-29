import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const password = process.env.CRDB_PASSWORD;
const databaseUrl = password
  ? `postgresql://esl:${encodeURIComponent(password)}` +
    "@draco-quokka-30499.j77.aws-us-east-1.cockroachlabs.cloud:26257/" +
    "defaultdb?sslmode=verify-full"
  : values.get("COCKROACH_DATABASE_URL");

if (!databaseUrl) {
  throw new Error(
    "Set CRDB_PASSWORD or add COCKROACH_DATABASE_URL to .env.local.",
  );
}
const shouldRotateToken = process.env.ROTATE_LEADS_API_TOKEN === "1";
const accessToken = !shouldRotateToken && values.get("LEADS_API_TOKEN")
  ? values.get("LEADS_API_TOKEN")
  : randomBytes(32).toString("base64url");
const provisioningKey = values.get("SCOUT_PROVISIONING_KEY")
  ?? randomBytes(32).toString("base64url");

values.set("COCKROACH_DATABASE_URL", databaseUrl);
values.set("LEADS_API_TOKEN", accessToken);
values.set("SCOUT_PROVISIONING_KEY", provisioningKey);
if (process.env.OPENAI_API_KEY) {
  values.set("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
}

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
  ["SCOUT_PROVISIONING_KEY", provisioningKey],
  ...(process.env.OPENAI_API_KEY
    ? [["OPENAI_API_KEY", process.env.OPENAI_API_KEY]]
    : []),
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
