import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  COMMUNITY_MATCH_OUTPUT_SCHEMA,
  FIRST_DM_SYSTEM_PROMPT,
  FLIPPA_SYSTEM_PROMPT,
  LUNA_SYSTEM_PROMPT,
  VEBLEN_MATCH_SYSTEM_PROMPT,
  normalizeFlippaDraft,
  normalizeFirstDmDraft,
  normalizeLunaDraft,
} from "./app-server-client.mjs";

if (!LUNA_SYSTEM_PROMPT.includes("clear, everyday English")) {
  throw new Error("Luna's system prompt is missing the plain-English rule.");
}
if (!LUNA_SYSTEM_PROMPT.includes("Never use em dashes")) {
  throw new Error("Luna's system prompt is missing the em-dash rule.");
}
if (LUNA_SYSTEM_PROMPT.includes("\u2014")) {
  throw new Error("Luna's system prompt contains an em dash.");
}
if (normalizeLunaDraft("Clear\u2014direct") !== "Clear, direct") {
  throw new Error("Luna's output guard did not remove an em dash.");
}
if (
  !FLIPPA_SYSTEM_PROMPT.includes("strong observation") ||
  !FLIPPA_SYSTEM_PROMPT.includes("previous comments") ||
  !FLIPPA_SYSTEM_PROMPT.includes("Never use em dashes")
) {
  throw new Error("The Flippa prompt is missing its style or duplicate guard.");
}
if (FLIPPA_SYSTEM_PROMPT.includes("\u2014")) {
  throw new Error("The Flippa prompt contains an em dash.");
}
if (normalizeFlippaDraft('```text\n"Clear\u2014direct"\n```') !== "Clear, direct") {
  throw new Error("The Flippa output guard did not normalize wrapper text.");
}
if (
  !FIRST_DM_SYSTEM_PROMPT.includes("after a connection has accepted") ||
  !FIRST_DM_SYSTEM_PROMPT.includes("exactly one useful") ||
  !FIRST_DM_SYSTEM_PROMPT.includes("Do not hard-sell")
) {
  throw new Error("The First DM prompt is missing an acceptance or safety rule.");
}
if (FIRST_DM_SYSTEM_PROMPT.includes("\u2014")) {
  throw new Error("The First DM prompt contains an em dash.");
}
if (
  normalizeFirstDmDraft('Draft: "Hi Sam, thanks for connecting.\nHow is your team growing?"') !==
  "Hi Sam, thanks for connecting. How is your team growing?"
) {
  throw new Error("The First DM output guard did not normalize wrapper text.");
}
if (
  !VEBLEN_MATCH_SYSTEM_PROMPT.includes("admin-review pilot") ||
  !VEBLEN_MATCH_SYSTEM_PROMPT.includes("Never include or infer names") ||
  COMMUNITY_MATCH_OUTPUT_SCHEMA.properties.matches.maxItems !== 12
) {
  throw new Error("The Veblen matching prompt or output contract is incomplete.");
}

const sharedSecret = process.env.CODEX_GATEWAY_SHARED_SECRET;
if (!sharedSecret) {
  throw new Error("Run this test with .env.local so the gateway secret is set.");
}

const temporaryHome = await mkdtemp(
  path.join(os.tmpdir(), "callum-codex-gateway-"),
);
const port = 8791;
const extensionToken = "smoke-extension-token-1234567890";
const veblenToken = "smoke-veblen-token-1234567890";
const child = spawn(process.execPath, ["gateway/server.mjs"], {
  cwd: path.resolve("."),
  env: {
    ...process.env,
    PORT: String(port),
    CODEX_HOME: temporaryHome,
    CODEX_DISABLE_AUTH_BACKUP: "1",
    CODEX_GATEWAY_EXTENSION_TOKEN: extensionToken,
    CODEX_GATEWAY_VEBLEN_TOKEN: veblenToken,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += String(chunk);
});
child.stderr.on("data", (chunk) => {
  output += String(chunk);
});

try {
  await waitUntilHealthy(port, child);
  const headers = { authorization: `Bearer ${sharedSecret}` };
  const unauthorized = await fetch(`http://127.0.0.1:${port}/v1/status`, {
    headers: { authorization: "Bearer invalid" },
  });
  if (unauthorized.status !== 401) {
    throw new Error("The protected routes accepted an invalid gateway secret.");
  }
  const status = await getJson(`http://127.0.0.1:${port}/v1/status`, {
    headers,
  });
  if (
    typeof status.connected !== "boolean" ||
    status.model !== "gpt-5.6-luna"
  ) {
    throw new Error("The protected status contract failed.");
  }

  const extensionHeaders = { authorization: `Bearer ${extensionToken}` };
  const extensionStatus = await getJson(
    `http://127.0.0.1:${port}/v1/status`,
    { headers: extensionHeaders },
  );
  if (extensionStatus.model !== "gpt-5.6-luna") {
    throw new Error("The scoped extension token could not read status.");
  }
  const forbiddenLogout = await fetch(
    `http://127.0.0.1:${port}/v1/auth/logout`,
    { method: "POST", headers: extensionHeaders },
  );
  if (forbiddenLogout.status !== 403) {
    throw new Error("The scoped extension token could log out the subscription.");
  }
  const invalidFlippaDraft = await fetch(
    `http://127.0.0.1:${port}/v1/flippa/comments/draft`,
    {
      method: "POST",
      headers: {
        ...extensionHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requestId: "smoke-flippa",
        listingId: "123",
        title: "Example business",
        description: "Too short",
        previousComments: [],
      }),
    },
  );
  if (invalidFlippaDraft.status !== 400) {
    throw new Error("The Flippa route did not validate its request contract.");
  }
  const veblenHeaders = { authorization: `Bearer ${veblenToken}` };
  const forbiddenVeblenStatus = await fetch(
    `http://127.0.0.1:${port}/v1/status`,
    { headers: veblenHeaders },
  );
  if (forbiddenVeblenStatus.status !== 403) {
    throw new Error("The scoped Veblen token could read subscription status.");
  }
  const forbiddenVeblenLogout = await fetch(
    `http://127.0.0.1:${port}/v1/auth/logout`,
    { method: "POST", headers: veblenHeaders },
  );
  if (forbiddenVeblenLogout.status !== 403) {
    throw new Error("The scoped Veblen token could log out the subscription.");
  }
  const forbiddenVeblenFlippa = await fetch(
    `http://127.0.0.1:${port}/v1/flippa/comments/draft`,
    {
      method: "POST",
      headers: { ...veblenHeaders, "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (forbiddenVeblenFlippa.status !== 403) {
    throw new Error("The scoped Veblen token could use the Flippa route.");
  }
  const invalidVeblenMatch = await fetch(
    `http://127.0.0.1:${port}/v1/veblen/community-matches`,
    {
      method: "POST",
      headers: { ...veblenHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "smoke-veblen",
        days: 60,
        includeSameBoard: false,
        reports: [],
        actions: [],
      }),
    },
  );
  if (invalidVeblenMatch.status !== 400) {
    throw new Error("The Veblen route did not validate its request contract.");
  }
  const preflight = await fetch(
    `http://127.0.0.1:${port}/v1/flippa/comments/draft`,
    {
      method: "OPTIONS",
      headers: {
        origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "access-control-request-method": "POST",
      },
    },
  );
  if (
    preflight.status !== 204 ||
    preflight.headers.get("access-control-allow-origin") !==
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  ) {
    throw new Error("Chrome extension CORS preflight failed.");
  }

  const login = await getJson(
    `http://127.0.0.1:${port}/v1/auth/device/start`,
    { method: "POST", headers },
  );
  if (
    login.connected !== true &&
    (!login.loginId || !login.userCode || !login.verificationUrl)
  ) {
    throw new Error("The official device-login start contract failed.");
  }
  console.log(
    "Gateway smoke passed: auth scopes, CORS, Flippa and Veblen validation, and official device login.",
  );
} catch (error) {
  throw new Error(`${error.message}\nGateway output:\n${output.slice(-4_000)}`);
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  await rm(temporaryHome, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
}

async function waitUntilHealthy(portNumber, processHandle) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error("The gateway exited before becoming healthy.");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/healthz`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The gateway did not become healthy within 20 seconds.");
}

async function getJson(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}
