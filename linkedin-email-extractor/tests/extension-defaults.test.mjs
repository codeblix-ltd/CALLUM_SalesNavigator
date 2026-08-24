import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("database leads and a five-minute timeout are the primary defaults", async () => {
  const popup = await readFile(new URL("popup.html", root), "utf8");
  const popupScript = await readFile(new URL("popup.js", root), "utf8");
  const background = await readFile(new URL("background.js", root), "utf8");
  const workEmailActions = await readFile(
    new URL("../internal-vite-react-lead-operations/convex/workEmails.ts", root),
    "utf8",
  );

  assert.match(popup, /name="source" value="database" checked/);
  assert.match(popup, /id="dbNiche"/);
  assert.match(popup, /Niche — choose one/);
  assert.match(popup, /id="dbLimit"[^>]*value="100"/);
  assert.match(popup, /value="300000" selected>5 minutes/);
  assert.doesNotMatch(popup.match(/<textarea id="urls"[^>]*>/)?.[0] || "", /placeholder=/);
  assert.match(background, /timeoutMs: 300000/);
  assert.match(background, /Number\(limit\) \|\| 100/);
  assert.match(background, /startDatabaseRun\(message\.niche, message\.limit/);
  assert.match(background, /older database queue was not limited to one niche/);
  assert.match(popupScript, /workEmails:listQueueNiches/);
  assert.match(popupScript, /niche,/);
  assert.match(workEmailActions, /args: \{ limit: v\.number\(\), niche: v\.string\(\) \}/);
  assert.match(workEmailActions, /ln\.niche = \$1/);
});

test("the popup includes a persistent run-time counter", async () => {
  const popup = await readFile(new URL("popup.html", root), "utf8");
  const popupScript = await readFile(new URL("popup.js", root), "utf8");

  assert.match(popup, /id="runTime"/);
  assert.match(popup, /id="runTimeLabel"/);
  assert.match(popupScript, /getRunDurationMs/);
  assert.match(popupScript, /setInterval/);
});

test("the extension includes its processing window and completion sound pages", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const background = await readFile(new URL("background.js", root), "utf8");
  const workerPage = await readFile(new URL("worker.html", root), "utf8");
  const soundPage = await readFile(new URL("offscreen.html", root), "utf8");

  assert.ok(manifest.permissions.includes("offscreen"));
  assert.ok(manifest.permissions.includes("alarms"));
  assert.match(background, /chrome\.runtime\.getContexts/);
  assert.match(background, /chrome\.alarms\.create\(RATE_LIMIT_RETRY_ALARM, \{ when: retryAt \}\)/);
  assert.doesNotMatch(background, /chrome\.offscreen\.hasDocument/);
  assert.match(workerPage, /separate window/i);
  assert.match(soundPage, /offscreen\.js/);
  assert.equal(manifest.minimum_chrome_version, "118");
});
