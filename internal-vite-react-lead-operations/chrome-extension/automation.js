const elements = {
  runCard: document.querySelector("#run-card"),
  runLabel: document.querySelector("#run-label"),
  runDetail: document.querySelector("#run-detail"),
  progressLabel: document.querySelector("#progress-label"),
  progressValue: document.querySelector("#progress-value"),
  progressBar: document.querySelector("#progress-bar"),
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
  const target = Math.max(0, Number(progress.targetRequests || 0));
  const percentage = target > 0 ? Math.min(100, (processed / target) * 100) : 0;

  elements.runCard.dataset.status = status;
  elements.runLabel.textContent = statusLabels[status] || "Ready";
  elements.runDetail.textContent = state.message || "The protected window is ready.";
  elements.progressLabel.textContent = state.currentLead?.fullName
    ? `Current lead: ${state.currentLead.fullName}`
    : "Run progress";
  elements.progressValue.textContent = `${processed} / ${target}`;
  elements.progressBar.style.width = `${percentage}%`;

  const running = status === "running";
  const pausing = status === "pausing";
  const paused = status === "paused";
  elements.pause.hidden = !running;
  elements.resume.hidden = !paused;
  elements.stop.hidden = !(running || pausing || paused);
  elements.message.hidden = true;
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
