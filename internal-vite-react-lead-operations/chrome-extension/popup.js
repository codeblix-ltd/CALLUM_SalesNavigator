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
  openSent: document.querySelector("#open-sent"),
  toggleSettings: document.querySelector("#toggle-settings"),
  settingsForm: document.querySelector("#settings-form"),
  postEngagements: document.querySelector("#post-engagements"),
  engagementInterval: document.querySelector("#engagement-interval"),
  engagementUnit: document.querySelector("#engagement-unit"),
  connectionDelay: document.querySelector("#connection-delay"),
  connectionUnit: document.querySelector("#connection-unit"),
  validateComment: document.querySelector("#validate-comment"),
  premiumNoteGate: document.querySelector("#premium-note-gate"),
  premiumNoteTitle: document.querySelector("#premium-note-title"),
  premiumNoteStatus: document.querySelector("#premium-note-status"),
  premiumNoteDescription: document.querySelector("#premium-note-description"),
  verifyPremium: document.querySelector("#verify-premium"),
  invitationNoteField: document.querySelector("#invitation-note-field"),
  invitationNote: document.querySelector("#invitation-note"),
  error: document.querySelector("#error"),
  success: document.querySelector("#success"),
  updated: document.querySelector("#updated"),
  connection: document.querySelector("#connection"),
};

const DEFAULT_INVITATION_NOTE =
  "Hi, I came across your profile and would be glad to connect and keep in touch.";

let dashboard = null;
let activeLead = null;
let premiumVerified = false;

elements.loginForm.addEventListener("submit", handleLogin);
elements.signOut.addEventListener("click", handleSignOut);
elements.refresh.addEventListener("click", refreshDashboard);
elements.startAutoLead?.addEventListener("click", startAutoLead);
elements.openSent.addEventListener("click", () =>
  openUrl("https://www.linkedin.com/mynetwork/invitation-manager/sent/"),
);
elements.toggleSettings.addEventListener("click", () => {
  elements.settingsForm.hidden = !elements.settingsForm.hidden;
});
elements.settingsForm.addEventListener("submit", saveSettings);
elements.verifyPremium.addEventListener("click", verifyPremiumAndUnlockNote);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.linkedInPremium) return;
  premiumVerified = changes.linkedInPremium.newValue === true;
  syncPremiumNoteGate();
});

void hydrate().catch((error) => {
  showLogin();
  showError(error);
});

async function hydrate() {
  await loadPremiumNoteState();
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

async function startAutoLead() {
  clearMessages();
  setBusy(elements.startAutoLead, true);
  try {
    showSuccess("Starting automation on LinkedIn...");
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

async function saveSettings(event) {
  event.preventDefault();
  clearMessages();
  setBusy(elements.settingsForm, true);
  try {
    const includeNote = premiumVerified;
    const invitationNote = elements.invitationNote.value.trim();

    if (includeNote && !invitationNote) {
      throw new Error("Enter an invitation note before saving your settings.");
    }

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
        includeNote,
      },
    );
    await chrome.storage.local.set({
      validateBeforeCommenting: elements.validateComment.checked,
      invitationNote: invitationNote || DEFAULT_INVITATION_NOTE,
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
  syncPremiumNoteGate();
  void chrome.storage.local
    .get(["validateBeforeCommenting", "invitationNote"])
    .then((res) => {
    if (elements.validateComment) {
      elements.validateComment.checked = res.validateBeforeCommenting ?? true;
    }
    elements.invitationNote.value =
      res.invitationNote?.trim() || DEFAULT_INVITATION_NOTE;
    });
}

async function verifyPremiumAndUnlockNote() {
  clearMessages();
  setPremiumCheckPending(true);
  try {
    showSuccess("Checking LinkedIn Premium eligibility...");
    const premium = await checkPremiumEligibility();
    if (!premium) {
      premiumVerified = false;
      syncPremiumNoteGate();
      throw new Error(
        "LinkedIn Premium was not detected for the current account. Sign in to the correct LinkedIn account, then try again.",
      );
    }
    premiumVerified = true;
    syncPremiumNoteGate();
    showSuccess("LinkedIn Premium verified. Custom invitation notes are now unlocked.");
    elements.invitationNote.focus();
  } catch (error) {
    showError(error);
  } finally {
    setPremiumCheckPending(false);
  }
}

function syncPremiumNoteGate() {
  elements.premiumNoteGate.classList.toggle("is-verified", premiumVerified);
  elements.premiumNoteStatus.textContent = premiumVerified ? "Verified" : "Locked";
  elements.premiumNoteTitle.textContent = premiumVerified
    ? "LinkedIn Premium verified"
    : "Do you have LinkedIn Premium?";
  elements.premiumNoteDescription.textContent = premiumVerified
    ? "Your custom note will be included with connection requests."
    : "Verify your LinkedIn account to unlock a custom note for connection requests.";
  elements.verifyPremium.textContent = premiumVerified
    ? "Verify again"
    : "Yes — verify my Premium";
  elements.invitationNoteField.hidden = !premiumVerified;
  elements.invitationNote.required = premiumVerified;
}

function setPremiumCheckPending(pending) {
  elements.verifyPremium.disabled = pending;
  elements.premiumNoteGate.classList.toggle("is-checking", pending);
  if (!pending) {
    syncPremiumNoteGate();
    return;
  }
  elements.premiumNoteStatus.textContent = "Checking";
  elements.premiumNoteTitle.textContent = "Checking your LinkedIn account...";
  elements.premiumNoteDescription.textContent =
    "The extension is securely confirming your Premium eligibility.";
  elements.verifyPremium.textContent = "Verifying...";
}

async function loadPremiumNoteState() {
  const stored = await chrome.storage.local.get([
    "invitationNote",
    "linkedInPremium",
  ]);
  elements.invitationNote.value =
    stored.invitationNote?.trim() || DEFAULT_INVITATION_NOTE;
  premiumVerified = stored.linkedInPremium === true;
  syncPremiumNoteGate();
}

async function checkPremiumEligibility() {
  const response = await chrome.runtime.sendMessage({
    type: "CHECK_LINKEDIN_PREMIUM",
  });
  if (!response?.ok) {
    throw new Error(
      response?.error || "Unable to verify LinkedIn Premium eligibility.",
    );
  }
  return response.premium === true;
}

function showLogin() {
  elements.loginView.hidden = false;
  elements.dashboardView.hidden = true;
  elements.signOut.hidden = true;
  elements.updated.textContent = "Sign in to sync your queue";
}

function showError(error, report = false) {
  const message = cleanError(error);
  elements.success.hidden = true;
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
  elements.error.hidden = true;
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
