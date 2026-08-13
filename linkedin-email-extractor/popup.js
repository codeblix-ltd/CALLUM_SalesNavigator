import { WorkEmailApi } from "./api.js";
import { formatRunDuration, getRunDurationMs } from "./run-timer.js";

const els = {
  loginForm: document.querySelector("#loginForm"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  signedInRow: document.querySelector("#signedInRow"),
  signedInName: document.querySelector("#signedInName"),
  signOut: document.querySelector("#signOut"),
  pasteSource: document.querySelector("#pasteSource"),
  databaseSource: document.querySelector("#databaseSource"),
  dbLimit: document.querySelector("#dbLimit"),
  urls: document.querySelector("#urls"),
  concurrency: document.querySelector("#concurrency"),
  staggerMs: document.querySelector("#staggerMs"),
  timeoutMs: document.querySelector("#timeoutMs"),
  keepFailedTabs: document.querySelector("#keepFailedTabs"),
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  retry: document.querySelector("#retry"),
  clear: document.querySelector("#clear"),
  copyJson: document.querySelector("#copyJson"),
  exportCsv: document.querySelector("#exportCsv"),
  message: document.querySelector("#message"),
  runBadge: document.querySelector("#runBadge"),
  totalCount: document.querySelector("#totalCount"),
  doneCount: document.querySelector("#doneCount"),
  foundCount: document.querySelector("#foundCount"),
  notFoundCount: document.querySelector("#notFoundCount"),
  errorCount: document.querySelector("#errorCount"),
  runTime: document.querySelector("#runTime"),
  runTimeLabel: document.querySelector("#runTimeLabel"),
  resultsBody: document.querySelector("#resultsBody")
};

let currentState = null;
let signedIn = false;

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Extension command failed.");
  return response;
}

function setMessage(text = "", kind = "") {
  els.message.textContent = text;
  els.message.className = `message ${kind}`.trim();
}

function parseUrls() {
  return els.urls.value
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function settingsFromForm() {
  return {
    concurrency: Number(els.concurrency.value),
    staggerMs: Number(els.staggerMs.value),
    timeoutMs: Number(els.timeoutMs.value),
    maxRetries: 3,
    keepFailedTabs: els.keepFailedTabs.checked
  };
}

function applySettings(settings = {}) {
  els.concurrency.value = String(settings.concurrency || 4);
  els.staggerMs.value = String(settings.staggerMs || 1800);
  els.timeoutMs.value = String(settings.timeoutMs || 300000);
  els.keepFailedTabs.checked = settings.keepFailedTabs !== false;
}

function isDone(status) {
  return ["found", "not_found", "error", "timeout", "stopped"].includes(status);
}

function displayStatus(job) {
  if (job.status === "queued" && job.rateLimitRetryCount) {
    return "Rate-limit retry waiting";
  }
  if (job.status === "queued" && job.retryCount) {
    return `Retry ${job.retryCount}/${currentState?.settings?.maxRetries || 3} waiting`;
  }
  const labels = {
    queued: "Queued",
    starting: "Starting",
    resolving: "Resolving URL",
    running: "Running",
    capturing: "Capturing",
    found: "Found",
    not_found: "Not found",
    error: "Error",
    timeout: "Timeout",
    stopped: "Stopped"
  };
  return labels[job.status] || job.status;
}

function resultValue(job, key) {
  return job.result?.[key] ?? "";
}

function renderRunTime(state, now = Date.now()) {
  const leadCount = state?.jobs?.length || 0;
  els.runTime.textContent = formatRunDuration(getRunDurationMs(state, now));
  els.runTimeLabel.textContent = leadCount === 1
    ? "Time for 1 lead"
    : leadCount > 1
      ? `Time for ${leadCount} leads`
      : "Run time";
}

function render(state) {
  currentState = state;
  const jobs = state?.jobs || [];
  const running = Boolean(state?.running);
  const paused = Boolean(state?.paused);
  const done = jobs.filter((job) => isDone(job.status)).length;
  const found = jobs.filter((job) => job.status === "found").length;
  const notFound = jobs.filter((job) => job.status === "not_found").length;
  const errors = jobs.filter((job) => ["error", "timeout"].includes(job.status)).length;
  const retryable = jobs.some((job) => ["queued", "error", "timeout", "stopped"].includes(job.status));

  els.runBadge.textContent = running ? "Running" : paused ? "Paused" : "Idle";
  els.runBadge.className = `badge ${running ? "running" : paused ? "paused" : "idle"}`;
  els.start.disabled = running || paused || !signedIn;
  els.stop.disabled = !running;
  els.clear.disabled = running;
  els.retry.disabled = running || !signedIn || !retryable;
  els.copyJson.disabled = jobs.length === 0;
  els.exportCsv.disabled = jobs.length === 0;
  els.concurrency.disabled = running;
  els.staggerMs.disabled = running;
  els.timeoutMs.disabled = running;
  els.keepFailedTabs.disabled = running;
  els.dbLimit.disabled = running;
  for (const input of document.querySelectorAll('input[name="source"]')) input.disabled = running;

  if (paused && state.pauseReason) setMessage(state.pauseReason, "error");

  els.totalCount.textContent = jobs.length;
  els.doneCount.textContent = done;
  els.foundCount.textContent = found;
  els.notFoundCount.textContent = notFound;
  els.errorCount.textContent = errors;
  renderRunTime(state);

  if (!jobs.length) {
    els.resultsBody.innerHTML = '<tr><td colspan="10" class="empty">No jobs yet.</td></tr>';
    return;
  }

  els.resultsBody.replaceChildren(...jobs.map((job) => {
    const row = document.createElement("tr");
    const values = [
      String(job.index + 1),
      displayStatus(job),
      resultValue(job, "full_name") || job.leadName || "",
      resultValue(job, "email"),
      resultValue(job, "validation"),
      resultValue(job, "job_title"),
      resultValue(job, "company") || job.companyName || "",
      job.resolvedLinkedinUrl || job.linkedinUrl,
      databaseStatus(job),
      job.error || ""
    ];

    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.title = value;
      if (index === 1) {
        const badge = document.createElement("span");
        badge.className = `status ${job.status}`;
        badge.textContent = value;
        cell.append(badge);
      } else if (index === 7) {
        const link = document.createElement("a");
        link.href = value;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = value;
        cell.append(link);
      } else {
        cell.textContent = value;
      }
      row.append(cell);
    });
    return row;
  }));
}

function databaseStatus(job) {
  if (job.dbSaveStatus === "saved") return "Saved";
  if (job.dbSaveStatus === "not_matched") return "Not in database";
  if (job.dbSaveStatus === "failed") return "Save failed";
  if (job.leadId) return "Matched";
  return "Match on result";
}

function exportRows() {
  return (currentState?.jobs || []).map((job) => ({
    index: job.index + 1,
    status: job.status,
    source: job.source || "pasted",
    lead_id: job.leadId || "",
    input_linkedin_url: job.inputLinkedinUrl || job.linkedinUrl,
    resolved_linkedin_url: job.resolvedLinkedinUrl || job.linkedinUrl,
    found: job.result?.found ?? "",
    success: job.result?.success ?? "",
    work_email: job.result?.email ?? "",
    validation: job.result?.validation ?? "",
    full_name: job.result?.full_name ?? "",
    job_title: job.result?.job_title ?? "",
    company: job.result?.company ?? "",
    http_status: job.httpStatus ?? "",
    retry_count: job.retryCount ?? 0,
    rate_limit_retry_count: job.rateLimitRetryCount ?? 0,
    next_retry_at: job.nextRetryAt ? new Date(job.nextRetryAt).toISOString() : "",
    database_status: databaseStatus(job),
    error: job.error ?? "",
    started_at: job.startedAt ? new Date(job.startedAt).toISOString() : "",
    finished_at: job.finishedAt ? new Date(job.finishedAt).toISOString() : ""
  }));
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadText(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

els.start.addEventListener("click", async () => {
  try {
    setMessage("Starting queue…");
    const source = selectedSource();
    const response = source === "database"
      ? await send("startDatabase", {
          limit: Number(els.dbLimit.value),
          settings: settingsFromForm(),
        })
      : await send("start", { urls: parseUrls(), settings: settingsFromForm() });
    const suffix = response.invalid?.length ? ` ${response.invalid.length} invalid URL(s) skipped.` : "";
    const remaining = source === "database" ? ` ${response.remaining} database lead(s) were eligible when loaded.` : "";
    setMessage(`${response.accepted} lead(s) queued.${suffix}${remaining}`, "success");
    const stateResponse = await send("getState");
    render(stateResponse.state);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

els.stop.addEventListener("click", async () => {
  try {
    await send("stop");
    setMessage("Queue stopped.");
  } catch (error) {
    setMessage(error.message, "error");
  }
});

els.retry.addEventListener("click", async () => {
  try {
    const response = await send("retryFailed");
    setMessage(`Resumed at the first unfinished lead (${response.accepted} remaining).`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
});

els.clear.addEventListener("click", async () => {
  try {
    await send("clear");
    els.urls.value = "";
    setMessage("Cleared.");
  } catch (error) {
    setMessage(error.message, "error");
  }
});

els.copyJson.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(exportRows(), null, 2));
    setMessage("Results copied as JSON.", "success");
  } catch (error) {
    setMessage(`Copy failed: ${error.message}`, "error");
  }
});

els.exportCsv.addEventListener("click", () => {
  const rows = exportRows();
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.map(csvCell).join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\r\n");
  downloadText(`mailmeteor-results-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  setMessage("CSV exported.", "success");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.queueState?.newValue) {
    render(changes.queueState.newValue);
  }
});

setInterval(() => {
  if (currentState?.running) renderRunTime(currentState);
}, 1000);

for (const input of document.querySelectorAll('input[name="source"]')) {
  input.addEventListener("change", renderSource);
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = els.loginForm.querySelector("button");
  button.disabled = true;
  try {
    setMessage("Connecting to the lead database…");
    const auth = await WorkEmailApi.signIn(els.username.value, els.password.value);
    els.password.value = "";
    setSignedIn(auth);
    setMessage("Database connected. Work-email results will be saved.", "success");
  } catch (error) {
    setMessage(error.message || String(error), "error");
  } finally {
    button.disabled = false;
  }
});

els.signOut.addEventListener("click", async () => {
  try {
    await WorkEmailApi.signOut();
  } catch (error) {
    setMessage(error.message || String(error), "error");
  } finally {
    setSignedIn(null);
  }
});

function selectedSource() {
  return document.querySelector('input[name="source"]:checked')?.value || "paste";
}

function renderSource() {
  const database = selectedSource() === "database";
  els.pasteSource.hidden = database;
  els.databaseSource.hidden = !database;
  els.start.textContent = database ? "Start from database" : "Start queue";
}

function setSignedIn(auth) {
  signedIn = Boolean(auth?.token);
  els.loginForm.hidden = signedIn;
  els.signedInRow.hidden = !signedIn;
  els.signedInName.textContent = signedIn ? auth.username || "Administrator" : "";
  if (currentState) render(currentState);
}

(async function init() {
  try {
    setSignedIn(await WorkEmailApi.getAuth());
    renderSource();
    const response = await send("getState");
    render(response.state);
    applySettings(response.state?.settings);
    if (!els.urls.value && response.state?.jobs?.length) {
      els.urls.value = response.state.jobs.map((job) => job.inputLinkedinUrl || job.linkedinUrl).join("\n");
    }
  } catch (error) {
    setMessage(error.message, "error");
  }
})();
