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
const provisioningKey = values.get("SCOUT_PROVISIONING_KEY")
  ?? randomBytes(32).toString("base64url");
const gatewaySharedSecret = values.get("CODEX_GATEWAY_SHARED_SECRET")
  ?? randomBytes(32).toString("base64url");
const authEncryptionKey = values.get("CODEX_AUTH_ENCRYPTION_KEY")
  ?? randomBytes(32).toString("base64");
const gatewayUrl = process.env.CODEX_GATEWAY_URL?.trim()
  || values.get("CODEX_GATEWAY_URL")?.trim();
const hadLegacyOpenAiKey = values.delete("OPENAI_API_KEY");
values.delete("LEADS_API_TOKEN");

values.set("COCKROACH_DATABASE_URL", databaseUrl);
values.set("SCOUT_PROVISIONING_KEY", provisioningKey);
values.set("CODEX_GATEWAY_SHARED_SECRET", gatewaySharedSecret);
values.set("CODEX_AUTH_ENCRYPTION_KEY", authEncryptionKey);
if (gatewayUrl) values.set("CODEX_GATEWAY_URL", gatewayUrl.replace(/\/+$/, ""));

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
  ["SCOUT_PROVISIONING_KEY", provisioningKey],
  ["CODEX_GATEWAY_SHARED_SECRET", gatewaySharedSecret],
  ...(gatewayUrl
    ? [["CODEX_GATEWAY_URL", gatewayUrl.replace(/\/+$/, "")]]
    : []),
]) {
  execFileSync(process.execPath, [convexCli, "env", "set", name, value], {
    cwd: projectRoot,
    stdio: ["ignore", "inherit", "inherit"],
  });
}
if (hadLegacyOpenAiKey) {
  execFileSync(process.execPath, [convexCli, "env", "remove", "OPENAI_API_KEY"], {
    cwd: projectRoot,
    stdio: ["ignore", "inherit", "inherit"],
  });
}

console.log("Server secrets are configured locally and in Convex.");
if (!gatewayUrl) {
  console.log(
    "CODEX_GATEWAY_URL is not set yet. Add the VPS HTTPS URL, then rerun this command.",
  );
}
