import {
  assertSafeSimulatorLocation,
  runLeadSimulation,
} from "./simulator-engine.js";

assertSafeSimulatorLocation(window.location);

const elements = {
  batchSize: document.querySelector("#batch-size"),
  run: document.querySelector("#run-simulation"),
  stop: document.querySelector("#stop-simulation"),
  progress: document.querySelector("#progress-bar"),
  runStatus: document.querySelector("#run-status"),
  profile: document.querySelector("#profile"),
  avatar: document.querySelector("#avatar"),
  profileName: document.querySelector("#profile-name"),
  profileTitle: document.querySelector("#profile-title"),
  profileCompany: document.querySelector("#profile-company"),
  contactLink: document.querySelector('[data-testid="contact-info-link"]'),
  connect: document.querySelector("#connect-button"),
  connectionState: document.querySelector("#connection-state"),
  connectionNote: document.querySelector("#connection-note"),
  postsCard: document.querySelector("#posts-card"),
  posts: document.querySelector("#posts"),
  postCounter: document.querySelector("#post-counter"),
  postTemplate: document.querySelector("#post-template"),
  activityLog: document.querySelector("#activity-log"),
  completedCount: document.querySelector("#completed-count"),
  contactOverlay: document.querySelector("#contact-overlay"),
  closeContact: document.querySelector("#close-contact"),
  contactPerson: document.querySelector("#contact-person"),
  contactEmail: document.querySelector('[data-testid="contact-email"]'),
};

let running = false;
let stopRequested = false;
let currentLead = null;
let completed = 0;

elements.run.addEventListener("click", () => void runBatch());
elements.stop.addEventListener("click", () => {
  stopRequested = true;
  elements.stop.disabled = true;
  setRunStatus("Stopping after the current safe step…");
});
elements.contactLink.addEventListener("click", (event) => {
  event.preventDefault();
  elements.contactOverlay.hidden = false;
});
elements.closeContact.addEventListener("click", () => {
  elements.contactOverlay.hidden = true;
});
elements.connect.addEventListener("click", () => {
  elements.connectionState.textContent = "Request sent";
  elements.connect.disabled = true;
});

const parameters = new URLSearchParams(window.location.search);
elements.batchSize.value = String(clampBatch(parameters.get("batch")));
if (parameters.get("auto") === "1") void runBatch();

async function runBatch() {
  if (running) return;
  running = true;
  stopRequested = false;
  completed = 0;
  const requested = clampBatch(elements.batchSize.value);
  elements.batchSize.value = String(requested);
  elements.run.disabled = true;
  elements.stop.disabled = false;
  elements.stop.hidden = false;
  elements.activityLog.replaceChildren();
  setProgress(0);
  appendLog("Simulator started", `${requested} lead batch`);

  try {
    for (let index = 0; index < requested; index += 1) {
      if (stopRequested) break;
      setRunStatus(`Claiming simulated lead ${index + 1} of ${requested}…`);
      currentLead = await ScoutApi.authenticatedAction(
        "simulations:claimNextLead",
      );
      if (!currentLead) {
        appendLog(
          "Queue complete",
          "No assigned leads remain that have not already been simulated",
        );
        break;
      }
      const dashboard = await ScoutApi.authenticatedAction(
        "scouts:getDashboard",
      );
      await runCurrentLead(currentLead, dashboard.settings);
      completed += 1;
      elements.completedCount.textContent = `${completed} complete`;
      setProgress((completed / requested) * 100);
      await refreshExtensionDashboard();
    }
    setRunStatus(
      stopRequested
        ? `Stopped safely after ${completed} completed lead${completed === 1 ? "" : "s"}.`
        : `Simulation complete: ${completed} lead${completed === 1 ? "" : "s"}.`,
    );
  } catch (error) {
    const message = cleanError(error);
    appendLog("Simulation error", message, "error");
    setRunStatus(`Stopped: ${message}`, true);
    await recordFailure(message);
  } finally {
    running = false;
    currentLead = null;
    elements.run.disabled = false;
    elements.stop.hidden = true;
    await refreshExtensionDashboard().catch(() => {});
  }
}

async function runCurrentLead(lead, settings) {
  appendLog("Lead claimed", lead.fullName || "Unnamed fixture lead");
  const result = await runLeadSimulation({
    lead,
    settings,
    api: {
      draftComment: async (postText) => {
        assertNotStopped();
        appendLog("GPT-5.6 Luna", "Drafting a fixture comment");
        return ScoutApi.authenticatedAction("scouts:draftComment", {
          postText,
        });
      },
      transition: async (status, details = {}) => {
        assertNotStopped();
        await ScoutApi.authenticatedAction("simulations:updateStatus", {
          simulationRunId: lead.simulationRunId,
          status,
          postCount: details.postCount ?? null,
          note: details.note ?? null,
          email: details.email ?? null,
          error: null,
        });
      },
    },
    view: createDomAdapter(),
  });
  appendLog(
    "Lead completed",
    `${result.postsEngaged} posts · invitation accepted · ${result.email}`,
    "success",
  );
}

function createDomAdapter() {
  return {
    async visitProfile(fixture) {
      history.replaceState(null, "", `#profile/${encodeURIComponent(fixture.id)}`);
      renderFixtureProfile(fixture);
      appendLog("Profile visited", `${fixture.name} · local fixture DOM`);
      await shortPause();
    },
    async focusPost(post, index, total) {
      assertNotStopped();
      const article = requirePost(post.id);
      for (const item of elements.posts.querySelectorAll(".mock-post")) {
        item.classList.toggle("active", item === article);
      }
      article.scrollIntoView({ behavior: "smooth", block: "center" });
      elements.postCounter.textContent = `${index + 1} / ${total}`;
      appendLog("Post read", `Fixture post ${index + 1} of ${total}`);
      await shortPause();
    },
    async reactToPost(post) {
      assertNotStopped();
      const article = requirePost(post.id);
      const button = article.querySelector('[data-action="react"]');
      button.click();
      appendLog("Reaction recorded", post.id);
      await shortPause();
    },
    async commentOnPost(post, draft) {
      assertNotStopped();
      const article = requirePost(post.id);
      const textarea = article.querySelector("textarea");
      textarea.value = draft;
      article.querySelector('[data-action="submit-comment"]').click();
      appendLog("Comment posted", draft);
      await shortPause();
    },
    async recordStatus(status) {
      appendLog("Simulation database", formatStatus(status), "database");
      await refreshExtensionDashboard();
    },
    async sendInvitation(note) {
      assertNotStopped();
      elements.connectionNote.textContent = note || "Sent without a note";
      elements.connect.click();
      appendLog(
        "Invitation sent",
        note ? `Additional note: ${note}` : "No additional note",
      );
      await shortPause();
    },
    async acceptInvitation() {
      assertNotStopped();
      elements.connectionState.textContent = "Accepted";
      appendLog("Invitation accepted", "Fixture acceptance event detected");
      await shortPause();
    },
    async openContactInfo() {
      assertNotStopped();
      elements.contactLink.click();
      appendLog("Contact overlay opened", "Fixture DOM link clicked");
      await shortPause();
    },
    async readContactEmail() {
      assertNotStopped();
      const email = elements.contactEmail.textContent.trim();
      appendLog("Fixture email extracted", email);
      await shortPause();
      return email;
    },
  };
}

function renderFixtureProfile(fixture) {
  elements.profile.hidden = false;
  elements.postsCard.hidden = false;
  elements.contactOverlay.hidden = true;
  elements.profileName.textContent = fixture.name;
  elements.profileTitle.textContent = fixture.title;
  elements.profileCompany.textContent = fixture.company;
  elements.avatar.textContent = initials(fixture.name);
  elements.connectionState.textContent = "Not connected";
  elements.connectionNote.textContent = "";
  elements.connect.disabled = false;
  elements.contactPerson.textContent = fixture.name;
  elements.contactEmail.textContent = fixture.email;
  elements.contactEmail.href = `mailto:${fixture.email}`;
  elements.posts.replaceChildren();

  for (const post of fixture.posts) {
    const fragment = elements.postTemplate.content.cloneNode(true);
    const article = fragment.querySelector(".mock-post");
    article.dataset.postId = post.id;
    article.querySelector(".post-avatar").textContent = initials(fixture.name);
    article.querySelector(".post-author").textContent = fixture.name;
    article.querySelector("[data-post-text]").textContent = post.text;
    wirePost(article);
    elements.posts.append(fragment);
  }
  elements.postCounter.textContent = `0 / ${fixture.posts.length}`;
}

function wirePost(article) {
  article.querySelector('[data-action="react"]').addEventListener("click", (event) => {
    const reacted = event.currentTarget.dataset.reacted === "true";
    event.currentTarget.dataset.reacted = String(!reacted);
    event.currentTarget.textContent = reacted ? "♡ React" : "♥ Reacted";
    article.classList.toggle("reacted", !reacted);
  });
  article.querySelector('[data-action="comment"]').addEventListener("click", () => {
    article.querySelector("textarea").focus();
  });
  article
    .querySelector('[data-action="submit-comment"]')
    .addEventListener("click", () => {
      const textarea = article.querySelector("textarea");
      const value = textarea.value.trim();
      if (!value) return;
      const comment = document.createElement("p");
      comment.textContent = value;
      article.querySelector(".comments").append(comment);
      textarea.value = "";
    });
}

function requirePost(postId) {
  const article = [...elements.posts.querySelectorAll(".mock-post")].find(
    (item) => item.dataset.postId === postId,
  );
  if (!article) throw new Error(`Fixture post ${postId} is missing from the DOM.`);
  return article;
}

async function recordFailure(message) {
  if (!currentLead) return;
  await ScoutApi.authenticatedAction("simulations:updateStatus", {
    simulationRunId: currentLead.simulationRunId,
    status: "failed",
    postCount: null,
    note: null,
    email: null,
    error: `Simulation: ${message}`,
  }).catch(() => {});
}

async function refreshExtensionDashboard() {
  const response = await chrome.runtime.sendMessage({
    type: "REFRESH_SCOUT_DASHBOARD",
  });
  if (!response?.ok) throw new Error(response?.error || "Dashboard refresh failed.");
}

function appendLog(title, detail, tone = "default") {
  const item = document.createElement("li");
  item.dataset.tone = tone;
  const heading = document.createElement("strong");
  const text = document.createElement("span");
  const time = document.createElement("small");
  heading.textContent = title;
  text.textContent = detail;
  time.textContent = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
  item.append(heading, text, time);
  elements.activityLog.prepend(item);
}

function assertNotStopped() {
  if (stopRequested) throw new Error("Simulation stopped by the scout.");
}

function setRunStatus(message, isError = false) {
  elements.runStatus.textContent = message;
  elements.runStatus.classList.toggle("error", isError);
}

function setProgress(percent) {
  elements.progress.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function shortPause() {
  return new Promise((resolve) => setTimeout(resolve, 220));
}

function clampBatch(value) {
  return Math.max(1, Math.min(10, Math.trunc(Number(value) || 1)));
}

function initials(name) {
  return String(name)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatStatus(status) {
  return String(status)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/^.*?Uncaught (?:Error|ConvexError):\s*/s, "")
    .split("\n")[0];
}
