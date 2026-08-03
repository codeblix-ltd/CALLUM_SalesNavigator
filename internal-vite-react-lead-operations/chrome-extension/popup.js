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
  resetOnboarding: document.querySelector("#reset-onboarding"),
  toggleSettings: document.querySelector("#toggle-settings"),
  settingsForm: document.querySelector("#settings-form"),
  saveSettings: document.querySelector("#save-settings"),
  linkedinPlan: document.querySelector("#linkedin-plan"),
  connectionDailyLimit: document.querySelector("#connection-daily-limit"),
  postEngagements: document.querySelector("#post-engagements"),
  settingsCalculation: document.querySelector("#settings-calculation"),
  settingsCapacity: document.querySelector("#settings-capacity"),
  settingsCapacityBar: document.querySelector("#settings-capacity-bar"),
  settingsPostHelp: document.querySelector("#settings-post-help"),
  onboardingPlanStep: document.querySelector("#onboarding-plan-step"),
  onboardingWorkflowStep: document.querySelector("#onboarding-workflow-step"),
  planStepMarker: document.querySelector("#plan-step-marker"),
  workflowStepMarker: document.querySelector("#workflow-step-marker"),
  onboardingFreePlan: document.querySelector("#onboarding-free-plan"),
  onboardingPremiumPlan: document.querySelector("#onboarding-premium-plan"),
  onboardingPremiumCheck: document.querySelector(
    "#onboarding-premium-check",
  ),
  onboardingVerifyPremium: document.querySelector(
    "#onboarding-verify-premium",
  ),
  onboardingPremiumStatus: document.querySelector(
    "#onboarding-premium-status",
  ),
  onboardingNext: document.querySelector("#onboarding-next"),
  onboardingBack: document.querySelector("#onboarding-back"),
  onboardingPlanSummary: document.querySelector("#onboarding-plan-summary"),
  onboardingConnectionLimit: document.querySelector(
    "#onboarding-connection-limit",
  ),
  onboardingPostsPerLead: document.querySelector(
    "#onboarding-posts-per-lead",
  ),
  onboardingCalculation: document.querySelector("#onboarding-calculation"),
  onboardingCapacity: document.querySelector("#onboarding-capacity"),
  onboardingCapacityBar: document.querySelector("#onboarding-capacity-bar"),
  onboardingPostHelp: document.querySelector("#onboarding-post-help"),
  onboardingValidateComment: document.querySelector(
    "#onboarding-validate-comment",
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
const PLAN_LIMITS = {
  free: { requests: 20, likes: 150, label: "Free" },
  premium: { requests: 40, likes: 250, label: "Premium" },
};

let dashboard = null;
let premiumVerified = false;
let onboardingSelectedPlan = null;
let savedPlanIsPremium = false;

elements.loginForm.addEventListener("submit", handleLogin);
elements.onboardingForm.addEventListener("submit", saveOnboarding);
elements.signOut.addEventListener("click", handleSignOut);
elements.refresh.addEventListener("click", refreshDashboard);
elements.startAutoLead.addEventListener("click", startAutoLead);
elements.resetOnboarding.addEventListener("click", restartOnboarding);
elements.toggleSettings.addEventListener("click", () => {
  elements.settingsForm.hidden = !elements.settingsForm.hidden;
});
elements.settingsForm.addEventListener("submit", saveSettings);
elements.verifyPremium.addEventListener("click", verifyPremiumAndUnlockNote);
elements.onboardingFreePlan.addEventListener("click", () =>
  selectOnboardingPlan("free"),
);
elements.onboardingPremiumPlan.addEventListener("click", () =>
  selectOnboardingPlan("premium"),
);
elements.onboardingVerifyPremium.addEventListener(
  "click",
  verifyOnboardingPremium,
);
elements.onboardingNext.addEventListener("click", showOnboardingWorkflowStep);
elements.onboardingBack.addEventListener("click", () => setOnboardingStep(1));
elements.onboardingConnectionLimit.addEventListener("input", () =>
  updateLimitControls("onboarding"),
);
elements.onboardingPostsPerLead.addEventListener("input", () =>
  updateLimitControls("onboarding"),
);
elements.connectionDailyLimit.addEventListener("input", () =>
  updateLimitControls("settings"),
);
elements.postEngagements.addEventListener("input", () =>
  updateLimitControls("settings"),
);
elements.linkedinPlan.addEventListener("change", () => {
  if (elements.linkedinPlan.value === "premium" && !savedPlanIsPremium) {
    premiumVerified = false;
  }
  applyRecommendedLimits("settings");
  syncPremiumNoteGate();
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.linkedInPremium) return;
  premiumVerified = changes.linkedInPremium.newValue === true;
  syncPremiumNoteGate();
  syncOnboardingPlanGate();
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
    const premium = onboardingSelectedPlan === "premium";
    if (!onboardingSelectedPlan) {
      throw new Error("Choose your LinkedIn plan before continuing.");
    }
    if (premium && !premiumVerified) {
      setOnboardingStep(1);
      throw new Error(
        "Verify Premium with the signed-in LinkedIn account before continuing.",
      );
    }
    const settings = await updateSettings({
      premium,
      premiumVerified: premium && premiumVerified,
      connectionDailyLimit: Number(elements.onboardingConnectionLimit.value),
      postEngagements: Number(elements.onboardingPostsPerLead.value),
      onboardingCompleted: true,
      includeNote: false,
    });
    await chrome.storage.local.set({
      validateBeforeCommenting: elements.onboardingValidateComment.checked,
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

async function restartOnboarding() {
  const confirmed = window.confirm(
    "Restart onboarding? This resets your LinkedIn plan and daily pace. Your leads, assignments, and usage history will not be changed.",
  );
  if (!confirmed) return;

  clearMessages();
  setBusy(elements.resetOnboarding, true);
  try {
    const settings = await ScoutApi.authenticatedAction(
      "scouts:resetOnboarding",
      {},
    );
    await chrome.storage.local.set({
      linkedInPremium: false,
      validateBeforeCommenting: false,
    });
    await chrome.storage.local.remove([
      "linkedInPremiumCheckedAt",
      "linkedInPremiumEvidence",
    ]);
    premiumVerified = false;
    savedPlanIsPremium = false;
    dashboard = { ...dashboard, settings };
    renderDashboard(dashboard, Date.now());
    showSuccess("Onboarding reset. Choose a plan to test the setup again.");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(elements.resetOnboarding, false);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  clearMessages();
  setBusy(elements.settingsForm, true);
  try {
    const premium = elements.linkedinPlan.value === "premium";
    if (premium && !premiumVerified) {
      throw new Error(
        "Verify Premium with the signed-in LinkedIn account before saving.",
      );
    }
    const invitationNote = elements.invitationNote.value.trim();
    const includeNote = premium && premiumVerified;
    if (includeNote && !invitationNote) {
      throw new Error("Enter an invitation note before saving your settings.");
    }
    const settings = await updateSettings({
      premium,
      premiumVerified: premium && premiumVerified,
      connectionDailyLimit: Number(elements.connectionDailyLimit.value),
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
    premiumVerified: values.premiumVerified,
    connectionDailyLimit: values.connectionDailyLimit,
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
  onboardingSelectedPlan = null;
  premiumVerified = false;
  elements.onboardingFreePlan.classList.remove("is-selected");
  elements.onboardingPremiumPlan.classList.remove("is-selected");
  elements.onboardingFreePlan.setAttribute("aria-pressed", "false");
  elements.onboardingPremiumPlan.setAttribute("aria-pressed", "false");
  elements.onboardingPremiumCheck.hidden = true;
  elements.onboardingValidateComment.checked = false;
  setOnboardingStep(1);
  syncOnboardingPlanGate();
  elements.onboardingConnectionLimit.value = settings.connectionDailyLimit || 20;
  elements.onboardingPostsPerLead.value =
    settings.postEngagements || RECOMMENDED_POSTS_PER_LEAD;
  elements.updated.textContent = "Complete setup to start automation";
}

function renderSettings(settings) {
  savedPlanIsPremium = settings.linkedinPremium === true;
  premiumVerified = settings.linkedinPremiumVerified === true || premiumVerified;
  elements.linkedinPlan.value = settings.linkedinPremium ? "premium" : "free";
  elements.connectionDailyLimit.value = settings.connectionDailyLimit;
  elements.postEngagements.value = settings.postEngagements;
  updateLimitControls("settings");
  syncPremiumNoteGate();
  void chrome.storage.local
    .get(["validateBeforeCommenting", "invitationNote"])
    .then((stored) => {
      elements.validateComment.checked =
        stored.validateBeforeCommenting ?? false;
      elements.invitationNote.value =
        stored.invitationNote?.trim() || DEFAULT_INVITATION_NOTE;
    });
}

function applyRecommendedLimits(scope) {
  const controls = limitControls(scope);
  const limits = getPlanLimits(scope);
  controls.connection.value = String(limits.requests);
  controls.posts.value = String(RECOMMENDED_POSTS_PER_LEAD);
  updateLimitControls(scope);
}

function updateLimitControls(scope) {
  const controls = limitControls(scope);
  const limits = getPlanLimits(scope);
  const requests = clampNumber(
    controls.connection.value,
    1,
    limits.requests,
  );
  const maximumPosts = Math.min(10, Math.floor(limits.likes / requests));
  const posts = clampNumber(controls.posts.value, 1, maximumPosts);
  const calculatedLikes = requests * posts;
  const remaining = limits.likes - calculatedLikes;

  controls.connection.max = String(limits.requests);
  controls.connection.value = String(requests);
  controls.posts.max = String(maximumPosts);
  controls.posts.value = String(posts);
  controls.calculation.textContent =
    `${requests} request${requests === 1 ? "" : "s"} × ${posts} post${posts === 1 ? "" : "s"} = ${calculatedLikes} likes`;
  controls.capacity.textContent =
    `${remaining} like${remaining === 1 ? "" : "s"} remain below the ${limits.label} limit of ${limits.likes}.`;
  controls.capacityBar.style.width =
    `${Math.min(100, Math.round((calculatedLikes / limits.likes) * 100))}%`;
  controls.postHelp.textContent =
    `Maximum ${maximumPosts} at ${requests} request${requests === 1 ? "" : "s"} per day.`;

  if (scope === "onboarding") {
    elements.onboardingPlanSummary.textContent =
      `${limits.label} LinkedIn · ${limits.requests} request / ${limits.likes} like daily caps`;
  }
}

function limitControls(scope) {
  if (scope === "onboarding") {
    return {
      connection: elements.onboardingConnectionLimit,
      posts: elements.onboardingPostsPerLead,
      calculation: elements.onboardingCalculation,
      capacity: elements.onboardingCapacity,
      capacityBar: elements.onboardingCapacityBar,
      postHelp: elements.onboardingPostHelp,
    };
  }
  return {
    connection: elements.connectionDailyLimit,
    posts: elements.postEngagements,
    calculation: elements.settingsCalculation,
    capacity: elements.settingsCapacity,
    capacityBar: elements.settingsCapacityBar,
    postHelp: elements.settingsPostHelp,
  };
}

function getPlanLimits(scope) {
  const plan =
    scope === "onboarding"
      ? onboardingSelectedPlan || "free"
      : elements.linkedinPlan.value;
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

function clampNumber(value, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  return Math.max(
    minimum,
    Math.min(maximum, Number.isFinite(parsed) ? parsed : minimum),
  );
}

function selectOnboardingPlan(plan) {
  onboardingSelectedPlan = plan;
  premiumVerified = false;
  elements.onboardingFreePlan.classList.toggle("is-selected", plan === "free");
  elements.onboardingPremiumPlan.classList.toggle(
    "is-selected",
    plan === "premium",
  );
  elements.onboardingFreePlan.setAttribute(
    "aria-pressed",
    String(plan === "free"),
  );
  elements.onboardingPremiumPlan.setAttribute(
    "aria-pressed",
    String(plan === "premium"),
  );
  elements.onboardingPremiumCheck.hidden = plan !== "premium";
  elements.onboardingPremiumStatus.textContent =
    plan === "premium" ? "Not verified" : "";
  elements.onboardingPremiumStatus.classList.remove("is-verified", "is-error");
  syncOnboardingPlanGate();
  applyRecommendedLimits("onboarding");
}

function syncOnboardingPlanGate() {
  const premiumSelected = onboardingSelectedPlan === "premium";
  const canContinue =
    onboardingSelectedPlan === "free" || (premiumSelected && premiumVerified);
  elements.onboardingNext.disabled = !canContinue;
  if (premiumSelected && premiumVerified) {
    elements.onboardingPremiumStatus.textContent = "Premium verified";
    elements.onboardingPremiumStatus.classList.add("is-verified");
    elements.onboardingPremiumStatus.classList.remove("is-error");
  }
}

function showOnboardingWorkflowStep() {
  if (
    !onboardingSelectedPlan ||
    (onboardingSelectedPlan === "premium" && !premiumVerified)
  ) {
    return;
  }
  updateLimitControls("onboarding");
  setOnboardingStep(2);
}

function setOnboardingStep(step) {
  const showPlan = step === 1;
  elements.onboardingPlanStep.hidden = !showPlan;
  elements.onboardingWorkflowStep.hidden = showPlan;
  elements.planStepMarker.classList.toggle("is-active", showPlan);
  elements.workflowStepMarker.classList.toggle("is-active", !showPlan);
}

async function verifyOnboardingPremium() {
  clearMessages();
  elements.onboardingVerifyPremium.disabled = true;
  elements.onboardingVerifyPremium.textContent = "Checking LinkedIn...";
  elements.onboardingPremiumStatus.textContent = "Checking real account";
  elements.onboardingPremiumStatus.classList.remove("is-verified", "is-error");
  try {
    const result = await checkPremiumEligibility();
    if (!result.premium) {
      premiumVerified = false;
      elements.onboardingPremiumStatus.textContent = "Premium not detected";
      elements.onboardingPremiumStatus.classList.add("is-error");
      throw new Error(
        result.evidence ||
          "LinkedIn showed a plan purchase flow instead of an active Premium account.",
      );
    }
    premiumVerified = true;
    syncOnboardingPlanGate();
    showSuccess("Premium verified against the signed-in LinkedIn account.");
  } catch (error) {
    syncOnboardingPlanGate();
    showError(error);
  } finally {
    elements.onboardingVerifyPremium.disabled = false;
    elements.onboardingVerifyPremium.textContent = premiumVerified
      ? "Verify again"
      : "Try verification again";
  }
}

async function verifyPremiumAndUnlockNote() {
  clearMessages();
  setPremiumCheckPending(true);
  try {
    showSuccess("Checking LinkedIn Premium eligibility...");
    const result = await checkPremiumEligibility();
    if (!result.premium) {
      premiumVerified = false;
      syncPremiumNoteGate();
      throw new Error(
        result.evidence ||
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
  elements.saveSettings.disabled = premiumSelected && !premiumVerified;
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
  return {
    premium: response.premium === true,
    evidence: String(response.evidence || "").trim(),
  };
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
