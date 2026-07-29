import { randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const args = parseArgs(process.argv.slice(2));
const username = normalizeUsername(args.username);
const password = args.password || generatePassword();
const convexUrl = process.env.VITE_CONVEX_URL;
const provisioningKey = process.env.SCOUT_PROVISIONING_KEY;

if (!convexUrl || !provisioningKey) {
  throw new Error(
    "VITE_CONVEX_URL or SCOUT_PROVISIONING_KEY is missing. Run npm run setup:secrets first.",
  );
}

const client = new ConvexHttpClient(convexUrl);
const signIn = makeFunctionReference("auth:signIn");
const signOut = makeFunctionReference("auth:signOut");
const result = await client.action(signIn, {
  provider: "password",
  params: {
    username,
    password,
    flow: "signUp",
    provisioningKey,
  },
});

if (!result?.tokens?.token) {
  throw new Error("Convex Auth did not return a scout session.");
}

client.setAuth(result.tokens.token);
await client.action(signOut, {});

console.log(
  "Scout account created. Save this password now; it will not be shown again.",
);
console.log(`Username: ${username}`);
console.log(`Password: ${password}`);

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
  if (!parsed.username) {
    throw new Error(
      "Usage: npm run scout:create -- --username scout01 [--password StrongPassword123]",
    );
  }
  return parsed;
}

function normalizeUsername(value) {
  const username = String(value).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
    throw new Error(
      "Username must be 3-40 characters using letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return username;
}

function generatePassword() {
  return `Ca${randomBytes(18).toString("base64url")}7`;
}
