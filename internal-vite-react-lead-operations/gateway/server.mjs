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
  const corsAllowed = applyCors(request, response);
  if (request.method === "OPTIONS") {
    if (!corsAllowed) throw new GatewayError(403, "Origin is not allowed.");
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }
  const accessScope = authorize(request);

  if (request.method === "GET" && url.pathname === "/v1/status") {
    requireAnyScope(accessScope, ["admin", "extension"]);
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
    requireAnyScope(accessScope, ["admin", "extension"]);
    sendJson(response, 200, await codex.startDeviceLogin());
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/auth/device/status") {
    requireAnyScope(accessScope, ["admin", "extension"]);
    const loginId = url.searchParams.get("loginId")?.trim();
    if (!loginId || loginId.length > 200) {
      throw new GatewayError(400, "A valid loginId is required.");
    }
    sendJson(response, 200, await codex.getDeviceLoginStatus(loginId));
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
    requireScope(accessScope, "admin");
    await codex.logout();
    await authStore.clear();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/drafts") {
    requireScope(accessScope, "admin");
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

  if (
    request.method === "POST" &&
    url.pathname === "/v1/flippa/comments/draft"
  ) {
    requireAnyScope(accessScope, ["admin", "extension"]);
    const body = await readJson(request);
    const requestId = requiredString(body.requestId, "requestId", 200);
    const listingId = requiredString(body.listingId, "listingId", 100);
    const title = requiredString(body.title, "title", 500);
    const tagline = optionalString(body.tagline, "tagline", 1_500);
    const description = requiredString(body.description, "description", 24_000);
    if (description.length < 40) {
      throw new GatewayError(
        400,
        "description must be between 40 and 24,000 characters.",
      );
    }
    const previousComments = readPreviousComments(body.previousComments);
    sendJson(
      response,
      200,
      await codex.enqueueFlippaDraft({
        requestId,
        listingId,
        title,
        tagline,
        description,
        previousComments,
      }),
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/veblen/community-matches"
  ) {
    requireAnyScope(accessScope, ["admin", "veblen"]);
    const body = await readJson(request);
    const requestId = requiredString(body.requestId, "requestId", 200);
    const days = readDays(body.days);
    const includeSameBoard = readBoolean(body.includeSameBoard, "includeSameBoard");
    const reports = readCommunityReports(body.reports);
    const actions = readCommunityActions(body.actions);
    sendJson(
      response,
      200,
      await codex.enqueueCommunityMatches({
        requestId,
        days,
        includeSameBoard,
        reports,
        actions,
      }),
    );
    return;
  }

  throw new GatewayError(404, "Route not found.");
}

function readConfig() {
  const databaseUrl = requiredEnvironment("COCKROACH_DATABASE_URL");
  const sharedSecret = requiredEnvironment("CODEX_GATEWAY_SHARED_SECRET");
  const extensionToken = process.env.CODEX_GATEWAY_EXTENSION_TOKEN?.trim() || null;
  const veblenToken = process.env.CODEX_GATEWAY_VEBLEN_TOKEN?.trim() || null;
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
    extensionToken,
    veblenToken,
    allowedOrigins: new Set(
      (process.env.CODEX_GATEWAY_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    encryptionKey,
    codexHome:
      process.env.CODEX_HOME?.trim() || path.join(projectRoot, ".codex-gateway"),
    model,
    disableAuthBackup,
    host: process.env.HOST?.trim() || "0.0.0.0",
    port: readPort(process.env.PORT),
  };
}

function authorize(request) {
  const header = request.headers.authorization ?? "";
  const received = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (safeTokenEqual(received, config.sharedSecret)) return "admin";
  if (
    config.extensionToken &&
    safeTokenEqual(received, config.extensionToken)
  ) return "extension";
  if (
    config.veblenToken &&
    safeTokenEqual(received, config.veblenToken)
  ) return "veblen";
  throw new GatewayError(401, "Unauthorized.");
}

function requireScope(actual, expected) {
  if (actual !== expected) throw new GatewayError(403, "Forbidden.");
}

function requireAnyScope(actual, allowed) {
  if (!allowed.includes(actual)) throw new GatewayError(403, "Forbidden.");
}

function safeTokenEqual(received, expected) {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const allowed =
    /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
    config.allowedOrigins.has(origin);
  if (!allowed) return false;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    "Authorization, Content-Type",
  );
  response.setHeader("access-control-max-age", "600");
  return true;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 524_288) {
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

function optionalString(value, name, maximumLength) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw new GatewayError(400, `${name} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new GatewayError(
      400,
      `${name} must contain at most ${maximumLength} characters.`,
    );
  }
  return normalized;
}

function readPreviousComments(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new GatewayError(
      400,
      "previousComments must be an array containing at most 20 comments.",
    );
  }
  return value.map((comment, index) => {
    if (!comment || typeof comment !== "object" || Array.isArray(comment)) {
      throw new GatewayError(
        400,
        `previousComments[${index}] must be an object.`,
      );
    }
    return {
      author: optionalString(
        comment.author,
        `previousComments[${index}].author`,
        120,
      ) || "Unknown",
      postedAt: optionalString(
        comment.postedAt,
        `previousComments[${index}].postedAt`,
        120,
      ) || "Unknown date",
      content: requiredString(
        comment.content,
        `previousComments[${index}].content`,
        1_500,
      ),
    };
  });
}

function readDays(value) {
  if (![30, 60, 120, 365].includes(value)) {
    throw new GatewayError(400, "days must be 30, 60, 120, or 365.");
  }
  return value;
}

function readBoolean(value, name) {
  if (typeof value !== "boolean") {
    throw new GatewayError(400, `${name} must be a boolean.`);
  }
  return value;
}

function readCommunityReports(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 80) {
    throw new GatewayError(400, "reports must contain between 2 and 80 items.");
  }
  return value.map((report, index) => {
    if (!report || typeof report !== "object" || Array.isArray(report)) {
      throw new GatewayError(400, `reports[${index}] must be an object.`);
    }
    const content = requiredString(report.content, `reports[${index}].content`, 6_000);
    if (content.length < 24) {
      throw new GatewayError(400, `reports[${index}].content is too short.`);
    }
    return {
      reportId: requiredString(report.reportId, `reports[${index}].reportId`, 120),
      memberRef: requiredString(report.memberRef, `reports[${index}].memberRef`, 40),
      boardRef: requiredString(report.boardRef, `reports[${index}].boardRef`, 40),
      month: requiredString(report.month, `reports[${index}].month`, 120),
      submittedAt: requiredString(report.submittedAt, `reports[${index}].submittedAt`, 120),
      status: requiredString(report.status, `reports[${index}].status`, 60),
      content,
    };
  });
}

function readCommunityActions(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 160) {
    throw new GatewayError(400, "actions must be an array containing at most 160 items.");
  }
  return value.map((action, index) => {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      throw new GatewayError(400, `actions[${index}] must be an object.`);
    }
    return {
      actionRef: requiredString(action.actionRef, `actions[${index}].actionRef`, 40),
      memberRef: requiredString(action.memberRef, `actions[${index}].memberRef`, 40),
      boardRef: requiredString(action.boardRef, `actions[${index}].boardRef`, 40),
      task: requiredString(action.task, `actions[${index}].task`, 700),
      completed: readBoolean(action.completed, `actions[${index}].completed`),
      status: requiredString(action.status, `actions[${index}].status`, 60),
      date: requiredString(action.date, `actions[${index}].date`, 120),
    };
  });
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
