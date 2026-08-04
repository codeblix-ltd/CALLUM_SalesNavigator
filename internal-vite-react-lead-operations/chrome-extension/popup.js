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
  checklistCount: document.querySelector("#checklist-count"),
  dailyChecklist: document.querySelector("#daily-checklist"),
  followupCount: document.querySelector("#followup-count"),
  followupList: document.querySelector("#followup-list"),
  leadCheckCount: document.querySelector("#lead-check-count"),
  leadCheckList: document.querySelector("#lead-check-list"),
  oldRequestCount: document.querySelector("#old-request-count"),
  oldRequestList: document.querySelector("#old-request-list"),
  openSentRequests: document.querySelector("#open-sent-requests"),
  openQuestionCount: document.querySelector("#open-question-count"),
  questionForm: document.querySelector("#question-form"),
  questionSubject: document.querySelector("#question-subject"),
  questionMessage: document.querySelector("#question-message"),
  error: document.querySelector("#error"),
  success: document.querySelector("#success"),
  updated: document.querySelector("#updated"),
  connection: document.querySelector("#connection"),
};

const DEFAULT_INVITATION_NOTE =
  "Hi, I saw your profile and would like to connect.";
const RECOMMENDED_POSTS_PER_LEAD = 3;
const PLAN_LIMITS = {
  free: { requests: 20, likes: 150, label: "Free" },
  premium: { requests: 40, likes: 250, label: "Premium" },
};

let dashboard = null;
let scoutOperations = null;
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
elements.dailyChecklist.addEventListener("change", updateDailyTask);
elements.followupList.addEventListener("click", handleFollowupClick);
elements.leadCheckList.addEventListener("click", handleLeadCheckClick);
elements.oldRequestList.addEventListener("click", handleOldRequestClick);
elements.openSentRequests.addEventListener("click", () =>
  chrome.tabs.create({
    url: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
    active: true,
  }),
);
elements.questionForm.addEventListener("submit", sendQuestion);
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
    scoutOperations = null;
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
      throw new Error(response?.error || "We couldn’t update your leads. Try again.");
    }
    renderDashboard(response.dashboard, Date.now());
    if (response.dashboard.settings?.onboardingCompleted) {
      await refreshScoutOperations();
    }
  } catch (error) {
    if (/sign in|required|expired|session/i.test(String(error))) showLogin();
    showError(error);
  } finally {
    setBusy(elements.refresh, false);
  }
}

async function refreshScoutOperations() {
  scoutOperations = await ScoutApi.authenticatedAction(
    "scouts:getScoutOperations",
    {},
  );
  renderScoutOperations(scoutOperations);
}

async function updateDailyTask(event) {
  const checkbox = event.target.closest("input[data-task-key]");
  if (!checkbox) return;
  checkbox.disabled = true;
  clearMessages();
  try {
    await ScoutApi.authenticatedAction("scouts:setDailyTask", {
      taskKey: checkbox.dataset.taskKey,
      completed: checkbox.checked,
    });
    await refreshScoutOperations();
  } catch (error) {
    showError(error);
  } finally {
    checkbox.disabled = false;
  }
}

async function handleFollowupClick(event) {
  const button = event.target.closest("button[data-followup-action]");
  if (!button) return;
  clearMessages();
  setBusy(button, true);
  try {
    const actionName = button.dataset.followupAction;
    if (actionName === "open") {
      await chrome.tabs.create({ url: button.dataset.profileUrl, active: true });
      return;
    }
    if (actionName === "copy") {
      await navigator.clipboard.writeText(button.dataset.message || "");
      showSuccess("Message copied. Send it on LinkedIn, then mark it sent.");
      return;
    }
    await ScoutApi.authenticatedAction("scouts:completeFollowupTask", {
      taskId: button.dataset.taskId,
      outcome: actionName,
    });
    showSuccess(
      actionName === "replied"
        ? "Reply saved. The later follow-ups were closed."
        : actionName === "sent"
          ? "Follow-up marked as sent."
          : "Follow-up skipped.",
    );
    await refreshScoutOperations();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(button, false);
  }
}

async function handleLeadCheckClick(event) {
  const button = event.target.closest("button[data-lead-action]");
  if (!button) return;
  clearMessages();
  setBusy(button, true);
  try {
    if (button.dataset.leadAction === "open") {
      await chrome.tabs.create({ url: button.dataset.profileUrl, active: true });
      return;
    }
    const recentValue = button.dataset.recentPost;
    await ScoutApi.authenticatedAction("scouts:setLeadQualification", {
      leadId: button.dataset.leadId,
      status: button.dataset.status,
      hasRecentPost:
        recentValue === "true" ? true : recentValue === "false" ? false : null,
      note: null,
    });
    await refreshDashboard();
    showSuccess(
      button.dataset.status === "qualified"
        ? "Lead checked and ready."
        : "Lead marked as not a good fit.",
    );
  } catch (error) {
    showError(error);
  } finally {
    setBusy(button, false);
  }
}

async function handleOldRequestClick(event) {
  const button = event.target.closest("button[data-old-request-action]");
  if (!button) return;
  clearMessages();
  if (button.dataset.oldRequestAction === "open") {
    await chrome.tabs.create({ url: button.dataset.profileUrl, active: true });
    return;
  }
  const confirmed = window.confirm(
    "Did you withdraw this request on LinkedIn? Only mark it after LinkedIn confirms it.",
  );
  if (!confirmed) return;
  setBusy(button, true);
  try {
    await ScoutApi.authenticatedAction("scouts:markOldRequestWithdrawn", {
      leadId: button.dataset.leadId,
    });
    await refreshDashboard();
    showSuccess("Old request marked as withdrawn.");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(button, false);
  }
}

async function sendQuestion(event) {
  event.preventDefault();
  clearMessages();
  setBusy(elements.questionForm, true);
  try {
    await ScoutApi.authenticatedAction("scouts:createEscalation", {
      leadId: null,
      subject: elements.questionSubject.value,
      message: elements.questionMessage.value,
    });
    elements.questionForm.reset();
    showSuccess("Question sent to the team.");
    await refreshScoutOperations();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(elements.questionForm, false);
  }
}

async function saveOnboarding(event) {
  event.preventDefault();
  clearMessages();
  setBusy(elements.onboardingForm, true);
  try {
    const premium = onboardingSelectedPlan === "premium";
    if (!onboardingSelectedPlan) {
      throw new Error("Choose your LinkedIn plan first.");
    }
    if (premium && !premiumVerified) {
      setOnboardingStep(1);
      throw new Error(
        "Check your Premium plan before you continue.",
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
    showSuccess("All set. You can start today’s work.");
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
    showSuccess("Checking new connections. Then we’ll work through today’s leads...");
    const response = await chrome.runtime.sendMessage({ type: "START_AUTO_LEAD" });
    if (!response?.ok) {
      throw new Error(response?.error || "We couldn’t finish today’s work. Try again.");
    }
    const result = response.result;
    showSuccess(
      `Done: ${formatCount(result.requestsSent, "connection request")} sent, ${formatCount(result.acceptedMatched, "new connection")}, and ${formatCount(result.emailsCollected, "email address")} saved.`,
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
    "Run setup again? This will reset your LinkedIn plan and daily limits. It will not remove your leads or past work.",
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
    showSuccess("Setup reset. Choose your LinkedIn plan to begin.");
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
        "Check your Premium plan before you save.",
      );
    }
    const invitationNote = elements.invitationNote.value.trim();
    const includeNote = premium && premiumVerified;
    if (includeNote && !invitationNote) {
      throw new Error("Write a connection request note before you save.");
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
    showSuccess("Settings saved.");
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
  elements.updated.textContent = `Updated ${relativeTime(updatedAt)} · counts start over each day`;
  elements.connection.classList.remove("error");
  elements.connection.lastChild.textContent = " Ready";
  renderSettings(value.settings);
}

function renderScoutOperations(value) {
  const dailyDone = value.dailyTasks.filter((task) => task.completed).length;
  const followupsDue = value.followups.filter((task) => task.isDue).length;
  elements.checklistCount.textContent = `${dailyDone} / ${value.dailyTasks.length}`;
  elements.followupCount.textContent = `${followupsDue} due`;
  elements.leadCheckCount.textContent = `${value.leadsToCheck.length} waiting`;
  elements.oldRequestCount.textContent = `${value.oldRequests.length} waiting`;
  elements.openQuestionCount.textContent = `${value.openEscalations} ${value.openEscalations === 1 ? "question" : "questions"} open`;
  renderDailyChecklist(value.dailyTasks);
  renderFollowups(value.followups);
  renderLeadChecks(value.leadsToCheck);
  renderOldRequests(value.oldRequests);
}

function renderDailyChecklist(tasks) {
  elements.dailyChecklist.replaceChildren();
  if (tasks.length === 0) {
    elements.dailyChecklist.append(emptyToolMessage("No checklist items today."));
    return;
  }
  for (const task of tasks) {
    const label = document.createElement("label");
    label.className = "task-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.dataset.taskKey = task.taskKey;
    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = task.label;
    const help = document.createElement("small");
    help.textContent = task.helpText;
    text.append(title, help);
    label.append(checkbox, text);
    elements.dailyChecklist.append(label);
  }
}

function renderFollowups(tasks) {
  elements.followupList.replaceChildren();
  if (tasks.length === 0) {
    elements.followupList.append(emptyToolMessage("No follow-ups are waiting."));
    return;
  }
  for (const task of tasks) {
    const item = toolItem(
      task.fullName || "Unnamed lead",
      task.isDue ? `Step ${task.step} · due now` : `Step ${task.step} · ${timeUntil(task.dueAt)}`,
      task.messageText,
    );
    const actions = item.querySelector(".tool-actions");
    actions.append(
      toolButton("Open profile", { followupAction: "open", profileUrl: task.profileUrl }),
      toolButton("Copy message", { followupAction: "copy", message: task.messageText }),
      toolButton("Mark sent", { followupAction: "sent", taskId: task.id }, "good"),
      toolButton("They replied", { followupAction: "replied", taskId: task.id }),
      toolButton("Skip", { followupAction: "skipped", taskId: task.id }, "warn"),
    );
    elements.followupList.append(item);
  }
}

function renderLeadChecks(leads) {
  elements.leadCheckList.replaceChildren();
  if (leads.length === 0) {
    elements.leadCheckList.append(emptyToolMessage("No new leads need checking."));
    return;
  }
  for (const lead of leads) {
    const detail = [lead.currentTitle, lead.companyName].filter(Boolean).join(" · ");
    const item = toolItem(
      lead.fullName || "Unnamed lead",
      `Fit score ${lead.icpScore} / 100`,
      detail || lead.icpReason,
    );
    if (detail) {
      const reason = document.createElement("small");
      reason.textContent = lead.icpReason;
      item.insertBefore(reason, item.querySelector(".tool-actions"));
    }
    const actions = item.querySelector(".tool-actions");
    actions.append(
      toolButton("Open profile", { leadAction: "open", profileUrl: lead.profileUrl }),
      toolButton("Good fit + recent post", {
        leadAction: "save",
        leadId: lead.leadId,
        status: "qualified",
        recentPost: "true",
      }, "good"),
      toolButton("Good fit, no recent post", {
        leadAction: "save",
        leadId: lead.leadId,
        status: "qualified",
        recentPost: "false",
      }),
      toolButton("Not a good fit", {
        leadAction: "save",
        leadId: lead.leadId,
        status: "not_qualified",
        recentPost: "null",
      }, "warn"),
    );
    elements.leadCheckList.append(item);
  }
}

function renderOldRequests(requests) {
  elements.oldRequestList.replaceChildren();
  if (requests.length === 0) {
    elements.oldRequestList.append(emptyToolMessage("No old requests need checking."));
    return;
  }
  for (const request of requests) {
    const item = toolItem(
      request.fullName || "Unnamed lead",
      `${request.ageDays} days old`,
      "Withdraw this request on LinkedIn first.",
    );
    item.querySelector(".tool-actions").append(
      toolButton("Open profile", {
        oldRequestAction: "open",
        profileUrl: request.profileUrl,
      }),
      toolButton("Mark withdrawn", {
        oldRequestAction: "mark",
        leadId: request.leadId,
      }, "warn"),
    );
    elements.oldRequestList.append(item);
  }
}

function toolItem(titleText, metaText, bodyText) {
  const item = document.createElement("article");
  item.className = "tool-item";
  const head = document.createElement("div");
  head.className = "tool-item-head";
  const title = document.createElement("strong");
  title.textContent = titleText;
  const meta = document.createElement("small");
  meta.textContent = metaText;
  head.append(title, meta);
  const body = document.createElement("p");
  body.textContent = bodyText;
  const actions = document.createElement("div");
  actions.className = "tool-actions";
  item.append(head, body, actions);
  return item;
}

function toolButton(label, data, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = className;
  for (const [key, value] of Object.entries(data)) {
    button.dataset[key] = String(value);
  }
  return button;
}

function emptyToolMessage(message) {
  const paragraph = document.createElement("p");
  paragraph.className = "tool-empty";
  paragraph.textContent = message;
  return paragraph;
}

function timeUntil(timestamp) {
  const milliseconds = new Date(timestamp).getTime() - Date.now();
  if (milliseconds <= 0) return "due now";
  const hours = Math.ceil(milliseconds / 3_600_000);
  if (hours < 24) return `due in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.ceil(hours / 24);
  return `due in ${days} day${days === 1 ? "" : "s"}`;
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
  elements.updated.textContent = "Finish setup to get started";
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
    `You can use ${remaining} more like${remaining === 1 ? "" : "s"}. Your ${limits.label} limit is ${limits.likes}.`;
  controls.capacityBar.style.width =
    `${Math.min(100, Math.round((calculatedLikes / limits.likes) * 100))}%`;
  controls.postHelp.textContent =
    `You can choose up to ${maximumPosts} with ${requests} request${requests === 1 ? "" : "s"} a day.`;

  if (scope === "onboarding") {
    elements.onboardingPlanSummary.textContent =
      `${limits.label} LinkedIn: up to ${limits.requests} requests and ${limits.likes} likes a day`;
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
    plan === "premium" ? "Not checked" : "";
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
    elements.onboardingPremiumStatus.textContent = "Premium is active";
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
  elements.onboardingPremiumStatus.textContent = "Checking your plan";
  elements.onboardingPremiumStatus.classList.remove("is-verified", "is-error");
  try {
    const result = await checkPremiumEligibility();
    if (!result.premium) {
      premiumVerified = false;
      elements.onboardingPremiumStatus.textContent = "Premium not found";
      elements.onboardingPremiumStatus.classList.add("is-error");
      throw new Error(
        result.evidence ||
          "Premium is not active on this LinkedIn account.",
      );
    }
    premiumVerified = true;
    syncOnboardingPlanGate();
    showSuccess("Premium is active. You can continue.");
  } catch (error) {
    syncOnboardingPlanGate();
    showError(error);
  } finally {
    elements.onboardingVerifyPremium.disabled = false;
    elements.onboardingVerifyPremium.textContent = premiumVerified
      ? "Check again"
      : "Try again";
  }
}

async function verifyPremiumAndUnlockNote() {
  clearMessages();
  setPremiumCheckPending(true);
  try {
    showSuccess("Checking your Premium plan...");
    const result = await checkPremiumEligibility();
    if (!result.premium) {
      premiumVerified = false;
      syncPremiumNoteGate();
      throw new Error(
        result.evidence ||
          "Premium is not active on this LinkedIn account. Check the account and try again.",
      );
    }
    premiumVerified = true;
    syncPremiumNoteGate();
    showSuccess("Premium is active. You can now add a note.");
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
  elements.premiumNoteStatus.textContent = unlocked
    ? "On"
    : premiumSelected
      ? "Not checked"
      : "Off";
  elements.premiumNoteTitle.textContent = unlocked
    ? "Your note is ready"
    : premiumSelected
      ? "Check your Premium plan"
      : "Premium only";
  elements.premiumNoteDescription.textContent = unlocked
    ? "This note will be sent with each new connection request."
    : premiumSelected
      ? "We need to check that Premium is active before you can add a note."
      : "Choose LinkedIn Premium above to add a note to connection requests.";
  elements.verifyPremium.textContent = premiumVerified
    ? "Check again"
    : "Check Premium";
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
  elements.premiumNoteTitle.textContent = "Checking your plan...";
  elements.premiumNoteDescription.textContent =
    "This may take a few seconds.";
  elements.verifyPremium.textContent = "Checking...";
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
      response?.error || "We couldn’t check your Premium plan. Try again.",
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
  elements.updated.textContent = "Sign in to see your leads";
}

function showError(error, report = false) {
  const message = cleanError(error);
  elements.success.hidden = true;
  elements.error.textContent = message;
  elements.error.hidden = false;
  elements.connection.classList.add("error");
  elements.connection.lastChild.textContent = " Needs attention";
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

function formatCount(value, singular, plural = `${singular}s`) {
  const count = Number(value) || 0;
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

function relativeTime(timestamp) {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - Number(timestamp || Date.now())) / 1000),
  );
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} sec ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}

function cleanError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/^.*?Uncaught (?:Error|ConvexError):\s*/s, "")
    .split("\n")[0];
}
