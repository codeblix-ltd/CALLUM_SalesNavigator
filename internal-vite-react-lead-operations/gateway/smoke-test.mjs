import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sharedSecret = process.env.CODEX_GATEWAY_SHARED_SECRET;
if (!sharedSecret) {
  throw new Error("Run this test with .env.local so the gateway secret is set.");
}

const temporaryHome = await mkdtemp(
  path.join(os.tmpdir(), "callum-codex-gateway-"),
);
const port = 8791;
const child = spawn(process.execPath, ["gateway/server.mjs"], {
  cwd: path.resolve("."),
  env: {
    ...process.env,
    PORT: String(port),
    CODEX_HOME: temporaryHome,
    CODEX_DISABLE_AUTH_BACKUP: "1",
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
    "Gateway smoke passed: health, protected status, and official device-login start.",
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
