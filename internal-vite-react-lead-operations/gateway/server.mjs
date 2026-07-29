import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServer, GatewayError } from "./app-server-client.mjs";
import { EncryptedAuthStore } from "./auth-store.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const config = readConfig();
const authStore = new EncryptedAuthStore({
  databaseUrl: config.databaseUrl,
  encryptionKey: config.encryptionKey,
  codexHome: config.codexHome,
  disabled: config.disableAuthBackup,
});
await authStore.initialize();
const restored = await authStore.restoreIfMissing();
if (restored) console.log("[gateway] Restored encrypted Codex auth backup.");

const codex = new CodexAppServer({
  codexHome: config.codexHome,
  model: config.model,
  safeWorkspace: path.join(config.codexHome, "empty-workspace"),
  onAuthChanged: () => authStore.backupIfPresent(),
});
await codex.start();

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;
    if (statusCode >= 500) {
      console.error(`[gateway] ${error?.stack ?? error}`);
    }
    sendJson(response, statusCode, {
      error: statusCode >= 500
        ? "The Codex gateway could not complete the request."
        : error.message,
    });
  }
});
server.requestTimeout = 130_000;
server.headersTimeout = 10_000;
server.listen(config.port, config.host, () => {
  console.log(
    `[gateway] Listening on http://${config.host}:${config.port} with ${config.model}.`,
  );
});

codex.on("stopped", () => {
  void shutdown(1);
});
process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }
  assertAuthorized(request);

  if (request.method === "GET" && url.pathname === "/v1/status") {
    const result = await codex.readAccount();
    sendJson(response, 200, {
      connected: result.account?.type === "chatgpt",
      account: result.account?.type === "chatgpt"
        ? {
            email: result.account.email ?? null,
            planType: result.account.planType ?? "unknown",
          }
        : null,
      model: config.model,
      queuedDrafts: codex.queuedDrafts,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/device/start") {
    sendJson(response, 200, await codex.startDeviceLogin());
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/auth/device/status") {
    const loginId = url.searchParams.get("loginId")?.trim();
    if (!loginId || loginId.length > 200) {
      throw new GatewayError(400, "A valid loginId is required.");
    }
    sendJson(response, 200, await codex.getDeviceLoginStatus(loginId));
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
    await codex.logout();
    await authStore.clear();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/drafts") {
    const body = await readJson(request);
    const requestId = requiredString(body.requestId, "requestId", 200);
    const scoutId = requiredString(body.scoutId, "scoutId", 200);
    const postText = requiredString(body.postText, "postText", 8_000);
    if (postText.length < 30) {
      throw new GatewayError(
        400,
        "postText must be between 30 and 8,000 characters.",
      );
    }
    sendJson(
      response,
      200,
      await codex.enqueueDraft({ requestId, scoutId, postText }),
    );
    return;
  }

  throw new GatewayError(404, "Route not found.");
}

function readConfig() {
  const databaseUrl = requiredEnvironment("COCKROACH_DATABASE_URL");
  const sharedSecret = requiredEnvironment("CODEX_GATEWAY_SHARED_SECRET");
  const encryptionKey = requiredEnvironment("CODEX_AUTH_ENCRYPTION_KEY");
  const model = process.env.CODEX_MODEL?.trim() || "gpt-5.6-luna";
  if (model !== "gpt-5.6-luna") {
    throw new Error("CODEX_MODEL must be gpt-5.6-luna for this project.");
  }
  const disableAuthBackup = process.env.CODEX_DISABLE_AUTH_BACKUP === "1";
  if (disableAuthBackup && process.env.NODE_ENV === "production") {
    throw new Error("CODEX_DISABLE_AUTH_BACKUP cannot be used in production.");
  }
  return {
    databaseUrl,
    sharedSecret,
    encryptionKey,
    codexHome:
      process.env.CODEX_HOME?.trim() || path.join(projectRoot, ".codex-gateway"),
    model,
    disableAuthBackup,
    host: process.env.HOST?.trim() || "0.0.0.0",
    port: readPort(process.env.PORT),
  };
}

function assertAuthorized(request) {
  const header = request.headers.authorization ?? "";
  const received = header.startsWith("Bearer ") ? header.slice(7) : "";
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(config.sharedSecret);
  if (
    receivedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    throw new GatewayError(401, "Unauthorized.");
  }
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) {
      throw new GatewayError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GatewayError(400, "Request body must be valid JSON.");
  }
}

function requiredString(value, name, maximumLength) {
  if (typeof value !== "string") {
    throw new GatewayError(400, `${name} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new GatewayError(
      400,
      `${name} must contain 1 to ${maximumLength} characters.`,
    );
  }
  return normalized;
}

function sendJson(response, statusCode, value) {
  if (response.headersSent) return;
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readPort(value) {
  const port = Number(value ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

let closing = false;
async function shutdown(exitCode) {
  if (closing) return;
  closing = true;
  server.close();
  await codex.close().catch(() => {});
  await authStore.close().catch(() => {});
  process.exit(exitCode);
}
