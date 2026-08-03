const elements = {
  loginView: document.querySelector("#login-view"),
  onboardingView: document.querySelector("#onboarding-view"),
  dashboardView: document.querySelector("#dashboard-view"),
  loginForm: document.querySelector("#login-form"),
  onboardingForm: document.querySelector("#onboarding-form"),
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
  requestUsage: document.querySelector("#request-usage"),
  engagementUsage: document.querySelector("#engagement-usage"),
  startAutoLead: document.querySelector("#start-auto-lead"),
  toggleSettings: document.querySelector("#toggle-settings"),
  settingsForm: document.querySelector("#settings-form"),
  linkedinPlan: document.querySelector("#linkedin-plan"),
  connectionDailyLimit: document.querySelector("#connection-daily-limit"),
  engagementDailyLimit: document.querySelector("#engagement-daily-limit"),
  postEngagements: document.querySelector("#post-engagements"),
  settingsRecommendation: document.querySelector("#settings-recommendation"),
  onboardingPlan: document.querySelector("#onboarding-plan"),
  onboardingConnectionLimit: document.querySelector(
    "#onboarding-connection-limit",
  ),
  onboardingEngagementLimit: document.querySelector(
    "#onboarding-engagement-limit",
  ),
  onboardingPostsPerLead: document.querySelector(
    "#onboarding-posts-per-lead",
  ),
  onboardingRecommendation: document.querySelector(
    "#onboarding-recommendation",
  ),
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
const RECOMMENDED_POSTS_PER_LEAD = 3;

let dashboard = null;
let premiumVerified = false;

elements.loginForm.addEventListener("submit", handleLogin);
elements.onboardingForm.addEventListener("submit", saveOnboarding);
elements.signOut.addEventListener("click", handleSignOut);
elements.refresh.addEventListener("click", refreshDashboard);
elements.startAutoLead.addEventListener("click", startAutoLead);
elements.toggleSettings.addEventListener("click", () => {
  elements.settingsForm.hidden = !elements.settingsForm.hidden;
});
elements.settingsForm.addEventListener("submit", saveSettings);
elements.verifyPremium.addEventListener("click", verifyPremiumAndUnlockNote);
elements.onboardingPlan.addEventListener("change", () =>
  applyRecommendedLimits("onboarding"),
);
elements.linkedinPlan.addEventListener("change", () => {
  applyRecommendedLimits("settings");
  syncPremiumNoteGate();
});
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
    await chrome.storage.local.remove([
      "scoutDashboard",
      "scoutDashboardUpdatedAt",
    ]);
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
    await chrome.storage.local.remove([
      "scoutDashboard",
      "scoutDashboardUpdatedAt",
    ]);
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
    if (/sign in|required|expired|session/i.test(String(error))) showLogin();
    showError(error);
  } finally {
    setBusy(elements.refresh, false);
  }
}

async function saveOnboarding(event) {
  event.preventDefault();
  clearMessages();
  setBusy(elements.onboardingForm, true);
  try {
    const premium = elements.onboardingPlan.value === "premium";
    const settings = await updateSettings({
      premium,
      connectionDailyLimit: Number(elements.onboardingConnectionLimit.value),
      engagementDailyLimit: Number(elements.onboardingEngagementLimit.value),
      postEngagements: Number(elements.onboardingPostsPerLead.value),
      onboardingCompleted: true,
      includeNote: false,
    });
    dashboard.settings = settings;
    showSuccess("Setup saved. Your daily workflow is ready.");
    await refreshDashboard();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(elements.onboardingForm, false);
  }
}

async function startAutoLead() {
  clearMessages();
  setBusy(elements.startAutoLead, true);
  try {
    showSuccess("Reviewing accepted connections, then running today's queue...");
    const response = await chrome.runtime.sendMessage({ type: "START_AUTO_LEAD" });
    if (!response?.ok) {
      throw new Error(response?.error || "Daily workflow failed.");
    }
    const result = response.result;
    showSuccess(
      `Workflow complete: ${formatNumber(result.requestsSent)} request(s), ${formatNumber(result.acceptedMatched)} accepted match(es), ${formatNumber(result.emailsCollected)} email(s).`,
    );
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
    const premium = elements.linkedinPlan.value === "premium";
    const invitationNote = elements.invitationNote.value.trim();
    const includeNote = premium && premiumVerified;
    if (includeNote && !invitationNote) {
      throw new Error("Enter an invitation note before saving your settings.");
    }
    const settings = await updateSettings({
      premium,
      connectionDailyLimit: Number(elements.connectionDailyLimit.value),
      engagementDailyLimit: Number(elements.engagementDailyLimit.value),
      postEngagements: Number(elements.postEngagements.value),
      onboardingCompleted: true,
      includeNote,
    });
    await chrome.storage.local.set({
      validateBeforeCommenting: elements.validateComment.checked,
      invitationNote: invitationNote || DEFAULT_INVITATION_NOTE,
    });
    dashboard.settings = settings;
    renderSettings(settings);
    showSuccess("Daily workflow settings saved.");
    elements.settingsForm.hidden = true;
    await refreshDashboard();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(elements.settingsForm, false);
  }
}

function updateSettings(values) {
  return ScoutApi.authenticatedAction("scouts:updateSettings", {
    postEngagements: values.postEngagements,
    linkedinPremium: values.premium,
    connectionDailyLimit: values.connectionDailyLimit,
    engagementDailyLimit: values.engagementDailyLimit,
    onboardingCompleted: values.onboardingCompleted,
    includeNote: values.includeNote,
  });
}

function renderDashboard(value, updatedAt) {
  dashboard = value;
  elements.loginView.hidden = true;
  elements.signOut.hidden = false;
  elements.scoutName.textContent = value.scout.username;
  if (!value.settings.onboardingCompleted) {
    showOnboarding(value.settings);
    return;
  }
  elements.onboardingView.hidden = true;
  elements.dashboardView.hidden = false;
  elements.freshCount.textContent = formatNumber(value.counts.fresh);
  elements.engagedCount.textContent = formatNumber(value.counts.engaged);
  elements.requestCount.textContent = formatNumber(value.counts.connectionRequested);
  elements.acceptedCount.textContent = formatNumber(value.counts.accepted);
  elements.emailCount.textContent = formatNumber(value.counts.emailCollected);
  elements.failedCount.textContent = formatNumber(value.counts.failed);
  elements.requestUsage.textContent = `${formatNumber(value.usage.requestsSent)} / ${formatNumber(value.usage.requestLimit)}`;
  elements.engagementUsage.textContent = `${formatNumber(value.usage.likesUsed)} / ${formatNumber(value.usage.engagementLimit)}`;
  elements.updated.textContent = `Synced ${relativeTime(updatedAt)} · resets daily`;
  elements.connection.classList.remove("error");
  elements.connection.lastChild.textContent = " Scout queue connected";
  renderSettings(value.settings);
}

function showOnboarding(settings) {
  elements.dashboardView.hidden = true;
  elements.onboardingView.hidden = false;
  elements.onboardingPlan.value = settings.linkedinPremium ? "premium" : "free";
  elements.onboardingConnectionLimit.value = settings.connectionDailyLimit || 20;
  elements.onboardingEngagementLimit.value = settings.engagementDailyLimit || 150;
  elements.onboardingPostsPerLead.value =
    settings.postEngagements || RECOMMENDED_POSTS_PER_LEAD;
  updateLimitControls("onboarding");
  elements.updated.textContent = "Complete setup to start automation";
}

function renderSettings(settings) {
  elements.linkedinPlan.value = settings.linkedinPremium ? "premium" : "free";
  elements.connectionDailyLimit.value = settings.connectionDailyLimit;
  elements.engagementDailyLimit.value = settings.engagementDailyLimit;
  elements.postEngagements.value = settings.postEngagements;
  updateLimitControls("settings");
  syncPremiumNoteGate();
  void chrome.storage.local
    .get(["validateBeforeCommenting", "invitationNote"])
    .then((stored) => {
      elements.validateComment.checked = stored.validateBeforeCommenting ?? true;
      elements.invitationNote.value =
        stored.invitationNote?.trim() || DEFAULT_INVITATION_NOTE;
    });
}

function applyRecommendedLimits(scope) {
  const controls = limitControls(scope);
  const premium = controls.plan.value === "premium";
  controls.connection.value = premium ? "40" : "20";
  controls.engagement.value = premium ? "250" : "150";
  if (controls.posts) controls.posts.value = String(RECOMMENDED_POSTS_PER_LEAD);
  updateLimitControls(scope);
}

function updateLimitControls(scope) {
  const controls = limitControls(scope);
  const premium = controls.plan.value === "premium";
  controls.connection.max = premium ? "40" : "20";
  controls.engagement.max = premium ? "250" : "150";
  controls.connection.value = String(
    Math.min(Number(controls.connection.value || 1), premium ? 40 : 20),
  );
  controls.engagement.value = String(
    Math.min(Number(controls.engagement.value || 1), premium ? 250 : 150),
  );
  controls.recommendation.textContent = premium
    ? "40 connection requests · 250 likes per day"
    : "20 connection requests · 150 likes per day";
}

function limitControls(scope) {
  if (scope === "onboarding") {
    return {
      plan: elements.onboardingPlan,
      connection: elements.onboardingConnectionLimit,
      engagement: elements.onboardingEngagementLimit,
      posts: elements.onboardingPostsPerLead,
      recommendation: elements.onboardingRecommendation,
    };
  }
  return {
    plan: elements.linkedinPlan,
    connection: elements.connectionDailyLimit,
    engagement: elements.engagementDailyLimit,
    posts: elements.postEngagements,
    recommendation: elements.settingsRecommendation,
  };
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
    showSuccess("LinkedIn Premium verified. Custom invitation notes are unlocked.");
    elements.invitationNote.focus();
  } catch (error) {
    showError(error);
  } finally {
    setPremiumCheckPending(false);
  }
}

function syncPremiumNoteGate() {
  const premiumSelected = elements.linkedinPlan.value === "premium";
  const unlocked = premiumSelected && premiumVerified;
  elements.premiumNoteGate.classList.toggle("is-verified", unlocked);
  elements.verifyPremium.hidden = !premiumSelected;
  elements.premiumNoteStatus.textContent = unlocked ? "Verified" : "Locked";
  elements.premiumNoteTitle.textContent = unlocked
    ? "LinkedIn Premium verified"
    : premiumSelected
      ? "Verify LinkedIn Premium"
      : "LinkedIn Premium required";
  elements.premiumNoteDescription.textContent = unlocked
    ? "Your custom note will be included with connection requests."
    : premiumSelected
      ? "Verify the signed-in LinkedIn account to unlock a custom connection note."
      : "Select LinkedIn Premium to verify the account and unlock a custom connection note.";
  elements.verifyPremium.textContent = premiumVerified
    ? "Verify again"
    : "Verify my Premium";
  elements.invitationNoteField.hidden = !unlocked;
  elements.invitationNote.required = unlocked;
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
    "The extension is confirming Premium eligibility.";
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
  elements.onboardingView.hidden = true;
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
      leadId: null,
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
