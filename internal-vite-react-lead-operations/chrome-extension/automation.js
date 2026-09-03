const elements = {
  runCard: document.querySelector("#run-card"),
  runLabel: document.querySelector("#run-label"),
  runDetail: document.querySelector("#run-detail"),
  progressLabel: document.querySelector("#progress-label"),
  progressValue: document.querySelector("#progress-value"),
  progressBar: document.querySelector("#progress-bar"),
  progressLeads: document.querySelector("#progress-leads"),
  runEstimate: document.querySelector("#run-estimate"),
  pause: document.querySelector("#pause-run"),
  resume: document.querySelector("#resume-run"),
  stop: document.querySelector("#stop-run"),
  message: document.querySelector("#control-message"),
};

const statusLabels = {
  idle: "Ready",
  running: "Automation in progress",
  pausing: "Pausing safely",
  paused: "Run paused",
  stopped: "Run stopped",
  completed: "Today’s work is complete",
  failed: "Run needs attention",
};

elements.pause.addEventListener("click", () => sendControl("PAUSE_AUTO_LEAD"));
elements.resume.addEventListener("click", () => sendControl("RESUME_AUTO_LEAD"));
elements.stop.addEventListener("click", () => sendControl("STOP_AUTO_LEAD"));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.autoLeadRunState?.newValue) {
    renderRunState(changes.autoLeadRunState.newValue);
  }
});

void loadRunState();

async function loadRunState() {
  const response = await chrome.runtime.sendMessage({
    type: "GET_AUTO_LEAD_RUN_STATE",
  });
  if (!response?.ok || !response.state) {
    showMessage(response?.error || "Could not read the run status.", true);
    return;
  }
  renderRunState(response.state);
}

async function sendControl(type) {
  setControlsDisabled(true);
  showMessage(type === "STOP_AUTO_LEAD" ? "Stopping..." : "Updating run...", false);
  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response?.ok) throw new Error(response?.error || "The run control failed.");
    if (response.state) renderRunState(response.state);
    if (response.result?.state) renderRunState(response.result.state);
  } catch (error) {
    showMessage(cleanError(error), true);
  } finally {
    setControlsDisabled(false);
  }
}

function renderRunState(state) {
  const status = String(state.status || "idle");
  const progress = state.progress || {};
  const processed = Math.max(0, Number(progress.processedLeads || 0));
  const requestsSent = Math.max(0, Number(progress.requestsSent || 0));
  const requestTarget = Math.max(0, Number(progress.targetRequests || 0));
  const percentage = requestTarget > 0
    ? Math.min(100, (requestsSent / requestTarget) * 100)
    : 0;

  elements.runCard.dataset.status = status;
  elements.runLabel.textContent = statusLabels[status] || "Ready";
  elements.runDetail.textContent = state.message || "The protected window is ready.";
  elements.progressLabel.textContent = state.currentLead?.fullName
    ? `Current lead: ${state.currentLead.fullName}`
    : "Request goal for this run";
  elements.progressValue.textContent = requestTarget > 0
    ? `${requestsSent} / ${requestTarget} requests`
    : `${requestsSent} requests sent`;
  elements.progressBar.style.width = `${percentage}%`;
  elements.progressLeads.textContent = `${formatCount(processed, "lead")} checked in this run.`;
  elements.runEstimate.textContent = formatRunEta(progress, status);

  const running = status === "running";
  const pausing = status === "pausing";
  const resumable = status === "paused" || status === "failed";
  elements.pause.hidden = !running;
  elements.resume.hidden = !resumable;
  elements.stop.hidden = !(running || pausing || resumable);
  elements.message.hidden = true;
}

function formatRunEta(progress, status) {
  const target = Number(progress.targetRequests || 0);
  if (target <= 0) return "ETA appears after today’s request goal is ready.";
  const averageMs = Number(progress.averageLeadDurationMs || 0);
  if (averageMs <= 0) return "ETA appears after the first lead finishes.";
  const storedRemainingMs = Math.max(
    0,
    Number(progress.estimatedRemainingMs || 0),
  );
  if (status === "completed") return "Today’s run is complete.";
  if (status === "paused" || status === "failed") {
    return `About ${formatEtaDuration(storedRemainingMs)} left after resume.`;
  }
  const completionAt = Number(progress.estimatedCompletionAt || 0);
  const remainingMs = completionAt > 0
    ? Math.max(0, completionAt - Date.now())
    : storedRemainingMs;
  if (remainingMs < 30_000) return "Estimated to finish very soon.";
  const clock = new Date(Date.now() + remainingMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Estimated finish: ${clock} · about ${formatEtaDuration(remainingMs)} left`;
}

function formatCount(count, singular) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatEtaDuration(milliseconds) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `${hours} hr ${remainingMinutes} min`
    : `${hours} hr`;
}

function setControlsDisabled(disabled) {
  for (const control of [elements.pause, elements.resume, elements.stop]) {
    control.disabled = disabled;
  }
}

function showMessage(message, isError) {
  elements.message.textContent = message;
  elements.message.style.color = isError ? "#ffc0c9" : "#d6cdf6";
  elements.message.hidden = false;
}

function cleanError(error) {
  return String(error instanceof Error ? error.message : error || "Something went wrong.")
    .replace(/^Error:\s*/i, "")
    .split("\n")[0];
}
