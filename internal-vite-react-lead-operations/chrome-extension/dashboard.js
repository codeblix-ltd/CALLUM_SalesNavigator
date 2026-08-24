const elements = {
  app: document.querySelector("#app"),
  loginScreen: document.querySelector("#login-screen"),
  loginForm: document.querySelector("#login-form"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  loginError: document.querySelector("#login-error"),
  sidebarUsername: document.querySelector("#sidebar-username"),
  signOut: document.querySelector("#sign-out"),
  refresh: document.querySelector("#refresh"),
  openLinkedIn: document.querySelector("#open-linkedin"),
  lastUpdated: document.querySelector("#last-updated"),
  pageError: document.querySelector("#page-error"),
  totalCount: document.querySelector("#total-count"),
  freshCount: document.querySelector("#fresh-count"),
  engagedCount: document.querySelector("#engaged-count"),
  reachedCount: document.querySelector("#reached-count"),
  acceptedCount: document.querySelector("#accepted-count"),
  emailCount: document.querySelector("#email-count"),
  attentionCount: document.querySelector("#attention-count"),
  retryFailedLeads: document.querySelector("#retry-failed-leads"),
  completionRate: document.querySelector("#completion-rate"),
  pipeline: document.querySelector("#pipeline"),
  requestUsage: document.querySelector("#request-usage"),
  likeUsage: document.querySelector("#like-usage"),
  requestBar: document.querySelector("#request-bar"),
  likeBar: document.querySelector("#like-bar"),
  resultSummary: document.querySelector("#result-summary"),
  search: document.querySelector("#search"),
  stageFilter: document.querySelector("#stage-filter"),
  sortFilter: document.querySelector("#sort-filter"),
  tableLoading: document.querySelector("#table-loading"),
  tableEmpty: document.querySelector("#table-empty"),
  leadTable: document.querySelector("#lead-table"),
  leadRows: document.querySelector("#lead-rows"),
  pageLabel: document.querySelector("#page-label"),
  previousPage: document.querySelector("#previous-page"),
  nextPage: document.querySelector("#next-page"),
  drawerBackdrop: document.querySelector("#drawer-backdrop"),
  leadDrawer: document.querySelector("#lead-drawer"),
  drawerContent: document.querySelector("#drawer-content"),
  closeDrawer: document.querySelector("#close-drawer"),
};

const state = {
  dashboard: null,
  page: 1,
  pageCount: 1,
  pageSize: 50,
  total: 0,
  leads: [],
  search: "",
  stage: "all",
  sort: "activity",
  requestId: 0,
};

let searchTimer = null;

elements.loginForm.addEventListener("submit", handleLogin);
elements.signOut.addEventListener("click", handleSignOut);
elements.refresh.addEventListener("click", () => loadDashboard({ includeSummary: true }));
elements.retryFailedLeads.addEventListener("click", retryAllFailedLeads);
elements.openLinkedIn.addEventListener("click", () =>
  chrome.tabs.create({ url: "https://www.linkedin.com/feed/", active: true }),
);
elements.stageFilter.addEventListener("change", () => {
  state.stage = elements.stageFilter.value;
  state.page = 1;
  void loadDashboard();
});
elements.sortFilter.addEventListener("change", () => {
  state.sort = elements.sortFilter.value;
  state.page = 1;
  void loadDashboard();
});
elements.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = elements.search.value.trim();
    state.page = 1;
    void loadDashboard();
  }, 300);
});
elements.previousPage.addEventListener("click", () => changePage(-1));
elements.nextPage.addEventListener("click", () => changePage(1));
elements.leadRows.addEventListener("click", handleLeadRowClick);
elements.drawerContent.addEventListener("submit", handleLeadNoteSubmit);
elements.drawerContent.addEventListener("click", handleDrawerActionClick);
elements.closeDrawer.addEventListener("click", closeDrawer);
elements.drawerBackdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});
document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("is-active"));
    link.classList.add("is-active");
  });
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.autoLeadRunState) return;
  const status = String(changes.autoLeadRunState.newValue?.status || "idle");
  elements.retryFailedLeads.disabled = ["running", "pausing", "paused"].includes(status);
  if (
    ["completed", "failed", "stopped"].includes(status) &&
    changes.autoLeadRunState.oldValue?.status !== status
  ) {
    void loadDashboard({ includeSummary: true });
  }
});

void hydrate().catch((error) => {
  showLogin();
  elements.loginError.textContent = readError(error);
  elements.loginError.hidden = false;
});

async function hydrate() {
  const auth = await ScoutApi.getAuth();
  if (!auth) {
    showLogin();
    return;
  }
  await loadDashboard({ includeSummary: true });
}

async function handleLogin(event) {
  event.preventDefault();
  setBusy(elements.loginForm, true);
  elements.loginError.hidden = true;
  try {
    await ScoutApi.signIn(elements.username.value, elements.password.value);
    elements.password.value = "";
    await loadDashboard({ includeSummary: true });
  } catch (error) {
    elements.loginError.textContent = readError(error);
    elements.loginError.hidden = false;
  } finally {
    setBusy(elements.loginForm, false);
  }
}

async function handleSignOut() {
  try {
    await ScoutApi.signOut();
  } finally {
    state.dashboard = null;
    state.leads = [];
    closeDrawer();
    showLogin();
  }
}

async function loadDashboard({ includeSummary = false } = {}) {
  const requestId = ++state.requestId;
  setLoading(true);
  hideError();
  try {
    const progressPromise = ScoutApi.authenticatedAction("scouts:getLeadProgress", {
      page: state.page,
      pageSize: state.pageSize,
      search: state.search,
      stage: state.stage,
      sort: state.sort,
    });
    const [progress, dashboard] = await Promise.all([
      progressPromise,
      includeSummary || !state.dashboard
        ? ScoutApi.authenticatedAction("scouts:getDashboard", {})
        : Promise.resolve(null),
    ]);
    if (requestId !== state.requestId) return;
    if (dashboard) state.dashboard = dashboard;
    state.page = progress.page;
    state.pageCount = progress.pageCount;
    state.total = progress.total;
    state.leads = progress.leads;
    showApp();
    renderSummary(state.dashboard);
    renderLeads(progress);
    elements.lastUpdated.textContent = `Updated ${formatRelativeTime(progress.generatedAt)} · ${formatDateTime(progress.generatedAt)}`;
  } catch (error) {
    if (requestId !== state.requestId) return;
    if (/sign in|required|expired|session/i.test(readError(error))) {
      showLogin();
      elements.loginError.textContent = readError(error);
      elements.loginError.hidden = false;
      return;
    }
    showError(readError(error));
  } finally {
    if (requestId === state.requestId) setLoading(false);
  }
}

function renderSummary(dashboard) {
  if (!dashboard) return;
  const { counts, usage, scout } = dashboard;
  elements.sidebarUsername.textContent = scout.username;
  elements.totalCount.textContent = formatNumber(counts.total);
  elements.freshCount.textContent = formatNumber(counts.fresh);
  elements.engagedCount.textContent = formatNumber(counts.engaged);
  elements.reachedCount.textContent = formatNumber(counts.connectionRequested);
  elements.acceptedCount.textContent = formatNumber(counts.accepted);
  elements.emailCount.textContent = formatNumber(counts.emailCollected);
  elements.attentionCount.textContent = formatNumber(counts.failed);
  elements.retryFailedLeads.hidden = Number(counts.failed || 0) < 1;
  elements.retryFailedLeads.textContent = `Retry ${formatNumber(counts.failed)} failed lead${Number(counts.failed) === 1 ? "" : "s"}`;
  const completion = counts.total ? Math.round((counts.emailCollected / counts.total) * 100) : 0;
  elements.completionRate.textContent = `${completion}% complete`;
  elements.requestUsage.textContent = `${formatNumber(usage.requestsSent)} of ${formatNumber(usage.requestLimit)}`;
  elements.likeUsage.textContent = `${formatNumber(usage.likesUsed)} of ${formatNumber(usage.engagementLimit)}`;
  elements.requestBar.style.width = percentage(usage.requestsSent, usage.requestLimit);
  elements.likeBar.style.width = percentage(usage.likesUsed, usage.engagementLimit);

  const steps = [
    ["Ready", counts.fresh, "to check"],
    ["Profile", counts.viewed, "opened"],
    ["Engaged", counts.engaged, "with posts"],
    ["Reached out", counts.connectionRequested, "request sent"],
    ["Connected", counts.accepted, "accepted"],
    ["Email", counts.emailCollected, "saved"],
  ];
  elements.pipeline.innerHTML = steps
    .map(([label, value, note]) => `
      <div class="pipeline-step">
        <span class="pipeline-dot"></span>
        <span>${escapeHtml(label)}</span>
        <strong>${formatNumber(value)}</strong>
        <small>${escapeHtml(note)}</small>
      </div>`)
    .join("");
}

function renderLeads(progress) {
  elements.leadRows.innerHTML = "";
  elements.tableEmpty.hidden = progress.leads.length !== 0;
  elements.leadTable.hidden = progress.leads.length === 0;
  const start = progress.total ? (progress.page - 1) * progress.pageSize + 1 : 0;
  const end = Math.min(progress.total, progress.page * progress.pageSize);
  elements.resultSummary.textContent = progress.total
    ? `Showing ${formatNumber(start)}–${formatNumber(end)} of ${formatNumber(progress.total)}`
    : "No leads in this view";
  elements.pageLabel.textContent = `Page ${formatNumber(progress.page)} of ${formatNumber(progress.pageCount)}`;
  elements.previousPage.disabled = progress.page <= 1;
  elements.nextPage.disabled = progress.page >= progress.pageCount;

  for (const lead of progress.leads) {
    const row = document.createElement("tr");
    row.dataset.leadId = lead.id;
    row.tabIndex = 0;
    row.setAttribute("aria-label", `Open details for ${lead.fullName || "unnamed lead"}`);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDrawer(lead);
      }
    });
    const outreachDone = hasOutreach(lead);
    const email = lead.workEmail || lead.originalEmail;
    const emailUnavailable = isEmailUnavailable(lead, email);
    row.innerHTML = `
      <td>${leadCell(lead)}</td>
      <td>${milestoneCell(qualificationLabel(lead), qualificationMeta(lead), lead.qualificationStatus !== "pending", lead.qualificationStatus === "not_qualified" ? "error" : "")}</td>
      <td>${milestoneCell(lead.viewedAt ? "Opened" : "Not opened", shortDate(lead.viewedAt), Boolean(lead.viewedAt))}</td>
      <td>${milestoneCell(lead.engagedAt ? `${formatNumber(lead.postCount)} post${lead.postCount === 1 ? "" : "s"}` : "Not started", shortDate(lead.engagedAt), Boolean(lead.engagedAt))}</td>
      <td>${milestoneCell(outreachDone ? "Reached out" : "Not sent", shortDate(lead.connectionRequestedAt), outreachDone, lead.status === "withdrawn" ? "warning" : "")}</td>
      <td>${milestoneCell(lead.acceptedAt ? "Connected" : "Waiting", shortDate(lead.acceptedAt), Boolean(lead.acceptedAt))}</td>
      <td>${milestoneCell(email ? escapeHtml(email) : emailUnavailable ? "No email available" : lead.status === "connection_requested" ? "Waiting for connection" : "Not checked", email ? emailType(lead) : emailUnavailable ? originalEmailMeta(lead) : lead.status === "connection_requested" ? "Available after acceptance" : workEmailMeta(lead), Boolean(email) || emailUnavailable, lead.workEmailStatus === "error" ? "error" : emailUnavailable ? "warning" : "")}</td>
      <td><span class="stage-pill ${lead.status === "failed" ? "is-error" : ""}">${escapeHtml(stageLabel(lead.status))}</span></td>
      <td><span class="updated-cell">${escapeHtml(formatRelativeTime(lead.updatedAt))}</span></td>`;
    elements.leadRows.append(row);
  }
}

function handleLeadRowClick(event) {
  const row = event.target.closest("tr[data-lead-id]");
  if (!row) return;
  const lead = state.leads.find((item) => item.id === row.dataset.leadId);
  if (lead) openDrawer(lead);
}

function openDrawer(lead) {
  const email = lead.workEmail || lead.originalEmail;
  const emailUnavailable = isEmailUnavailable(lead, email);
  const timeline = [
    timelineItem("Assigned", "Added to your lead list", lead.assignedAt, true),
    timelineItem("Fit check", qualificationDetail(lead), lead.recentPostCheckedAt, lead.qualificationStatus !== "pending", lead.qualificationStatus === "not_qualified"),
    timelineItem("Profile opened", "LinkedIn profile visited", lead.viewedAt, Boolean(lead.viewedAt)),
    timelineItem("Posts engaged", lead.postCount ? `${lead.postCount} post${lead.postCount === 1 ? "" : "s"} liked or commented` : "No post activity recorded", lead.engagedAt, Boolean(lead.engagedAt)),
    timelineItem("Connection request", hasOutreach(lead) ? "Reached out on LinkedIn" : "Not sent yet", lead.connectionRequestedAt, hasOutreach(lead), lead.status === "withdrawn"),
    timelineItem("Connected", lead.repliedAt ? "Connected and replied" : "Request accepted", lead.acceptedAt, Boolean(lead.acceptedAt)),
    timelineItem(email ? "Email saved" : lead.status === "connection_requested" ? "Email waiting" : "Email checked", email || (emailUnavailable ? "No email available on LinkedIn" : lead.status === "connection_requested" ? "Available after connection acceptance" : "Not checked yet"), lead.emailCollectedAt || lead.workEmailCollectedAt || lead.originalEmailCheckedAt, Boolean(email) || emailUnavailable, lead.workEmailStatus === "error"),
  ].join("");
  const failedActions = lead.status === "failed"
    ? `<button type="button" data-drawer-action="retry" data-lead-id="${escapeAttribute(lead.id)}">Retry this lead</button><button class="danger" type="button" data-drawer-action="reject" data-lead-id="${escapeAttribute(lead.id)}" data-lead-name="${escapeAttribute(lead.fullName || "this lead")}">Mark rejected</button>`
    : "";
  elements.drawerContent.innerHTML = `
    <header class="drawer-header">
      <p class="eyebrow">${escapeHtml(stageLabel(lead.status))}</p>
      <h2 id="drawer-name">${escapeHtml(lead.fullName || "Unnamed lead")}</h2>
      <p>${escapeHtml([lead.currentTitle, lead.companyName].filter(Boolean).join(" · ") || "Lead details")}</p>
    </header>
    <div class="drawer-actions"><a href="${escapeAttribute(lead.profileUrl)}" target="_blank" rel="noreferrer">Open LinkedIn profile</a>${failedActions}</div>
    <section class="drawer-section lead-note-section">
      <h3>Lead note</h3>
      <form class="lead-note-form" data-lead-note-form data-lead-id="${escapeAttribute(lead.id)}">
        <label for="lead-note-input">Add context that scouts and administrators should always see for this lead.</label>
        <textarea id="lead-note-input" maxlength="10000" placeholder="Add a note about this lead…">${escapeHtml(lead.leadNote || "")}</textarea>
        <div class="lead-note-footer">
          <span data-lead-note-status>${escapeHtml(lead.leadNoteUpdatedAt ? `Last saved ${formatRelativeTime(lead.leadNoteUpdatedAt)}` : "No note saved yet")}</span>
          <button class="primary-button compact" type="submit">Save note</button>
        </div>
      </form>
    </section>
    <section class="drawer-section"><h3>Workflow progress</h3><div class="timeline">${timeline}</div></section>
    <section class="drawer-section">
      <h3>Lead details</h3>
      <div class="detail-grid">
        ${detailItem("Company", lead.companyName)}
        ${detailItem("Title", lead.currentTitle)}
        ${detailItem("Location", lead.geographicRegion)}
        ${detailItem("Industry", lead.companyIndustry)}
        ${detailItem("Company size", lead.employeeCount ? `${formatNumber(lead.employeeCount)} employees` : lead.companySize)}
        ${detailItem("Fit score", lead.icpScore === null ? null : `${lead.icpScore} / 100`)}
        ${detailItem("Recent post", lead.hasRecentPost === null ? null : lead.hasRecentPost ? "Yes" : "No")}
        ${detailItem("Reached out", hasOutreach(lead) ? "Yes" : "No")}
      </div>
    </section>
    <section class="drawer-section">
      <h3>Contact details</h3>
      <div class="detail-grid">
        ${detailItem("LinkedIn email", lead.originalEmail || (emailUnavailable ? "No email available" : lead.status === "connection_requested" ? "Waiting for connection" : null))}
        ${detailItem("LinkedIn email status", originalEmailMeta(lead))}
        ${detailItem("Work email", lead.workEmail)}
        ${detailItem("Work email status", workEmailMeta(lead))}
        ${detailItem("Reply recorded", lead.repliedAt ? formatDateTime(lead.repliedAt) : null)}
      </div>
    </section>
    ${lead.qualificationNote ? `<section class="drawer-section"><h3>Qualification note</h3><p class="drawer-note">${escapeHtml(lead.qualificationNote)}</p></section>` : ""}
    ${lead.lastError ? `<section class="drawer-section"><h3>Needs attention</h3><p class="drawer-note error">${escapeHtml(lead.lastError)}${lead.lastErrorAt ? `<br />Recorded ${escapeHtml(formatDateTime(lead.lastErrorAt))}` : ""}</p></section>` : ""}`;
  elements.drawerBackdrop.hidden = false;
  elements.leadDrawer.hidden = false;
  document.body.style.overflow = "hidden";
  elements.closeDrawer.focus();
}

async function retryAllFailedLeads() {
  hideError();
  elements.retryFailedLeads.disabled = true;
  elements.retryFailedLeads.textContent = "Starting failed lead retry…";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "RETRY_FAILED_LEADS",
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed leads could not be retried.");
    }
    elements.lastUpdated.textContent =
      "Failed lead retry started. You can follow it in the protected automation window.";
  } catch (error) {
    showError(readError(error));
    elements.retryFailedLeads.disabled = false;
    if (state.dashboard) renderSummary(state.dashboard);
  }
}

async function handleDrawerActionClick(event) {
  const button = event.target.closest("button[data-drawer-action]");
  if (!button) return;
  const leadId = button.dataset.leadId;
  if (!leadId) return;
  hideError();
  button.disabled = true;
  try {
    if (button.dataset.drawerAction === "retry") {
      const response = await chrome.runtime.sendMessage({
        type: "START_AUTO_LEAD",
        leadId,
      });
      if (!response?.ok) {
        throw new Error(response?.error || "This lead could not be retried.");
      }
      closeDrawer();
      elements.lastUpdated.textContent =
        "Lead retry started. Follow it in the protected automation window.";
      return;
    }
    if (button.dataset.drawerAction === "reject") {
      const confirmed = window.confirm(
        `Mark ${button.dataset.leadName || "this lead"} as rejected? It will not be retried again.`,
      );
      if (!confirmed) return;
      await ScoutApi.authenticatedAction("scouts:rejectFailedLead", { leadId });
      closeDrawer();
      await loadDashboard({ includeSummary: true });
    }
  } catch (error) {
    showError(readError(error));
  } finally {
    button.disabled = false;
  }
}

async function handleLeadNoteSubmit(event) {
  const form = event.target.closest("form[data-lead-note-form]");
  if (!form) return;
  event.preventDefault();
  const textarea = form.querySelector("textarea");
  const button = form.querySelector("button[type='submit']");
  const status = form.querySelector("[data-lead-note-status]");
  const leadId = form.dataset.leadId;
  if (!textarea || !button || !status || !leadId) return;

  button.disabled = true;
  textarea.disabled = true;
  status.textContent = "Saving…";
  status.classList.remove("is-error");
  try {
    const result = await ScoutApi.authenticatedAction("scouts:setLeadNote", {
      leadId,
      note: textarea.value,
    });
    const lead = state.leads.find((item) => item.id === leadId);
    if (lead) {
      lead.leadNote = result.note;
      lead.leadNoteUpdatedAt = result.updatedAt;
    }
    textarea.value = result.note || "";
    status.textContent = result.note ? "Saved just now" : "Note cleared";
  } catch (error) {
    status.textContent = readError(error);
    status.classList.add("is-error");
  } finally {
    button.disabled = false;
    textarea.disabled = false;
  }
}

function closeDrawer() {
  elements.drawerBackdrop.hidden = true;
  elements.leadDrawer.hidden = true;
  document.body.style.overflow = "";
}

function timelineItem(title, detail, timestamp, done, error = false) {
  return `<div class="timeline-row ${done ? "is-done" : ""} ${error ? "is-error" : ""}">
    <span class="timeline-marker"></span>
    <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>
    <time>${escapeHtml(timestamp ? shortDate(timestamp) : done ? "Done" : "Pending")}</time>
  </div>`;
}

function detailItem(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "—")}</strong></div>`;
}

function leadCell(lead) {
  const subtitle = [lead.currentTitle, lead.companyName].filter(Boolean).join(" · ") || "Details unavailable";
  return `<div class="lead-cell"><span class="initials">${escapeHtml(initials(lead.fullName))}</span><div><strong>${escapeHtml(lead.fullName || "Unnamed lead")}</strong><span>${escapeHtml(subtitle)}</span></div></div>`;
}

function milestoneCell(label, meta, done, tone = "") {
  const classes = ["milestone", done ? "is-done" : "", tone ? `is-${tone}` : ""].filter(Boolean).join(" ");
  return `<div class="${classes}"><strong>${label}</strong><span>${escapeHtml(meta || "—")}</span></div>`;
}

function qualificationLabel(lead) {
  if (lead.qualificationStatus === "qualified") return "Good fit";
  if (lead.qualificationStatus === "not_qualified") return "Not a fit";
  return "Pending";
}

function qualificationMeta(lead) {
  if (lead.icpScore !== null) return `Score ${lead.icpScore}`;
  return lead.hasRecentPost === true ? "Recent post" : "Not checked";
}

function qualificationDetail(lead) {
  const label = qualificationLabel(lead);
  return lead.icpScore === null ? label : `${label} · score ${lead.icpScore} / 100`;
}

function stageLabel(status) {
  const labels = {
    assigned: "Ready to check",
    viewed: "Profile opened",
    engaged: "Posts engaged",
    connected: "Reached out",
    connection_requested: "Request sent",
    accepted: "Connected",
    email_collected: "Email saved",
    withdrawn: "Request rejected",
    skipped: "Skipped",
    failed: "Needs attention",
  };
  return labels[status] || String(status || "Unknown").replaceAll("_", " ");
}

function hasOutreach(lead) {
  return Boolean(
    lead.connectionRequestedAt ||
      ["connected", "connection_requested", "accepted", "email_collected", "withdrawn"].includes(lead.status),
  );
}

function emailType(lead) {
  if (lead.workEmail) return "Work email";
  return "LinkedIn email";
}

function isEmailUnavailable(lead, email = lead.workEmail || lead.originalEmail) {
  return Boolean(
    !email &&
      lead.originalEmailStatus === "not_found" &&
      ["accepted", "email_collected"].includes(lead.status),
  );
}

function originalEmailMeta(lead) {
  if (lead.originalEmail) return "Found";
  if (lead.status === "connection_requested") return "Available after acceptance";
  if (lead.originalEmailStatus === "not_found") {
    return lead.originalEmailCheckedAt
      ? `Checked ${shortDate(lead.originalEmailCheckedAt)}`
      : "Checked on LinkedIn";
  }
  return "Not checked";
}

function workEmailMeta(lead) {
  if (lead.workEmail) return "Found";
  const labels = {
    pending: "Not checked",
    processing: "Checking",
    found: "Found",
    not_found: "Not found",
    error: "Needs attention",
  };
  return labels[lead.workEmailStatus] || "Not checked";
}

function changePage(direction) {
  const next = state.page + direction;
  if (next < 1 || next > state.pageCount) return;
  state.page = next;
  void loadDashboard();
  document.querySelector("#leads").scrollIntoView({ block: "start" });
}

function showLogin() {
  elements.app.hidden = true;
  elements.loginScreen.hidden = false;
}

function showApp() {
  elements.loginScreen.hidden = true;
  elements.app.hidden = false;
}

function setLoading(loading) {
  elements.refresh.disabled = loading;
  elements.tableLoading.hidden = !loading;
  if (loading) {
    elements.tableEmpty.hidden = true;
    elements.leadTable.hidden = true;
  }
}

function setBusy(container, busy) {
  container.querySelectorAll("button, input").forEach((control) => {
    control.disabled = busy;
  });
}

function showError(message) {
  elements.pageError.textContent = message;
  elements.pageError.hidden = false;
}

function hideError() {
  elements.pageError.hidden = true;
}

function percentage(value, total) {
  return `${total ? Math.min(100, Math.round((value / total) * 100)) : 0}%`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function shortDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(value);
}

function initials(name) {
  if (!name) return "?";
  return String(name)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function readError(error) {
  return String(error?.message || error || "Something went wrong. Try again.")
    .replace(/^.*?Uncaught (?:Error|ConvexError):\s*/s, "")
    .split("\n")[0];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
