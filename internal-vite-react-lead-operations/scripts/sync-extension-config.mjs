import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env.local");
if (!existsSync(envPath)) {
  throw new Error(".env.local does not exist. Link the Convex project first.");
}

const values = new Map();
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator > 0) {
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
}

const convexUrl = values.get("VITE_CONVEX_URL");
if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is missing from .env.local.");
}

const siteUrl = convexUrl.replace(/\.convex\.cloud$/, ".convex.site");
if (siteUrl === convexUrl) {
  throw new Error("VITE_CONVEX_URL is not a standard Convex cloud URL.");
}

const output = `globalThis.LEADS_EXTENSION_CONFIG = Object.freeze({\n  CONVEX_URL: ${JSON.stringify(convexUrl)},\n  CONVEX_SITE_URL: ${JSON.stringify(siteUrl)},\n});\n`;
writeFileSync(path.join(projectRoot, "chrome-extension", "config.js"), output, "utf8");
console.log(`Extension configured for ${siteUrl}.`);
