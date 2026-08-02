const elements = {
  loginView: document.querySelector("#login-view"),
  dashboardView: document.querySelector("#dashboard-view"),
  loginForm: document.querySelector("#login-form"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  signOut: document.querySelector("#sign-out"),
  refresh: document.querySelector("#refresh"),
  scoutName: document.querySelector("#scout-name"),
  freshCount: document.querySelector("#fresh-count"),
  engagedCount: document.querySelector("#engaged-count"),
  requestCount: document.querySelector("#request-count"),
  acceptedCount: document.querySelector("#accepted-count"),
  emailCount: document.querySelector("#email-count"),
  failedCount: document.querySelector("#failed-count"),
  startAutoLead: document.querySelector("#start-auto-lead"),
  automateActiveTab: document.querySelector("#automate-active-tab"),
  simulationBatch: document.querySelector("#simulation-batch"),
  startSimulation: document.querySelector("#start-simulation"),
  nextLead: document.querySelector("#next-lead"),
  leadCard: document.querySelector("#lead-card"),
  leadName: document.querySelector("#lead-name"),
  leadMeta: document.querySelector("#lead-meta"),
  leadStatus: document.querySelector("#lead-status"),
  openProfile: document.querySelector("#open-profile"),
  openContact: document.querySelector("#open-contact"),
  postText: document.querySelector("#post-text"),
  generateDraft: document.querySelector("#generate-draft"),
  draftResult: document.querySelector("#draft-result"),
  draftText: document.querySelector("#draft-text"),
  copyDraft: document.querySelector("#copy-draft"),
  emailPanel: document.querySelector("#email-panel"),
  leadEmail: document.querySelector("#lead-email"),
  markEngaged: document.querySelector("#mark-engaged"),
  markRequested: document.querySelector("#mark-requested"),
  markAccepted: document.querySelector("#mark-accepted"),
  saveEmail: document.querySelector("#save-email"),
  skipLead: document.querySelector("#skip-lead"),
  openSent: document.querySelector("#open-sent"),
  toggleSettings: document.querySelector("#toggle-settings"),
  settingsForm: document.querySelector("#settings-form"),
  postEngagements: document.querySelector("#post-engagements"),
  engagementInterval: document.querySelector("#engagement-interval"),
  engagementUnit: document.querySelector("#engagement-unit"),
  connectionDelay: document.querySelector("#connection-delay"),
  connectionUnit: document.querySelector("#connection-unit"),
  validateComment: document.querySelector("#validate-comment"),
  includeNote: document.querySelector("#include-note"),
  error: document.querySelector("#error"),
  success: document.querySelector("#success"),
  updated: document.querySelector("#updated"),
  connection: document.querySelector("#connection"),
};

let dashboard = null;
let activeLead = null;

elements.loginForm.addEventListener("submit", handleLogin);
elements.signOut.addEventListener("click", handleSignOut);
elements.refresh.addEventListener("click", refreshDashboard);
elements.startAutoLead?.addEventListener("click", startRealAutoLead);
elements.automateActiveTab?.addEventListener("click", startAutomateActiveTab);
elements.startSimulation.addEventListener("click", startSimulation);
elements.nextLead.addEventListener("click", claimNextLead);
elements.openProfile.addEventListener("click", () => openUrl(activeLead?.linkedinUrl));
elements.openContact.addEventListener("click", () =>
  openUrl(contactInfoUrl(activeLead?.linkedinUrl)),
);
elements.generateDraft.addEventListener("click", generateDraft);
elements.copyDraft.addEventListener("click", copyDraft);
elements.markEngaged.addEventListener("click", () => updateStatus("engaged"));
elements.markRequested.addEventListener("click", () =>
  updateStatus("connection_requested"),
);
elements.markAccepted.addEventListener("click", () => updateStatus("accepted"));
elements.saveEmail.addEventListener("click", () => updateStatus("email_collected"));
elements.skipLead.addEventListener("click", () => updateStatus("skipped"));
elements.openSent.addEventListener("click", () =>
  openUrl("https://www.linkedin.com/mynetwork/invitation-manager/sent/"),
);
elements.toggleSettings.addEventListener("click", () => {
  elements.settingsForm.hidden = !elements.settingsForm.hidden;
});
elements.settingsForm.addEventListener("submit", saveSettings);

void hydrate();

async function hydrate() {
  const auth = await ScoutApi.getAuth();
  if (!auth) {
    showLogin();
    return;
  }
  const cached = await chrome.storage.local.get([
    "scoutDashboard",
    "scoutDashboardUpdatedAt",
  ]);
  if (cached.scoutDashboard) {
    renderDashboard(cached.scoutDashboard, cached.scoutDashboardUpdatedAt);
  }
  await refreshDashboard();
}

async function handleLogin(event) {
  event.preventDefault();
  setBusy(elements.loginForm, true);
  clearMessages();
  try {
    await ScoutApi.signIn(elements.username.value, elements.password.value);
    elements.password.value = "";
    await refreshDashboard();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(elements.loginForm, false);
  }
}

async function handleSignOut() {
  clearMessages();
  try {
    await ScoutApi.signOut();
  } catch (error) {
    showError(error);
  } finally {
    dashboard = null;
    activeLead = null;
    await chrome.action.setBadgeText({ text: "" });
    showLogin();
  }
}

async function refreshDashboard() {
  setBusy(elements.refresh, true);
  clearMessages();
  try {
    const response = await chrome.runtime.sendMessage({
      type: "REFRESH_SCOUT_DASHBOARD",
    });
    if (!response?.ok || !response.dashboard) {
      throw new Error(response?.error || "Unable to refresh the scout queue.");
    }
    renderDashboard(response.dashboard, Date.now());
  } catch (error) {
    if (/sign in|required|expired|session/i.test(String(error))) {
      showLogin();
    }
    showError(error);
  } finally {
    setBusy(elements.refresh, false);
  }
}

async function claimNextLead() {
  setBusy(elements.nextLead, true);
  clearMessages();
  try {
    const lead = await ScoutApi.authenticatedAction("scouts:claimNextLead");
    if (!lead) {
      showSuccess("No fresh leads remain in your queue.");
      await refreshDashboard();
      return;
    }
    activeLead = lead;
    renderLead(lead);
    await openUrl(lead.linkedinUrl);
    await refreshDashboard();
  } catch (error) {
    showError(error, true);
  } finally {
    setBusy(elements.nextLead, false);
  }
}

async function startSimulation() {
  clearMessages();
  const batch = Math.max(
    1,
    Math.min(10, Math.trunc(Number(elements.simulationBatch.value) || 1)),
  );
  elements.simulationBatch.value = String(batch);
  setBusy(elements.startSimulation, true);
  try {
    const simulatorUrl = new URL(
      "mock-linkedin/simulator.html",
      chrome.runtime.getURL("/"),
    );
    simulatorUrl.searchParams.set("batch", String(batch));
    simulatorUrl.searchParams.set("auto", "1");
    await chrome.tabs.create({ url: simulatorUrl.toString() });
    showSuccess(
      `Opened the isolated simulator for ${batch} lead${batch === 1 ? "" : "s"}.`,
    );
  } catch (error) {
    showError(error, true);
  } finally {
    setBusy(elements.startSimulation, false);
  }
}

async function updateStatus(status) {
  if (!activeLead) return;
  clearMessages();
  const email =
    status === "email_collected" ? elements.leadEmail.value.trim() : null;
  const trigger = statusButton(status);
  setBusy(trigger, true);
  try {
    await ScoutApi.authenticatedAction("scouts:updateLeadStatus", {
      leadId: activeLead.id,
      status,
      email,
      error: null,
    });
    showSuccess(statusMessage(status));
    activeLead =
      status === "email_collected" || status === "skipped"
        ? null
        : { ...activeLead, status };
    await refreshDashboard();
  } catch (error) {
    showError(error, true);
  } finally {
    setBusy(trigger, false);
  }
}

async function generateDraft() {
  clearMessages();
  setBusy(elements.generateDraft, true);
  try {
    const result = await ScoutApi.authenticatedAction("scouts:draftComment", {
      postText: elements.postText.value,
    });
    elements.draftText.textContent = result.draft;
    elements.draftResult.hidden = false;
    showSuccess("Draft generated for your review. Nothing was posted.");
  } catch (error) {
    showError(error, true);
  } finally {
    setBusy(elements.generateDraft, false);
  }
}

async function copyDraft() {
  await navigator.clipboard.writeText(elements.draftText.textContent || "");
  showSuccess("Draft copied. Review it before posting.");
}

async function startRealAutoLead() {
  clearMessages();
  setBusy(elements.startAutoLead, true);
  try {
    showSuccess("Starting real automation workflow on LinkedIn...");
    const response = await chrome.runtime.sendMessage({
      type: "START_AUTO_LEAD",
      leadId: activeLead?.id,
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Auto lead workflow failed.");
    }
    showSuccess(`Automation complete! Status: Connection requested.`);
    await refreshDashboard();
  } catch (error) {
    showError(error, true);
  } finally {
    setBusy(elements.startAutoLead, false);
  }
}

async function startAutomateActiveTab() {
  clearMessages();
  setBusy(elements.automateActiveTab, true);
  try {
    showSuccess("Triggering automation on current active LinkedIn tab...");
    const response = await chrome.runtime.sendMessage({
      type: "AUTOMATE_ACTIVE_TAB",
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Active tab automation failed. Ensure you are on a LinkedIn profile or activity page.");
    }
    showSuccess("Active tab automation completed!");
    await refreshDashboard();
  } catch (error) {
    showError(error, true);
  } finally {
    setBusy(elements.automateActiveTab, false);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  clearMessages();
  setBusy(elements.settingsForm, true);
  try {
    const settings = await ScoutApi.authenticatedAction(
      "scouts:updateSettings",
      {
        postEngagements: Number(elements.postEngagements.value),
        engagementIntervalMinutes: toMinutes(
          elements.engagementInterval,
          elements.engagementUnit,
        ),
        connectionDelayMinutes: toMinutes(
          elements.connectionDelay,
          elements.connectionUnit,
        ),
        includeNote: elements.includeNote.checked,
      },
    );
    await chrome.storage.local.set({
      validateBeforeCommenting: elements.validateComment.checked,
    });
    dashboard.settings = settings;
    renderSettings(settings);
    showSuccess("Workflow settings saved.");
    elements.settingsForm.hidden = true;
  } catch (error) {
    showError(error);
  } finally {
    setBusy(elements.settingsForm, false);
  }
}

function renderDashboard(value, updatedAt) {
  dashboard = value;
  activeLead = value.activeLead;
  elements.loginView.hidden = true;
  elements.dashboardView.hidden = false;
  elements.signOut.hidden = false;
  elements.scoutName.textContent = value.scout.username;
  elements.freshCount.textContent = formatNumber(value.counts.fresh);
  elements.engagedCount.textContent = formatNumber(value.counts.engaged);
  elements.requestCount.textContent = formatNumber(
    value.counts.connectionRequested,
  );
  elements.acceptedCount.textContent = formatNumber(value.counts.accepted);
  elements.emailCount.textContent = formatNumber(value.counts.emailCollected);
  elements.failedCount.textContent = formatNumber(value.counts.failed);
  elements.updated.textContent = `Synced ${relativeTime(updatedAt)}`;
  elements.connection.classList.remove("error");
  elements.connection.lastChild.textContent = " Scout queue connected";
  renderSettings(value.settings);
  renderLead(activeLead);
}

function renderLead(lead) {
  elements.leadCard.hidden = !lead;
  if (!lead) return;
  elements.leadName.textContent = lead.fullName || "Unnamed lead";
  elements.leadMeta.textContent = [lead.currentTitle, lead.companyName]
    .filter(Boolean)
    .join(" · ");
  elements.leadStatus.textContent = formatStatus(lead.status);
  elements.emailPanel.hidden = lead.status !== "accepted";
  elements.markEngaged.hidden = lead.status !== "viewed";
  elements.markRequested.hidden = !["viewed", "engaged"].includes(lead.status);
  elements.markAccepted.hidden = ![
    "connected",
    "connection_requested",
  ].includes(lead.status);
  elements.saveEmail.hidden = lead.status !== "accepted";
}

function renderSettings(settings) {
  elements.postEngagements.value = settings.postEngagements;
  setDuration(
    elements.engagementInterval,
    elements.engagementUnit,
    settings.engagementIntervalMinutes,
  );
  setDuration(
    elements.connectionDelay,
    elements.connectionUnit,
    settings.connectionDelayMinutes,
  );
  elements.includeNote.checked = settings.includeNote;
  void chrome.storage.local.get("validateBeforeCommenting").then((res) => {
    if (elements.validateComment) {
      elements.validateComment.checked = res.validateBeforeCommenting ?? true;
    }
  });
}

function showLogin() {
  elements.loginView.hidden = false;
  elements.dashboardView.hidden = true;
  elements.signOut.hidden = true;
  elements.updated.textContent = "Sign in to sync your queue";
}

function showError(error, report = false) {
  const message = cleanError(error);
  elements.error.textContent = message;
  elements.error.hidden = false;
  elements.connection.classList.add("error");
  elements.connection.lastChild.textContent = " Connection issue";
  if (report) {
    void ScoutApi.authenticatedAction("scouts:reportError", {
      leadId: activeLead?.id ?? null,
      message,
    }).catch(() => {});
  }
}

function showSuccess(message) {
  elements.success.textContent = message;
  elements.success.hidden = false;
}

function clearMessages() {
  elements.error.hidden = true;
  elements.success.hidden = true;
}

function setBusy(target, busy) {
  if (!target) return;
  const controls = target.matches?.("form")
    ? target.querySelectorAll("button, input, select, textarea")
    : [target];
  for (const control of controls) control.disabled = busy;
}

async function openUrl(url) {
  if (!url) throw new Error("This lead does not have a valid profile URL.");
  await chrome.tabs.create({ url });
}

function contactInfoUrl(profileUrl) {
  if (!profileUrl) return null;
  const url = new URL(profileUrl);
  url.search = "";
  url.hash = "";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/overlay/contact-info/`;
  return url.toString();
}

function toMinutes(input, unit) {
  return Math.round(Number(input.value) * Number(unit.value));
}

function setDuration(input, unit, totalMinutes) {
  const units = [1440, 60, 1];
  const selected = units.find(
    (value) => totalMinutes >= value && totalMinutes % value === 0,
  ) ?? 1;
  unit.value = String(selected);
  input.value = String(totalMinutes / selected);
}

function statusButton(status) {
  return {
    engaged: elements.markEngaged,
    connection_requested: elements.markRequested,
    accepted: elements.markAccepted,
    email_collected: elements.saveEmail,
    skipped: elements.skipLead,
  }[status];
}

function statusMessage(status) {
  return {
    engaged: "Lead marked engaged.",
    connection_requested: "Connection request recorded.",
    accepted: "Connection acceptance recorded.",
    email_collected: "Email saved.",
    skipped: "Lead skipped.",
  }[status];
}

function formatStatus(status) {
  return String(status)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function relativeTime(timestamp) {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - Number(timestamp || Date.now())) / 1000),
  );
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function cleanError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/^.*?Uncaught (?:Error|ConvexError):\s*/s, "")
    .split("\n")[0];
}
