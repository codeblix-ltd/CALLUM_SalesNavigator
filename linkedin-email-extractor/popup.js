const els = {
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
  resultsBody: document.querySelector("#resultsBody")
};

let currentState = null;

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
    keepFailedTabs: els.keepFailedTabs.checked
  };
}

function applySettings(settings = {}) {
  els.concurrency.value = settings.concurrency || 5;
  els.staggerMs.value = String(settings.staggerMs || 1800);
  els.timeoutMs.value = String(settings.timeoutMs || 60000);
  els.keepFailedTabs.checked = settings.keepFailedTabs !== false;
}

function isDone(status) {
  return ["found", "not_found", "error", "timeout", "stopped"].includes(status);
}

function displayStatus(status) {
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
  return labels[status] || status;
}

function resultValue(job, key) {
  return job.result?.[key] ?? "";
}

function render(state) {
  currentState = state;
  const jobs = state?.jobs || [];
  const running = Boolean(state?.running);
  const done = jobs.filter((job) => isDone(job.status)).length;
  const found = jobs.filter((job) => job.status === "found").length;
  const notFound = jobs.filter((job) => job.status === "not_found").length;
  const errors = jobs.filter((job) => ["error", "timeout"].includes(job.status)).length;
  const retryable = jobs.some((job) => ["not_found", "error", "timeout", "stopped"].includes(job.status));

  els.runBadge.textContent = running ? "Running" : "Idle";
  els.runBadge.className = `badge ${running ? "running" : "idle"}`;
  els.start.disabled = running;
  els.stop.disabled = !running;
  els.clear.disabled = running;
  els.retry.disabled = running || !retryable;
  els.copyJson.disabled = jobs.length === 0;
  els.exportCsv.disabled = jobs.length === 0;
  els.concurrency.disabled = running;
  els.staggerMs.disabled = running;
  els.timeoutMs.disabled = running;
  els.keepFailedTabs.disabled = running;

  els.totalCount.textContent = jobs.length;
  els.doneCount.textContent = done;
  els.foundCount.textContent = found;
  els.notFoundCount.textContent = notFound;
  els.errorCount.textContent = errors;

  if (!jobs.length) {
    els.resultsBody.innerHTML = '<tr><td colspan="9" class="empty">No jobs yet.</td></tr>';
    return;
  }

  els.resultsBody.replaceChildren(...jobs.map((job) => {
    const row = document.createElement("tr");
    const values = [
      String(job.index + 1),
      displayStatus(job.status),
      resultValue(job, "full_name"),
      resultValue(job, "email"),
      resultValue(job, "validation"),
      resultValue(job, "job_title"),
      resultValue(job, "company"),
      job.resolvedLinkedinUrl || job.linkedinUrl,
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

function exportRows() {
  return (currentState?.jobs || []).map((job) => ({
    index: job.index + 1,
    status: job.status,
    input_linkedin_url: job.inputLinkedinUrl || job.linkedinUrl,
    resolved_linkedin_url: job.resolvedLinkedinUrl || job.linkedinUrl,
    found: job.result?.found ?? "",
    success: job.result?.success ?? "",
    email: job.result?.email ?? "",
    validation: job.result?.validation ?? "",
    full_name: job.result?.full_name ?? "",
    job_title: job.result?.job_title ?? "",
    company: job.result?.company ?? "",
    http_status: job.httpStatus ?? "",
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
    const response = await send("start", { urls: parseUrls(), settings: settingsFromForm() });
    const suffix = response.invalid?.length ? ` ${response.invalid.length} invalid URL(s) skipped.` : "";
    setMessage(`${response.accepted} URL(s) queued.${suffix}`, "success");
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
    setMessage(`${response.accepted} unfinished URL(s) queued again.`, "success");
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

(async function init() {
  try {
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
