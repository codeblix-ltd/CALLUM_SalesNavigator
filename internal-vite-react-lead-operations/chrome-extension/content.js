// Callum Leads - Content Script for LinkedIn Automation

(() => {
  if (window.__CALLUM_SCOUT_CONTENT_LOADED__) return;
  window.__CALLUM_SCOUT_CONTENT_LOADED__ = true;

  let overlayContainer = null;

  // Listen for messages from background script or popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "EXECUTE_POST_ENGAGEMENT") {
      return runVisibleWorkflow(
        () => runPostEngagement(message.options || {}),
        sendResponse,
      );
    }

    if (message?.type === "EXECUTE_CONNECTION_REQUEST") {
      return runVisibleWorkflow(
        () => runConnectionRequest(message.options || {}),
        sendResponse,
      );
    }

    if (message?.type === "SCAN_RECENT_CONNECTIONS") {
      return runVisibleWorkflow(
        () => runRecentConnectionsScan(message.options || {}),
        sendResponse,
      );
    }

    if (message?.type === "EXTRACT_CONTACT_INFO") {
      return runVisibleWorkflow(
        () => runContactInfoExtraction(message.options || {}),
        sendResponse,
      );
    }

    if (message?.type === "GET_PAGE_INFO") {
      sendResponse({
        url: window.location.href,
        isRecentActivity: window.location.pathname.includes("/recent-activity"),
        isProfile: window.location.pathname.startsWith("/in/"),
      });
      return false;
    }

    if (message?.type === "INSPECT_PREMIUM_ACCOUNT") {
      try {
        sendResponse({ ok: true, ...inspectPremiumAccount() });
      } catch (error) {
        sendResponse({ ok: false, error: cleanError(error) });
      }
      return false;
    }

    if (message?.type === "SHOW_AUTOMATION_ERROR") {
      showWorkflowError(message.error || "Something went wrong. Try again.");
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "SHOW_AUTOMATION_STATUS") {
      initOverlay();
      if (overlayContainer) overlayContainer.style.display = "block";
      updateStatus(message.status || "Still working...");
      sendResponse({ ok: true });
      return false;
    }
  });

  function inspectPremiumAccount() {
    const premiumRoute =
      window.location.pathname.replace(/\/+$/, "") === "/premium/my-premium";
    if (!premiumRoute) {
      return {
        premium: false,
        evidence: "LinkedIn did not open the Premium page. Try again.",
      };
    }

    const root = document.querySelector("main") || document.body;
    const visibleSignals = Array.from(
      root.querySelectorAll(
        "h1, h2, h3, [role='group'], [role='progressbar'], a, button",
      ),
    )
      .filter(
        (element) =>
          isElementVisible(element) &&
          !element.closest("#callum-scout-overlay"),
      )
      .slice(0, 120)
      .map((element) => element.textContent?.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const pageSignals = `${document.title} ${visibleSignals.join(" ")}`;
    const purchaseSignals = [
      /plan recommendation/i,
      /personalizing your plan/i,
      /get noticed by the right people with premium/i,
      /what could you use support with today/i,
      /reactivate premium/i,
      /try premium/i,
      /start (?:a )?free trial/i,
      /choose (?:a|your) premium plan/i,
    ];
    if (purchaseSignals.some((pattern) => pattern.test(pageSignals))) {
      return {
        premium: false,
        evidence:
          "Premium is not active on this LinkedIn account.",
      };
    }

    const hasManagementLink = Array.from(
      root.querySelectorAll(
        "a[href*='manage-premium-account'], a[href*='manage-subscription'], a[href*='subscription-management']",
      ),
    ).some(isElementVisible);
    const subscriberSignals = [
      /manage premium account/i,
      /manage (?:your )?subscription/i,
      /subscription details/i,
      /your premium subscription/i,
      /premium subscription is active/i,
      /billing (?:details|information)/i,
      /renewal date/i,
      /(^|\s)my premium($|\s)/i,
    ];
    if (
      hasManagementLink ||
      subscriberSignals.some((pattern) => pattern.test(pageSignals))
    ) {
      return {
        premium: true,
        evidence:
          "Premium is active on this LinkedIn account.",
      };
    }

    return {
      premium: false,
      evidence:
        "We couldn’t find an active Premium plan. Check the LinkedIn account and try again.",
    };
  }

  // Inject overlay widget automatically on LinkedIn pages
  if (window.location.hostname.includes("linkedin.com")) {
    window.addEventListener("DOMContentLoaded", initOverlay);
    if (document.readyState === "complete" || document.readyState === "interactive") {
      initOverlay();
    }
  }

  function initOverlay() {
    if (document.getElementById("callum-scout-overlay")) return;
    overlayContainer = document.createElement("div");
    overlayContainer.id = "callum-scout-overlay";
    overlayContainer.innerHTML = `
      <div class="callum-header">
        <div class="callum-brand">
          <span>Callum Scout</span>
          <span class="callum-badge">Ready</span>
        </div>
        <button class="callum-close" id="callum-close-btn" title="Close">&times;</button>
      </div>
      <div class="callum-body">
        <div class="callum-status-row">
          <div class="callum-pulse"></div>
          <span id="callum-status-text">Ready</span>
        </div>
        <div id="callum-validation-container" style="display: none;"></div>
        <ul class="callum-log-list" id="callum-log-list">
          <li><strong>Ready:</strong> Callum Scout can work on this page</li>
        </ul>
      </div>
    `;
    document.body.appendChild(overlayContainer);

    document.getElementById("callum-close-btn")?.addEventListener("click", () => {
      overlayContainer.style.display = "none";
    });
  }

  function updateStatus(text) {
    const el = document.getElementById("callum-status-text");
    if (el) el.textContent = text;
    document.querySelector(".callum-status-row")?.removeAttribute("data-state");
    addLog("Update", text);
  }

  function showWorkflowError(error) {
    initOverlay();
    if (overlayContainer) overlayContainer.style.display = "block";
    const message = cleanError(error);
    const status = document.getElementById("callum-status-text");
    const nextStatus = `Stopped: ${message}`;
    const alreadyShown = status?.textContent === nextStatus;
    if (status) status.textContent = nextStatus;
    document
      .querySelector(".callum-status-row")
      ?.setAttribute("data-state", "error");
    if (!alreadyShown) addLog("Problem", message);
  }

  function addLog(title, detail) {
    const list = document.getElementById("callum-log-list");
    if (!list) return;
    const item = document.createElement("li");
    item.innerHTML = `<strong>${escapeHtml(title)}:</strong> ${escapeHtml(detail)}`;
    list.prepend(item);
  }

  function runVisibleWorkflow(workflow, sendResponse) {
    Promise.resolve()
      .then(workflow)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => {
        const message = cleanError(error);
        showWorkflowError(message);
        sendResponse({ ok: false, error: message });
      });
    return true;
  }

  // --- Core Automation Functions ---

  async function runPostEngagement(options = {}) {
    initOverlay();
    if (overlayContainer) overlayContainer.style.display = "block";
    updateStatus("Looking for posts...");

    // Get settings from storage if not provided
    const stored = await chrome.storage.local.get([
      "scoutDashboard",
      "validateBeforeCommenting",
    ]);
    const settings = stored.scoutDashboard?.settings || {};
    const maxPosts = clampInteger(
      options.postEngagements ?? settings.postEngagements ?? 2,
      0,
      10,
    );
    const validate =
      options.validateBeforeCommenting ??
      stored.validateBeforeCommenting ??
      false;

    if (!options.leadId || !options.profileUrl) {
      throw new Error("This lead is missing some information. Go back to the extension and try again.");
    }

    addLog("Settings", `Posts: ${maxPosts}, Check comments: ${validate ? "Yes" : "No"}`);

    if (maxPosts === 0) {
      updateStatus("Skipping posts. Next: connection request.");
      return { engagedCount: 0, totalProcessed: 0, skipped: true };
    }

    if (!window.location.pathname.includes("/recent-activity/")) {
      throw new Error(
        "This lead’s Posts page did not open. Go back to the extension and try again.",
      );
    }

    // LinkedIn renders the activity feed after the document load event. Wait for
    // the actual post/action DOM from doc.md instead of taking one early snapshot.
    updateStatus("Waiting for posts to load...");
    const posts = await findPostElements({
      timeoutMs: 30_000,
      minimumCount: maxPosts,
    });
    if (!posts || posts.length === 0) {
      throw new Error(
        "We couldn’t find any recent posts. Make sure you’re signed in to LinkedIn and that this lead has posts.",
      );
    }

    const countToEngage = Math.min(posts.length, maxPosts);
    addLog("Posts", `Found ${posts.length}. Working on ${countToEngage}.`);

    let engagedCount = 0;
    const activities = [];

    for (let i = 0; i < countToEngage; i++) {
      const postEl = posts[i];
      updateStatus(`Working on post ${i + 1} of ${countToEngage}...`);

      // Scroll post into view
      postEl.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(1000);

      // 1. Click 'Like' button
      const likeResult = await handleLikeButton(postEl);
      if (!likeResult.success) {
        addLog("Problem", `Couldn’t like post ${i + 1}`);
        continue;
      }
      addLog(
        likeResult.changed ? "Liked" : "Like",
        likeResult.changed
          ? `Liked post ${i + 1}`
          : `Post ${i + 1} was already liked`,
      );

      // 2. Click 'see more' if present and extract full post commentary text
      await handleSeeMore(postEl);
      const postText = extractPostText(postEl);
      const postUrl = extractPostUrl(postEl);

      if (!postText || postText.length < 30) {
        addLog("Skipped", `Post ${i + 1} did not have enough text for a comment`);
        continue;
      }
      if (!postUrl) {
        throw new Error(
          `We couldn’t save post ${i + 1}, so no comment was posted.`,
        );
      }

      addLog("Read", `"${postText.substring(0, 60)}..."`);

      // 3. Request a draft comment
      updateStatus(`Writing a comment for post ${i + 1}...`);
      const response = await ScoutApi.authenticatedAction("scouts:draftComment", {
        postText: postText.slice(0, 8_000),
      });
      let draftText = response?.draft?.trim() || "";
      if (!draftText) {
        throw new Error(`No comment was created for post ${i + 1}. Try again.`);
      }

      // 4. Handle Comment Validation Option
      if (validate) {
        updateStatus(`Waiting for you to check comment ${i + 1}...`);
        const userApprovedText = await promptValidationUI(postText, draftText, i + 1);
        if (!userApprovedText) {
          addLog("Skipped", `You skipped the comment for post ${i + 1}`);
          continue;
        }
        draftText = userApprovedText;
      }

      // 5. Click 'Comment' button under post
      updateStatus(`Opening the comment box for post ${i + 1}...`);
      const commentBoxOpened = await openCommentBox(postEl);
      if (!commentBoxOpened) {
        addLog("Problem", `Couldn’t open the comment box for post ${i + 1}`);
        continue;
      }

      await sleep(1200);

      // 6. Type comment into Quill contenteditable editor
      updateStatus(`Adding the comment to post ${i + 1}...`);
      const typed = await typeCommentInQuill(postEl, draftText);
      if (!typed) {
        addLog("Problem", `Couldn’t add the comment to post ${i + 1}`);
        continue;
      }

      await sleep(1000);

      // 7. Click 'Comment' submit button
      updateStatus(`Posting comment ${i + 1}...`);
      const submitted = await submitComment(postEl);
      if (submitted) {
        await ScoutApi.authenticatedAction("scouts:recordPostActivity", {
          leadId: String(options.leadId),
          profileUrl: String(options.profileUrl),
          postUrl,
          postText: postText.slice(0, 8_000),
          commentText: draftText.slice(0, 2_000),
          liked: likeResult.changed,
        });
        engagedCount++;
        activities.push({
          postUrl,
          commentText: draftText,
          liked: likeResult.changed,
        });
        addLog("Commented", `Posted a comment on post ${i + 1}`);
      } else {
        addLog("Problem", `Couldn’t post the comment on post ${i + 1}`);
      }

      await sleep(2000);
    }

    if (engagedCount !== countToEngage) {
      throw new Error(
        `Finished ${engagedCount} of ${countToEngage} posts. No connection request was sent for this lead.`,
      );
    }

    updateStatus(`Finished ${engagedCount} post${engagedCount === 1 ? "" : "s"}.`);
    return { engagedCount, totalProcessed: countToEngage, activities };
  }

  async function runConnectionRequest(options = {}) {
    initOverlay();
    if (overlayContainer) overlayContainer.style.display = "block";
    updateStatus("Opening a connection request...");

    const currentProfileSlug = getLinkedInProfileSlug(window.location.href);
    const expectedProfileSlug = getLinkedInProfileSlug(
      options.expectedProfileUrl,
    );
    if (!currentProfileSlug) {
      throw new Error(
        "This is not a LinkedIn profile page. No request was sent.",
      );
    }
    if (
      expectedProfileSlug &&
      normalizeProfileSlug(currentProfileSlug) !==
        normalizeProfileSlug(expectedProfileSlug)
    ) {
      throw new Error(
        "LinkedIn opened a different profile. No request was sent.",
      );
    }

    const targetProfileName =
      getCurrentProfileName(options.expectedProfileName) ||
      String(options.expectedProfileName || "").trim();
    if (!targetProfileName) {
      throw new Error(
        "We couldn’t check the name on this profile. No request was sent.",
      );
    }
    addLog("Lead", targetProfileName);

    await sleep(1500);

    // 1. Click 'More' button on profile
    updateStatus("Looking for the More button...");
    const moreBtn = await findMoreButton(targetProfileName);
    if (!moreBtn) {
      throw new Error("We couldn’t find the More button on this profile.");
    }

    if (moreBtn.getAttribute("aria-expanded") === "true") {
      addLog("Menu", "The More menu is already open");
    } else {
      clickElement(moreBtn);
      addLog("Opened", "More menu");
      await sleep(1200);
    }

    // 2. Click 'Connect' in the dropdown menu / popover
    updateStatus("Looking for Connect...");
    const connectEl = await findConnectOption({
      targetProfileName,
      targetProfileSlug: currentProfileSlug,
    });
    if (!connectEl) {
      throw new Error("We couldn’t find Connect in the More menu.");
    }

    clickElement(connectEl);
    addLog("Opened", "Connection request");
    await sleep(1500);

    // 3. Verify the modal belongs to the profile before sending anything.
    updateStatus(`Checking that this request is for ${targetProfileName}...`);
    const invitationDialog = await waitForMatch(
      findActiveInvitationDialog,
      20_000,
    );
    if (!invitationDialog) {
      throw new Error("LinkedIn did not open the connection request.");
    }

    const invitationRecipient = getInvitationRecipient(invitationDialog);
    if (
      !invitationRecipient ||
      !personNamesMatch(invitationRecipient, targetProfileName)
    ) {
      dismissInvitationDialog(invitationDialog);
      const openedFor = invitationRecipient
        ? `LinkedIn opened a request for ${invitationRecipient}, not ${targetProfileName}`
        : `We couldn’t check that the request is for ${targetProfileName}`;
      throw new Error(`${openedFor}. Nothing was sent.`);
    }

    let sendBtn = null;
    if (options.includeNote) {
      const note = String(options.invitationNote || "").trim().slice(0, 300);
      if (!note) {
        throw new Error("Your connection request note is empty. Nothing was sent.");
      }

      updateStatus("Adding your note...");
      const addNoteBtn = await findAddNoteButton(invitationDialog);
      if (!addNoteBtn) {
        throw new Error(
          "We couldn’t find Add a note in the connection request.",
        );
      }
      clickElement(addNoteBtn);

      const noteInput = await findInvitationNoteInput();
      if (!noteInput) {
        throw new Error("LinkedIn did not open the note box.");
      }
      fillInvitationNote(noteInput, note);

      updateStatus("Looking for Send...");
      const noteDialog = noteInput.closest("[role='dialog']") || invitationDialog;
      sendBtn = await findSendInvitationButton(noteDialog);
      if (!sendBtn) {
        throw new Error(
          "We couldn’t find the Send button after adding your note.",
        );
      }
      addLog("Note", "Added your connection request note");
    } else {
      updateStatus("Looking for Send without a note...");
      sendBtn = await findSendWithoutNoteButton(invitationDialog);
      if (!sendBtn) {
        throw new Error(
          "We couldn’t find Send without a note.",
        );
      }
    }

    clickElement(sendBtn);
    addLog(
      "Sent",
      options.includeNote
        ? "Sent the connection request with a note"
        : "Sent the connection request without a note",
    );
    const modalClosed = await waitForMatch(
      () => (!findActiveInvitationDialog() ? true : null),
      10_000,
    );
    if (!modalClosed) {
      addLog(
        "Confirmation",
        "LinkedIn kept the request box open. Check that the request was sent.",
      );
    }
    updateStatus("Connection request sent.");
    return { success: true, confirmationPending: !modalClosed };
  }

  async function runRecentConnectionsScan(options = {}) {
    initOverlay();
    if (overlayContainer) overlayContainer.style.display = "block";
    if (
      window.location.pathname.replace(/\/+$/, "") !==
      "/mynetwork/invite-connect/connections"
    ) {
      throw new Error("LinkedIn’s Connections page did not open. Try again.");
    }

    updateStatus("Checking new connections...");
    const maxProfiles = clampInteger(options.maxProfiles ?? 250, 1, 250);
    const checkpointUrl = normalizeLinkedInProfileHref(
      options.checkpoint?.topProfileUrl,
    );
    const checkpointDate = String(
      options.checkpoint?.topConnectedOn || "",
    ).slice(0, 10);
    const cutoffDate = String(options.cutoffDate || "").slice(0, 10);
    const found = new Map();
    let top = null;
    let reachedPriorScan = false;
    let unchangedPasses = 0;

    const loaded = await waitForMatch(
      () => (queryConnectionCards().length > 0 ? true : null),
      30_000,
    );
    if (!loaded) {
      throw new Error(
        "We couldn’t find your connections. Make sure you’re signed in and the list is sorted by Recently added.",
      );
    }

    for (let pass = 0; pass < 35 && found.size < maxProfiles; pass++) {
      const cards = queryConnectionCards();
      const sizeBefore = found.size;
      for (const card of cards) {
        if (!top) {
          top = {
            profileUrl: card.profileUrl,
            connectedOn: card.connectedOn,
          };
        }
        if (
          checkpointUrl &&
          card.profileUrl === checkpointUrl &&
          (!checkpointDate || card.connectedOn === checkpointDate)
        ) {
          reachedPriorScan = true;
          break;
        }
        if (cutoffDate && card.connectedOn < cutoffDate) {
          reachedPriorScan = true;
          break;
        }
        found.set(`${card.connectedOn}|${card.profileUrl}`, card);
        if (found.size >= maxProfiles) break;
      }
      if (reachedPriorScan || found.size >= maxProfiles) break;

      unchangedPasses = found.size === sizeBefore ? unchangedPasses + 1 : 0;
      if (unchangedPasses >= 3 || cards.length === 0) break;
      cards.at(-1)?.element.scrollIntoView({ behavior: "smooth", block: "end" });
      await sleep(1_000);
    }

    const connections = [...found.values()].map(
      ({ profileUrl, name, connectedOn }) => ({
        profileUrl,
        name,
        connectedOn,
      }),
    );
    addLog(
      "New connections",
      `${connections.length} found`,
    );
    updateStatus("New connections checked.");
    return { connections, top, reachedPriorScan };
  }

  async function runContactInfoExtraction(options = {}) {
    initOverlay();
    if (overlayContainer) overlayContainer.style.display = "block";
    const currentProfileUrl = normalizeLinkedInProfileHref(window.location.href);
    const expectedProfileUrl = normalizeLinkedInProfileHref(
      options.expectedProfileUrl,
    );
    if (!currentProfileUrl || currentProfileUrl !== expectedProfileUrl) {
      throw new Error(
        "LinkedIn opened the wrong profile. Nothing was saved.",
      );
    }

    updateStatus("Checking contact info...");
    const contactLink = await waitForMatch(findContactInfoLink, 20_000);
    if (!contactLink) {
      throw new Error("We couldn’t find Contact info on this profile.");
    }
    clickElement(contactLink);
    const dialog = await waitForMatch(findContactInfoDialog, 20_000);
    if (!dialog) throw new Error("LinkedIn did not open Contact info.");
    await waitForMatch(
      () => {
        const progress = dialog.querySelector(
          "[role='progressbar'], progress, [data-testid*='progress']",
        );
        return !progress || dialog.querySelector("a[href^='mailto:']")
          ? true
          : null;
      },
      20_000,
    );

    const mailto = dialog.querySelector("a[href^='mailto:']")?.getAttribute("href");
    const email = mailto
      ? decodeURIComponent(mailto.replace(/^mailto:/i, "").split("?")[0]).trim()
      : null;
    addLog("Email", email ? "Email address saved" : "No email address found");
    updateStatus("Contact info checked.");
    return { profileUrl: currentProfileUrl, email };
  }

  // --- Element Finder & Action Helpers ---

  function queryConnectionCards() {
    const main = document.querySelector("main");
    if (!main) return [];
    const seen = new Set();
    const cards = [];
    for (const anchor of main.querySelectorAll("a[href*='/in/']")) {
      const profileUrl = normalizeLinkedInProfileHref(anchor.href);
      if (!profileUrl || seen.has(profileUrl)) continue;
      let card = anchor.parentElement;
      while (
        card &&
        card !== main &&
        !card.querySelector("a[href*='/messaging/compose/']")
      ) {
        card = card.parentElement;
      }
      if (!card || card === main) continue;
      const connectedLabel = Array.from(card.querySelectorAll("p, span")).find(
        (element) => /^Connected on\s+/i.test(element.textContent?.trim() || ""),
      );
      const connectedOn = parseConnectedOn(connectedLabel?.textContent);
      if (!connectedOn) continue;
      const nameAnchor = Array.from(card.querySelectorAll("a[href*='/in/']")).find(
        (candidate) =>
          normalizeLinkedInProfileHref(candidate.href) === profileUrl &&
          (candidate.textContent || "").trim(),
      );
      const name =
        nameAnchor?.querySelector("p")?.textContent?.trim() ||
        nameAnchor?.textContent?.replace(/\s+/g, " ").trim() ||
        "LinkedIn connection";
      seen.add(profileUrl);
      cards.push({ profileUrl, name, connectedOn, element: card });
    }
    return cards;
  }

  function parseConnectedOn(value) {
    const match = String(value || "")
      .trim()
      .match(/^Connected on\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/i);
    if (!match) return null;
    const months = {
      january: 1,
      february: 2,
      march: 3,
      april: 4,
      may: 5,
      june: 6,
      july: 7,
      august: 8,
      september: 9,
      october: 10,
      november: 11,
      december: 12,
    };
    const month = months[match[1].toLowerCase()];
    if (!month) return null;
    return `${match[3]}-${String(month).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
  }

  function findContactInfoLink() {
    const currentProfileUrl = normalizeLinkedInProfileHref(window.location.href);
    return (
      Array.from(
        document.querySelectorAll("main a[href*='/overlay/contact-info/']"),
      ).find(
        (link) =>
          normalizeLinkedInProfileHref(link.href) === currentProfileUrl &&
          /^Contact info$/i.test(link.textContent?.trim() || "") &&
          isElementVisible(link),
      ) || null
    );
  }

  function findContactInfoDialog() {
    for (const root of getLinkedInModalRoots()) {
      const dialogs = root.querySelectorAll(
        "dialog[data-testid='dialog'][open], dialog[open], [role='dialog']",
      );
      for (const dialog of dialogs) {
        const heading = dialog.querySelector("h1, h2, [role='heading']");
        if (
          /^Contact info$/i.test(heading?.textContent?.trim() || "") &&
          isElementActive(dialog)
        ) {
          return dialog;
        }
      }
    }
    return null;
  }

  async function findPostElements({ timeoutMs = 30_000, minimumCount = 1 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let bestMatch = [];
    let lastNewPostAt = Date.now();
    let lastProgressAt = 0;
    let lastScrollAt = 0;

    while (Date.now() < deadline) {
      const posts = queryPostElements();
      if (posts.length > bestMatch.length) {
        bestMatch = posts;
        lastNewPostAt = Date.now();
      }
      if (bestMatch.length >= minimumCount) return bestMatch;

      if (bestMatch.length > 0 && Date.now() - lastScrollAt >= 2_000) {
        bestMatch.at(-1)?.scrollIntoView({ behavior: "smooth", block: "end" });
        lastScrollAt = Date.now();
      }
      if (bestMatch.length > 0 && Date.now() - lastNewPostAt >= 6_000) {
        return bestMatch;
      }

      if (Date.now() - lastProgressAt >= 5_000) {
        const secondsLeft = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
        addLog("Waiting", `LinkedIn is still loading posts (${secondsLeft}s left)`);
        lastProgressAt = Date.now();
      }
      await sleep(500);
    }

    return bestMatch;
  }

  function queryPostElements() {
    // These selectors mirror the recent-activity DOM captured in doc.md. Prefer
    // the outer feed-update node so all Like, Comment, and editor controls stay
    // scoped to one post.
    const selectorLists = [
      "div[data-view-name='feed-full-update']",
      "[role='article'][data-urn^='urn:li:activity:']",
      "div.feed-shared-update-v2",
      ".scaffold-finite-scroll__content ul > li",
      "ul.display-flex.flex-wrap.list-style-none > li",
    ];

    for (const selector of selectorLists) {
      const items = uniqueElements(
        Array.from(document.querySelectorAll(selector)).filter(hasPostActions),
      );
      if (items.length > 0) return items;
    }

    return uniqueElements(
      Array.from(document.querySelectorAll("li")).filter(hasPostActions),
    );
  }

  function hasPostActions(element) {
    return Boolean(
      element.querySelector(".feed-shared-social-action-bar") ||
        element.querySelector("button.react-button__trigger") ||
        element.querySelector("button[aria-label^='React']") ||
        element.querySelector("button[aria-label='Comment']"),
    );
  }

  function uniqueElements(elements) {
    return [...new Set(elements)];
  }

  async function handleLikeButton(postEl) {
    const likeSelectors = [
      "button.react-button__trigger",
      "button[aria-label^='React Like']",
      "button[aria-label='Like']",
      ".reactions-react-button button",
      "button.social-actions-button"
    ];

    let likeBtn = null;
    for (const sel of likeSelectors) {
      likeBtn = postEl.querySelector(sel);
      if (likeBtn) break;
    }

    if (!likeBtn) {
      // Find button by text "Like"
      const btns = Array.from(postEl.querySelectorAll("button"));
      likeBtn = btns.find((b) => b.textContent?.trim().startsWith("Like"));
    }

    if (!likeBtn) return { success: false, changed: false };

    // Check if already liked
    const isPressed = likeBtn.getAttribute("aria-pressed") === "true";
    const isActive = likeBtn.classList.contains("react-button--active") || likeBtn.textContent?.includes("Unlike");

    if (!isPressed && !isActive) {
      clickElement(likeBtn);
      const confirmed = await waitForMatch(
        () => {
          const active =
            likeBtn.getAttribute("aria-pressed") === "true" ||
            likeBtn.classList.contains("react-button--active") ||
            likeBtn.textContent?.includes("Unlike");
          return active ? likeBtn : null;
        },
        5_000,
      );
      return { success: Boolean(confirmed), changed: Boolean(confirmed) };
    }

    return { success: true, changed: false };
  }

  async function handleSeeMore(postEl) {
    const seeMoreSelectors = [
      "button.feed-shared-inline-show-more-text__see-more-less-toggle",
      "button.see-more",
      "button[aria-label*='see more']",
      "button[aria-label*='reveals content']"
    ];

    for (const sel of seeMoreSelectors) {
      const btn = postEl.querySelector(sel);
      if (btn && isElementVisible(btn)) {
        clickElement(btn);
        await sleep(300);
        break;
      }
    }
  }

  function extractPostText(postEl) {
    const textSelectors = [
      ".update-components-text",
      ".feed-shared-update-v2__description",
      ".feed-shared-inline-show-more-text",
      ".update-components-update-v2__commentary"
    ];

    for (const sel of textSelectors) {
      const container = postEl.querySelector(sel);
      if (container) {
        const text = container.innerText || container.textContent || "";
        const cleaned = text.replace(/…more|see more/gi, "").trim();
        if (cleaned.length > 5) return cleaned;
      }
    }

    return postEl.innerText || "";
  }

  function extractPostUrl(postEl) {
    const permalink = Array.from(
      postEl.querySelectorAll(
        "a[href*='/feed/update/urn:li:activity:'], a[href*='/posts/']",
      ),
    )
      .map((anchor) => normalizeLinkedInPostHref(anchor.href))
      .find(Boolean);
    if (permalink) return permalink;

    const activityUrn =
      postEl.getAttribute("data-urn") ||
      postEl.querySelector("[data-urn*='urn:li:activity:']")?.getAttribute("data-urn") ||
      postEl
        .querySelector("[data-id*='urn:li:activity:']")
        ?.getAttribute("data-id");
    const match = String(activityUrn || "").match(/urn:li:activity:\d+/);
    return match
      ? `https://www.linkedin.com/feed/update/${match[0]}`
      : null;
  }

  async function openCommentBox(postEl) {
    const commentSelectors = [
      "button.comment-button",
      "button[aria-label='Comment']",
      "button[id*='comment']",
      ".social-actions-button.comment-button"
    ];

    let btn = null;
    for (const sel of commentSelectors) {
      btn = postEl.querySelector(sel);
      if (btn) break;
    }

    if (!btn) {
      const btns = Array.from(postEl.querySelectorAll("button"));
      btn = btns.find((b) => b.textContent?.trim().includes("Comment"));
    }

    if (!btn) return false;

    clickElement(btn);
    return true;
  }

  async function typeCommentInQuill(postEl, text) {
    const editorEl = await waitForMatch(
      () =>
        postEl.querySelector("[data-test-ql-editor-contenteditable='true']") ||
        postEl.querySelector(".comments-comment-box-comment__text-editor .ql-editor") ||
        postEl.querySelector("div.ql-editor[contenteditable='true']") ||
        postEl.querySelector("div[data-placeholder='Add a comment…']"),
      5_000,
    );

    if (!editorEl) return false;

    editorEl.focus();
    editorEl.dispatchEvent(new Event("focus", { bubbles: true }));

    // Quill listens to the browser's editing events. execCommand produces the
    // same editable-DOM mutation as typing; the fallback covers LinkedIn builds
    // where that command is disabled.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const inserted = document.execCommand?.("insertText", false, text);
    if (!inserted || editorEl.textContent?.trim() !== text.trim()) {
      editorEl.replaceChildren();
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      editorEl.appendChild(paragraph);
    }

    editorEl.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        data: text,
        inputType: "insertText",
      }),
    );
    editorEl.dispatchEvent(new Event("change", { bubbles: true }));
    editorEl.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

    return editorEl.textContent?.trim().length > 0;
  }

  async function submitComment(postEl) {
    // Wait up to 2 seconds for submit button to be enabled
    let submitBtn = null;
    for (let attempts = 0; attempts < 10; attempts++) {
      const selectors = [
        "button.comments-comment-box__submit-button--cr",
        "button.comments-comment-box__submit-button",
        ".comments-comment-box__form button.artdeco-button--primary",
        "form.comments-comment-box__form button[type='submit']"
      ];

      for (const sel of selectors) {
        submitBtn = postEl.querySelector(sel) || document.querySelector(sel);
        if (submitBtn && !submitBtn.disabled) break;
      }

      if (submitBtn && !submitBtn.disabled) break;

      // Also search buttons with "Comment" text inside form
      const form = postEl.querySelector(".comments-comment-box__form") || document.querySelector(".comments-comment-box__form");
      if (form) {
        const btns = Array.from(form.querySelectorAll("button"));
        const found = btns.find((b) => b.textContent?.trim() === "Comment" && !b.disabled);
        if (found) {
          submitBtn = found;
          break;
        }
      }

      await sleep(200);
    }

    if (!submitBtn || submitBtn.disabled) return false;

    const editor =
      postEl.querySelector("[data-test-ql-editor-contenteditable='true']") ||
      postEl.querySelector("div.ql-editor[contenteditable='true']");
    clickElement(submitBtn);
    return Boolean(
      await waitForMatch(
        () => {
          if (!submitBtn.isConnected || !isElementVisible(submitBtn)) return true;
          if (editor && !(editor.textContent || "").trim()) return true;
          return null;
        },
        8_000,
      ),
    );
  }

  async function findMoreButton(targetProfileName) {
    return waitForMatch(() => {
      const candidates = uniqueElements([
        ...document.querySelectorAll(
          "button[aria-label='More'], button[aria-label='More actions'], button[aria-label='More options']",
        ),
        ...document.querySelectorAll("button"),
      ]).filter(
        (button) => isProfileMoreButton(button) && isElementVisible(button),
      );

      // Prefer the More/three-dot action in the main profile card containing
      // the current member's heading. This excludes recommendation cards.
      const main = document.querySelector("main");
      const targetHeading = main
        ? Array.from(main.querySelectorAll("h1, h2, h3")).find(
            (heading) =>
              personNamesMatch(heading.textContent, targetProfileName) &&
              isElementVisible(heading),
          )
        : null;
      if (targetHeading) {
        let scope = targetHeading.parentElement;
        while (scope && scope !== main.parentElement) {
          const scopedButton = candidates.find((button) =>
            scope.contains(button),
          );
          if (scopedButton) return scopedButton;
          if (scope === main) break;
          scope = scope.parentElement;
        }
      }

      // A profile-photo/name link to the current URL is another stable anchor
      // when LinkedIn changes the heading markup.
      for (const button of candidates) {
        const main = button.closest("main");
        if (!main || button.closest("aside")) continue;
        let scope = button.parentElement;
        while (scope && scope !== main.parentElement) {
          if (containerReferencesCurrentProfile(scope)) return button;
          if (scope === main) break;
          scope = scope.parentElement;
        }
      }

      // LinkedIn sometimes replaces the main action row with a sticky toolbar.
      // Only accept its More/three-dot button when that same toolbar links to
      // the profile currently in the address bar.
      return (
        candidates.find((button) => {
          const toolbar = button.closest("[role='toolbar']");
          return toolbar && toolbarReferencesCurrentProfile(toolbar);
        }) || null
      );
    }, 20_000);
  }

  function isProfileMoreButton(button) {
    const label = button.getAttribute("aria-label")?.trim() || "";
    const text = button.textContent?.trim() || "";
    const hasOverflowIcon = Boolean(
      button.querySelector(
        "svg[data-test-icon*='overflow'], svg[data-test-icon*='ellipsis'], use[href*='overflow'], use[href*='ellipsis']",
      ),
    );
    return (
      /^(More|More actions|More options)$/i.test(label) ||
      /^More$/i.test(text) ||
      hasOverflowIcon
    );
  }

  function toolbarReferencesCurrentProfile(toolbar) {
    return containerReferencesCurrentProfile(toolbar);
  }

  function containerReferencesCurrentProfile(container) {
    const currentSlug = normalizeProfileSlug(
      getLinkedInProfileSlug(window.location.href),
    );
    if (!currentSlug) return false;
    return Array.from(container.querySelectorAll("a[href*='/in/']")).some(
      (link) =>
        normalizeProfileSlug(getLinkedInProfileSlug(link.href)) === currentSlug,
    );
  }

  async function findConnectOption({ targetProfileName, targetProfileSlug }) {
    return waitForMatch(() => {
      const menus = Array.from(
        document.querySelectorAll(
          "[role='menu'], [popover], .artdeco-dropdown__content",
        ),
      ).filter(isElementVisible);

      for (const menu of menus) {
        const candidates = Array.from(
          menu.querySelectorAll(
            "a[href*='/preload/custom-invite/'], [role='menuitem'][aria-label*='Invite'], [role='menuitem'] [aria-label*='Invite']",
          ),
        );
        for (const candidate of candidates) {
          const clickable =
            candidate.closest("a, button, [role='menuitem']") || candidate;
          if (
            isElementVisible(clickable) &&
            connectOptionMatchesTarget(
              clickable,
              targetProfileName,
              targetProfileSlug,
            )
          ) {
            return clickable;
          }
        }
      }
      return null;
    }, 10_000);
  }

  function connectOptionMatchesTarget(
    element,
    targetProfileName,
    targetProfileSlug,
  ) {
    const anchor = element.matches("a") ? element : element.querySelector("a");
    const labelledElement = element.matches("[aria-label]")
      ? element
      : element.querySelector("[aria-label]");
    const inviteLabel = labelledElement?.getAttribute("aria-label") || "";
    const labelMatches =
      /\bInvite\b/i.test(inviteLabel) &&
      /\bto connect\b/i.test(inviteLabel) &&
      normalizePersonName(inviteLabel).includes(
        normalizePersonName(targetProfileName),
      );

    let vanitySlug = "";
    try {
      vanitySlug = new URL(anchor?.href || "", window.location.origin)
        .searchParams.get("vanityName") || "";
    } catch {
      vanitySlug = "";
    }
    const slugMatches =
      vanitySlug &&
      normalizeProfileSlug(vanitySlug) ===
        normalizeProfileSlug(targetProfileSlug);

    return Boolean(labelMatches || slugMatches);
  }

  async function findSendWithoutNoteButton(dialog) {
    return waitForMatch(() => {
      if (dialog && isElementActive(dialog)) {
        const exactButton = Array.from(
          dialog.querySelectorAll("button[aria-label='Send without a note']"),
        ).find(isElementActive);
        if (exactButton) return exactButton;

        const buttons = Array.from(dialog.querySelectorAll("button"));
        const textButton = buttons.find(
          (button) =>
            button.textContent?.trim() === "Send without a note" &&
            isElementActive(button),
        );
        if (textButton) return textButton;
      }

      return null;
    }, 20_000);
  }

  async function findAddNoteButton(dialog) {
    return waitForMatch(() => {
      if (!dialog || !isElementActive(dialog)) return null;
      const exactButton = Array.from(
        dialog.querySelectorAll("button[aria-label='Add a note']"),
      ).find(isElementActive);
      if (exactButton) return exactButton;

      return (
        Array.from(dialog.querySelectorAll("button")).find(
          (button) =>
            button.textContent?.trim() === "Add a note" &&
            isElementActive(button),
        ) || null
      );
    }, 20_000);
  }

  async function findInvitationNoteInput() {
    return waitForMatch(() => {
      for (const root of getLinkedInModalRoots()) {
        const input = Array.from(
          root.querySelectorAll(
            "textarea#custom-message, textarea[name='message'], textarea.connect-button-send-invite__custom-message",
          ),
        ).find(isElementActive);
        if (input) return input;
      }
      return null;
    }, 20_000);
  }

  function fillInvitationNote(input, note) {
    input.focus();
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (valueSetter) valueSetter.call(input, note);
    else input.value = note;
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        data: note,
        inputType: "insertText",
      }),
    );
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function findSendInvitationButton(dialog) {
    return waitForMatch(() => {
      const dialogs = uniqueElements([
        dialog,
        findActiveInvitationDialog(),
      ]).filter((candidate) => candidate && isElementActive(candidate));

      for (const currentDialog of dialogs) {
        const exactButton = Array.from(
          currentDialog.querySelectorAll(
            "button[aria-label='Send invitation']",
          ),
        ).find(
          (button) =>
            isElementActive(button) &&
            !button.disabled &&
            button.getAttribute("aria-disabled") !== "true",
        );
        if (exactButton) return exactButton;

        const textButton = Array.from(
          currentDialog.querySelectorAll("button"),
        ).find(
          (button) =>
            button.textContent?.trim() === "Send" &&
            isElementActive(button) &&
            !button.disabled &&
            button.getAttribute("aria-disabled") !== "true",
        );
        if (textButton) return textButton;
      }
      return null;
    }, 20_000);
  }

  function findActiveInvitationDialog() {
    const dialogs = getLinkedInModalRoots().flatMap((root) =>
      Array.from(
        root.querySelectorAll(
          "div[data-test-modal][role='dialog'], div.send-invite[role='dialog'], div[role='dialog'][aria-labelledby='send-invite-modal']",
        ),
      ),
    );

    return (
      dialogs.find((dialog) => {
        if (!isElementActive(dialog)) return false;
        const heading = dialog.querySelector("h2")?.textContent?.trim() || "";
        return (
          dialog.classList.contains("send-invite") ||
          dialog.getAttribute("aria-labelledby") === "send-invite-modal" ||
          /add a note to your invitation/i.test(heading)
        );
      }) || null
    );
  }

  function getInvitationRecipient(dialog) {
    const content =
      dialog.querySelector(".artdeco-modal__content") || dialog;
    const emphasizedName = Array.from(content.querySelectorAll("strong")).find(
      (element) => element.textContent?.trim(),
    );
    if (emphasizedName) return emphasizedName.textContent.trim();

    const text = content.textContent?.replace(/\s+/g, " ").trim() || "";
    return (
      text.match(/Personalize your invitation to (.+?) by adding a note/i)?.[1]
        ?.trim() || ""
    );
  }

  function dismissInvitationDialog(dialog) {
    const dismissButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) =>
        (button.getAttribute("aria-label")?.trim() === "Dismiss" ||
          button.hasAttribute("data-test-modal-close-btn")) &&
        isElementActive(button),
    );
    if (dismissButton) clickElement(dismissButton);
  }

  function getCurrentProfileName(expectedProfileName) {
    const main = document.querySelector("main");
    const visibleHeadings = Array.from(
      main?.querySelectorAll("h1, h2") || [],
    ).filter(isElementVisible);
    const expectedHeading = visibleHeadings.find((heading) =>
      personNamesMatch(heading.textContent, expectedProfileName),
    );
    if (expectedHeading) return expectedHeading.textContent.trim();

    const firstProfileHeading = visibleHeadings.find((heading) => {
      const text = heading.textContent?.trim() || "";
      return text && text.length <= 100;
    });
    if (firstProfileHeading) return firstProfileHeading.textContent.trim();

    const titleName = document.title
      .replace(/^\(\d+\)\s*/, "")
      .match(/^(.+?)\s*\|\s*LinkedIn$/i)?.[1]
      ?.trim();
    if (titleName) return titleName;
    return "";
  }

  function getLinkedInProfileSlug(value) {
    try {
      return new URL(String(value || ""), window.location.origin).pathname
        .match(/^\/in\/([^/]+)/i)?.[1] || "";
    } catch {
      return "";
    }
  }

  function normalizeLinkedInProfileHref(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
      const slug = url.pathname.match(/^\/in\/([^/]+)/i)?.[1];
      return slug ? `https://www.linkedin.com/in/${slug}` : null;
    } catch {
      return null;
    }
  }

  function normalizeLinkedInPostHref(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
      if (!/^\/(feed\/update\/|posts\/)/i.test(url.pathname)) return null;
      return `https://www.linkedin.com${url.pathname.replace(/\/+$/, "")}`;
    } catch {
      return null;
    }
  }

  function normalizeProfileSlug(value) {
    return decodeURIComponent(String(value || "")).trim().toLowerCase();
  }

  function normalizePersonName(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function personNamesMatch(left, right) {
    const normalizedLeft = normalizePersonName(left);
    const normalizedRight = normalizePersonName(right);
    return Boolean(normalizedLeft && normalizedLeft === normalizedRight);
  }

  function getLinkedInModalRoots() {
    const roots = [document];
    const hosts = document.querySelectorAll(
      "#interop-outlet, [data-testid='interop-shadowdom']",
    );
    for (const host of hosts) {
      if (host.shadowRoot && !roots.includes(host.shadowRoot)) {
        roots.push(host.shadowRoot);
      }
    }
    return roots;
  }

  // --- Validation UI Overlay for Comment Approval ---

  function promptValidationUI(postExcerpt, generatedDraft, postIndex) {
    return new Promise((resolve) => {
      const container = document.getElementById("callum-validation-container");
      if (!container) return resolve(generatedDraft);

      container.style.display = "block";
      container.innerHTML = `
        <div class="callum-validation-box">
          <span class="callum-validation-label">Check comment (Post ${postIndex})</span>
          <div class="callum-post-preview">"${escapeHtml(postExcerpt.substring(0, 150))}${postExcerpt.length > 150 ? "..." : ""}"</div>
          <textarea class="callum-textarea" id="callum-draft-editor">${escapeHtml(generatedDraft)}</textarea>
          <div class="callum-actions">
            <button class="callum-btn callum-btn-primary" id="callum-approve-btn">Post comment</button>
            <button class="callum-btn callum-btn-danger" id="callum-skip-btn">Skip this post</button>
          </div>
        </div>
      `;

      document.getElementById("callum-approve-btn")?.addEventListener("click", () => {
        const text = document.getElementById("callum-draft-editor")?.value.trim();
        container.style.display = "none";
        resolve(text || generatedDraft);
      });

      document.getElementById("callum-skip-btn")?.addEventListener("click", () => {
        container.style.display = "none";
        resolve(null);
      });
    });
  }

  // --- Utility Functions ---

  function clickElement(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent("mouseover", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
  }

  async function waitForMatch(find, timeoutMs, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = find();
      if (match) return match;
      await sleep(intervalMs);
    }
    return null;
  }

  function isElementVisible(element) {
    if (!element?.isConnected || element.getClientRects().length === 0) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function isElementActive(element) {
    if (
      !element?.isConnected ||
      element.closest("[hidden], [aria-hidden='true']")
    ) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function clampInteger(value, minimum, maximum) {
    const number = Math.trunc(Number(value));
    return Math.max(
      minimum,
      Math.min(maximum, Number.isFinite(number) ? number : minimum),
    );
  }

  function cleanError(error) {
    return String(error instanceof Error ? error.message : error || "Something went wrong. Try again.")
      .replace(/^Error:\s*/i, "")
      .split("\n")[0];
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
