// Callum Leads - Content Script for LinkedIn Automation

(() => {
  if (window.__CALLUM_SCOUT_CONTENT_LOADED__) return;
  window.__CALLUM_SCOUT_CONTENT_LOADED__ = true;

  let overlayContainer = null;
  let automationContext = null;
  const MAX_POST_AGE_DAYS = 92;
  const TOP_POST_SCAN_LIMIT = 3;
  const CONNECTION_LOOKBACK_DAYS = 183;

  // Listen for messages from background script or popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SET_AUTOMATION_CONTEXT") {
      markAutomationContext(message);
      sendResponse({ ok: true, runId: automationContext.runId });
      return false;
    }

    if (message?.type === "EXECUTE_POST_ENGAGEMENT") {
      return runVisibleWorkflow(
        () => runPostEngagement(message.options || {}),
        sendResponse,
      );
    }

    if (message?.type === "INSPECT_CONNECTION_STATUS") {
      return runVisibleWorkflow(
        () => runConnectionStatusInspection(message.options || {}),
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

    if (message?.type === "EXTRACT_FIRST_DM_PROFILE") {
      return runVisibleWorkflow(
        () => runFirstDmProfileExtraction(message.options || {}),
        sendResponse,
      );
    }

    if (message?.type === "EXTRACT_CONTACT_INFO") {
      return runVisibleWorkflow(
        () => runContactInfoExtraction(message.options || {}),
        sendResponse,
      );
    }

    if (message?.type === "WITHDRAW_OLD_SENT_INVITATIONS") {
      return runVisibleWorkflow(
        () => runWithdrawOldInvitations(message.options || {}),
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
    if (premiumRoute) {
      return {
        premium: true,
        evidence:
          "LinkedIn kept the Premium page open; Premium is active on this account.",
      };
    }

    return {
      premium: false,
      evidence: "LinkedIn did not open the Premium page. Try again.",
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
    if (automationContext) applyAutomationOverlayStyle();

    document.getElementById("callum-close-btn")?.addEventListener("click", () => {
      overlayContainer.style.display = "none";
    });
  }

  function markAutomationContext(message) {
    automationContext = {
      runId: String(message.runId || ""),
      groupTitle: String(message.groupTitle || "CALLUM AUTOMATION"),
    };
    document.documentElement.dataset.callumAutomation = "true";
    let marker = document.getElementById("callum-automation-marker");
    if (!marker) {
      marker = document.createElement("div");
      marker.id = "callum-automation-marker";
      marker.setAttribute("role", "status");
      marker.setAttribute("aria-label", "Protected Callum automation tab");
      const dot = document.createElement("span");
      dot.className = "callum-automation-marker-dot";
      const text = document.createElement("strong");
      text.className = "callum-automation-marker-text";
      marker.append(dot, text);
      document.body.appendChild(marker);
    }
    marker.querySelector(".callum-automation-marker-text").textContent =
      `${automationContext.groupTitle} · PROTECTED TAB`;
    initOverlay();
    applyAutomationOverlayStyle();
  }

  function applyAutomationOverlayStyle() {
    overlayContainer?.classList.add("callum-automation-context");
    const badge = overlayContainer?.querySelector(".callum-badge");
    if (badge) badge.textContent = "Automation";
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

    // Only inspect the first three feed cards. LinkedIn orders activity newest
    // first, so scrolling farther can only reach older posts.
    updateStatus("Checking the latest 3 posts...");
    const inspectedPosts = (
      await findPostElements({
        timeoutMs: 15_000,
        minimumCount: TOP_POST_SCAN_LIMIT,
      })
    ).slice(0, TOP_POST_SCAN_LIMIT);
    const posts = inspectedPosts.filter(
      (post) => !isRepostPost(post) && isPostWithinAgeLimit(post),
    );
    if (!posts || posts.length === 0) {
      const candidates = inspectedPosts;
      const repostCount = candidates.filter(isRepostPost).length;
      const oldPostCount = candidates.filter(
        (post) =>
          !isRepostPost(post) && extractPostAgeDays(post) > MAX_POST_AGE_DAYS,
      ).length;
      const unknownPostCount = candidates.filter(
        (post) =>
          !isRepostPost(post) && extractPostAgeDays(post) === null,
      ).length;
      if (oldPostCount > 0 || unknownPostCount > 0) {
        addLog(
          "Skipped",
          `${oldPostCount} post${oldPostCount === 1 ? "" : "s"} older than 3 months and ${unknownPostCount} with no readable date.`,
        );
        throw new Error(
          "No recent posts among the latest 3 were suitable from the last 3 months. Older posts and posts with no readable date were skipped.",
        );
      }
      if (repostCount > 0) {
        addLog(
          "Skipped",
          `${repostCount} repost${repostCount === 1 ? "" : "s"}; Callum Scout only comments on original posts.`,
        );
        throw new Error(
          "No recent posts among the latest 3 could be used. Reposts were skipped.",
        );
      }
      throw new Error(
        "No recent posts could be read among the latest 3. Make sure you’re signed in to LinkedIn and that this lead has posts.",
      );
    }

    const candidates = inspectedPosts;
    const repostCount = candidates.filter(isRepostPost).length;
    const oldPostCount = candidates.filter(
      (post) =>
        !isRepostPost(post) && extractPostAgeDays(post) > MAX_POST_AGE_DAYS,
    ).length;
    const unknownPostCount = candidates.filter(
      (post) => !isRepostPost(post) && extractPostAgeDays(post) === null,
    ).length;
    if (repostCount > 0) {
      addLog(
        "Skipped",
        `${repostCount} repost${repostCount === 1 ? "" : "s"}; no like or comment was added.`,
      );
    }
    if (oldPostCount > 0 || unknownPostCount > 0) {
      addLog(
        "Date check",
        `${oldPostCount} older than 3 months and ${unknownPostCount} with no readable date were skipped.`,
      );
    }
    const countToEngage = Math.min(posts.length, maxPosts);
    addLog(
      "Posts",
      `Checked only the latest ${inspectedPosts.length}. Found ${posts.length} recent original post${posts.length === 1 ? "" : "s"}; working on ${countToEngage}.`,
    );

    let engagedCount = 0;
    const activities = [];
    const skippedReasons = [];

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
        skippedReasons.push(`post ${i + 1}: Like was unavailable`);
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
        skippedReasons.push(`post ${i + 1}: not enough readable text`);
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
          skippedReasons.push(`post ${i + 1}: comment was skipped during review`);
          continue;
        }
        draftText = userApprovedText;
      }

      // 5. Click 'Comment' button under post
      updateStatus(`Opening the comment box for post ${i + 1}...`);
      const commentBoxOpened = await openCommentBox(postEl);
      if (!commentBoxOpened) {
        addLog("Problem", `Couldn’t open the comment box for post ${i + 1}`);
        skippedReasons.push(`post ${i + 1}: comment box did not open`);
        continue;
      }

      await sleep(1200);

      // 6. Type comment into Quill contenteditable editor
      updateStatus(`Adding the comment to post ${i + 1}...`);
      const typed = await typeCommentInQuill(postEl, draftText);
      if (!typed) {
        addLog("Problem", `Couldn’t add the comment to post ${i + 1}`);
        skippedReasons.push(`post ${i + 1}: comment text could not be entered`);
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
        skippedReasons.push(`post ${i + 1}: LinkedIn did not confirm the comment`);
      }

      await sleep(2000);
    }

    if (engagedCount < 1) {
      const details = skippedReasons.length
        ? ` Details: ${skippedReasons.join("; ")}.`
        : "";
      throw new Error(
        `Finished ${engagedCount} of ${countToEngage} posts. No connection request was sent for this lead.${details}`,
      );
    }

    const partial = engagedCount < countToEngage;
    if (partial) {
      addLog(
        "Continued safely",
        `Finished ${engagedCount} of ${countToEngage} posts. Continuing to the connection check.`,
      );
      updateStatus(
        `Finished ${engagedCount} of ${countToEngage} posts. Continuing safely...`,
      );
    } else {
      updateStatus(
        `Finished ${engagedCount} post${engagedCount === 1 ? "" : "s"}.`,
      );
    }
    return {
      engagedCount,
      totalProcessed: countToEngage,
      activities,
      partial,
    };
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

    // LinkedIn alternates between a direct Connect action and a Connect item in
    // More. Try both, but check for Pending before every retry so a delayed UI
    // response can never cause a duplicate invitation.
    const invitation = await openConnectionInvitation({
      targetProfileName,
      targetProfileSlug: currentProfileSlug,
    });
    if (invitation.connectionState === "pending") {
      addLog(
        "Connection",
        "LinkedIn shows this request as pending. No duplicate was sent.",
      );
      updateStatus("Connection request is pending. Syncing it safely...");
      return {
        success: true,
        confirmationPending: false,
        requestAlreadyPending: true,
      };
    }
    if (invitation.connectionState === "connected") {
      throw new Error(
        "LinkedIn now shows this profile as connected. No request was sent.",
      );
    }
    const invitationDialog = invitation.dialog;
    if (!invitationDialog) {
      const methods = invitation.attemptedMethods.join(" and ") || "Connect";
      throw new Error(
        `LinkedIn did not open the connection request after ${methods}. Nothing was sent.`,
      );
    }

    // Verify the modal belongs to the profile before sending anything.
    updateStatus(`Checking that this request is for ${targetProfileName}...`);
    const invitationRecipient = getInvitationRecipient(
      invitationDialog,
      targetProfileName,
    );
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

  async function runConnectionStatusInspection(options = {}) {
    initOverlay();
    if (overlayContainer) overlayContainer.style.display = "block";

    const currentProfileSlug = getLinkedInProfileSlug(window.location.href);
    const expectedProfileSlug = getLinkedInProfileSlug(
      options.expectedProfileUrl,
    );
    if (!currentProfileSlug) {
      throw new Error("This is not a LinkedIn profile page.");
    }
    if (
      expectedProfileSlug &&
      normalizeProfileSlug(currentProfileSlug) !==
        normalizeProfileSlug(expectedProfileSlug)
    ) {
      throw new Error("LinkedIn opened a different profile.");
    }

    const targetProfileName =
      getCurrentProfileName(options.expectedProfileName) ||
      String(options.expectedProfileName || "").trim();
    if (!targetProfileName) {
      throw new Error("We couldn’t check this LinkedIn profile.");
    }

    updateStatus("Checking whether you are already connected...");
    const directConnect = await waitForMatch(
      () => findDirectConnectButton(targetProfileName),
      8_000,
    );
    if (directConnect) {
      addLog("Connection", "Connect is available; continuing with posts.");
      updateStatus("Connect is available. Continuing with posts.");
      return {
        checked: true,
        connectAvailable: true,
        connectionState: "not_connected",
      };
    }

    // LinkedIn often puts Connect behind the profile's More menu. Inspect it
    // before deciding that this profile is already connected.
    const moreButton = await findMoreButton(targetProfileName, 8_000);
    if (moreButton) {
      if (moreButton.getAttribute("aria-expanded") !== "true") {
        clickElement(moreButton);
        await sleep(1_000);
      }
      const connectOption = await findConnectOption({
        targetProfileName,
        targetProfileSlug: currentProfileSlug,
        timeoutMs: 8_000,
      });
      if (connectOption) {
        addLog("Connection", "Connect is available in More; continuing with posts.");
        updateStatus("Connect is available. Continuing with posts.");
        return {
          checked: true,
          connectAvailable: true,
          connectionState: "not_connected",
        };
      }
      if (moreButton.getAttribute("aria-expanded") === "true") {
        clickElement(moreButton);
        await sleep(500);
      }
    }

    const connectionState = findVisibleConnectionState(targetProfileName);
    if (connectionState === "pending") {
      addLog(
        "Connection",
        "A connection request is already pending. No duplicate will be sent.",
      );
      updateStatus("Connection request already pending. Syncing it safely...");
      return {
        checked: true,
        connectAvailable: false,
        connectionState,
      };
    }
    addLog(
      "Connection",
      connectionState === "connected"
        ? "This profile is already connected. Posts were skipped."
        : "The connection state could not be confirmed. Nothing was sent.",
    );
    updateStatus(
      connectionState === "connected"
        ? "Already connected. Checking contact info instead."
        : "Connection state could not be confirmed. Skipping safely.",
    );
    return {
      checked: true,
      connectAvailable: false,
      connectionState,
    };
  }

  async function runFirstDmProfileExtraction(options = {}) {
    initOverlay();
    if (overlayContainer) overlayContainer.style.display = "block";
    const currentProfileUrl = normalizeLinkedInProfileHref(window.location.href);
    const expectedProfileUrl = normalizeLinkedInProfileHref(
      options.expectedProfileUrl,
    );
    if (!currentProfileUrl || currentProfileUrl !== expectedProfileUrl) {
      throw new Error("LinkedIn opened the wrong profile. No First DM was drafted.");
    }

    updateStatus("Reading this accepted connection’s profile...");
    const main = await waitForMatch(
      () => document.querySelector("main") || null,
      20_000,
    );
    if (!main) throw new Error("LinkedIn did not finish loading this profile.");

    const fullName =
      getCurrentProfileName(options.expectedProfileName) ||
      cleanProfileText(options.expectedProfileName, 200);
    const profileSection =
      Array.from(main.querySelectorAll("section")).find(
        (section) =>
          section.querySelector("a[href*='/messaging/compose/']") ||
          Array.from(section.querySelectorAll("a")).some((link) =>
            /^Contact info$/i.test(link.textContent?.trim() || ""),
          ),
      ) || main.querySelector("section");
    const topParagraphs = profileSection
      ? uniqueProfileTexts(profileSection.querySelectorAll("p"), 500)
      : [];
    const headline =
      topParagraphs.find(
        (text) =>
          text !== fullName &&
          !/^(contact info|message|connect|follow)$/i.test(text) &&
          !/\b(connections?|followers?|mutual)\b/i.test(text),
      ) || null;
    const location =
      topParagraphs.find(
        (text) => text !== headline && text !== fullName && text.length <= 200,
      ) || null;

    const aboutSection = findProfileSection(main, "About");
    const experienceSection = findProfileSection(main, "Experience");
    const activitySection = findProfileSection(main, "Activity");
    const experienceItem = experienceSection?.querySelector(
      "[data-testid^='profile_ExperienceTopLevelSection_'], li",
    );
    const experienceTexts = uniqueProfileTexts(
      experienceItem?.querySelectorAll("p") || [],
      500,
    );
    const profile = {
      fullName: fullName || null,
      headline,
      location,
      about: extractProfileSectionText(aboutSection, "About", 3_000),
      currentRole: experienceTexts[0] || null,
      currentCompany: experienceTexts[1] || null,
      recentActivity: extractProfileSectionText(
        activitySection,
        "Activity",
        2_000,
      ),
      messageUrl: normalizeLinkedInMessageHref(
        profileSection?.querySelector("a[href*='/messaging/compose/']")?.href,
      ),
    };
    if (
      !profile.headline &&
      !profile.about &&
      !profile.currentRole &&
      !profile.currentCompany &&
      !profile.recentActivity
    ) {
      throw new Error("We couldn’t read enough profile detail for a personal First DM.");
    }
    addLog("Profile read", fullName || "Accepted connection");
    updateStatus("Profile read. Creating a personal First DM...");
    return profile;
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

    updateStatus("Checking connections from the last 6 months...");
    const maxProfiles = clampInteger(options.maxProfiles ?? 1_000, 1, 1_000);
    const checkpointUrl = normalizeLinkedInProfileHref(
      options.checkpoint?.topProfileUrl,
    );
    const checkpointDate = String(
      options.checkpoint?.topConnectedOn || "",
    ).slice(0, 10);
    const requestedCutoffDate = String(options.cutoffDate || "").slice(0, 10);
    const sixMonthCutoffDate = new Date(
      Date.now() - CONNECTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000,
    )
      .toISOString()
      .slice(0, 10);
    const cutoffDate = [requestedCutoffDate, sixMonthCutoffDate]
      .filter(Boolean)
      .sort()
      .at(-1);
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

    for (let pass = 0; pass < 100 && found.size < maxProfiles; pass++) {
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
      `${connections.length} found within the 6-month limit`,
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
    const contactDetailsStartedAt = Date.now();
    await waitForMatch(
      () => {
        if (dialog.querySelector("a[href^='mailto:']")) return true;
        const progress = dialog.querySelector(
          "[role='progressbar'], progress, [data-testid*='progress']",
        );
        if (progress) return null;
        const content = dialog.querySelector("[data-testid='dialog-content']");
        const detailsLoaded = content?.querySelector(
          "[id*='ContactInfoDetailSection'], [componentkey*='ContactInfoDetailSection']",
        );
        return detailsLoaded && Date.now() - contactDetailsStartedAt >= 2_000
          ? true
          : null;
      },
      20_000,
    );

    const mailto = dialog.querySelector("a[href^='mailto:']")?.getAttribute("href");
    const email = mailto
      ? decodeURIComponent(mailto.replace(/^mailto:/i, "").split("?")[0]).trim()
      : null;
    addLog("Original email", email ? "LinkedIn account email saved" : "No LinkedIn account email found");
    updateStatus("Contact info checked.");
    return { profileUrl: currentProfileUrl, email };
  }

  async function runWithdrawOldInvitations(options = {}) {
    initOverlay();
    if (overlayContainer) overlayContainer.style.display = "block";

    if (!window.location.pathname.includes("/mynetwork/invitation-manager/sent")) {
      throw new Error("LinkedIn’s Sent Invitations page did not open. Try again.");
    }

    updateStatus("Syncing sent connection requests...");

    const dbLeads = options.dbLeads || [];
    if (dbLeads.length > 0) {
      addLog("DB Leads", `${dbLeads.length} pending lead(s) >=30 days in DB`);
    }

    // Wait for list items to render
    const loaded = await waitForMatch(
      () => (querySentInvitationCards().length > 0 ? true : null),
      20_000,
    );

    if (!loaded) {
      addLog("Info", "No sent invitations found on page.");
      updateStatus("No sent invitations found; sync complete.");
      return { withdrawn: [], withdrawnCount: 0, invitations: [] };
    }

    const withdrawn = [];
    const invitations = new Map();
    const processedUrls = new Set();
    let scanPasses = 0;
    let unchangedPasses = 0;

    while (scanPasses < 10) {
      scanPasses++;
      const cards = querySentInvitationCards();
      let newInvitationsInPass = 0;

      for (const card of cards) {
        if (!invitations.has(card.profileUrl)) newInvitationsInPass++;
        invitations.set(card.profileUrl, {
          profileUrl: card.profileUrl,
          name: card.name || "",
          sentText: card.sentText || "",
          ageDays: Number(card.ageDays || 0),
        });
        if (processedUrls.has(card.profileUrl)) continue;

        // Check if card matches any DB lead
        const matchingDbLead = dbLeads.find((lead) => {
          const leadSlug = getLinkedInProfileSlug(lead.profileUrl);
          if (
            leadSlug &&
            card.slug &&
            normalizeProfileSlug(leadSlug) === normalizeProfileSlug(card.slug)
          ) {
            return true;
          }
          if (personNamesMatch(card.name, lead.fullName)) {
            return true;
          }
          return false;
        });

        if (!matchingDbLead) {
          // SAFETY GUARANTEE: Card does NOT match any DB lead! Do not touch personal invitations.
          processedUrls.add(card.profileUrl);
          continue;
        }

        // Check age constraint: must be 30+ days old
        const isOldEnough =
          card.ageDays >= 30 ||
          (matchingDbLead.ageDays && matchingDbLead.ageDays >= 30) ||
          /month|year|5 weeks|6 weeks|7 weeks|8 weeks/i.test(card.sentText);

        if (!isOldEnough) {
          addLog(
            "Skipped",
            `${card.name || matchingDbLead.fullName} sent recently (${card.sentText || "under 30 days"})`,
          );
          processedUrls.add(card.profileUrl);
          continue;
        }

        processedUrls.add(card.profileUrl);

        updateStatus(`Rejecting request for ${matchingDbLead.fullName}...`);
        addLog("Matching lead", `${matchingDbLead.fullName} (${card.sentText || ">=30 days"})`);

        // Click card's Withdraw button
        clickElement(card.withdrawBtn);
        await sleep(1000);

        // Wait for confirmation dialog
        const modal = await waitForMatch(findWithdrawConfirmationDialog, 10_000);
        if (!modal) {
          addLog("Problem", `Confirmation modal did not open for ${matchingDbLead.fullName}`);
          continue;
        }

        const confirmBtn = findConfirmWithdrawButton(modal);
        if (!confirmBtn) {
          addLog("Problem", `Confirm Withdraw button not found in modal for ${matchingDbLead.fullName}`);
          dismissInvitationDialog(modal);
          continue;
        }

        clickElement(confirmBtn);
        await sleep(1500);

        // Verify modal closed
        await waitForMatch(
          () => (!findWithdrawConfirmationDialog() ? true : null),
          5_000,
        );

        addLog("Rejected", `Withdrew the invitation sent to ${matchingDbLead.fullName}`);
        withdrawn.push({
          leadId: matchingDbLead.leadId || matchingDbLead.id,
          name: matchingDbLead.fullName,
          profileUrl: card.profileUrl,
        });

        await sleep(1500);
      }

      if (newInvitationsInPass === 0) {
        unchangedPasses++;
        if (unchangedPasses >= 2) break;
      } else {
        unchangedPasses = 0;
      }

      // Scroll down to load more cards
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      await sleep(1500);
    }

    updateStatus(
      `Sent request sync complete: ${invitations.size} found; ${withdrawn.length} old request(s) rejected.`,
    );
    return {
      withdrawn,
      withdrawnCount: withdrawn.length,
      invitations: [...invitations.values()],
    };
  }

  function parseSentAgeDays(text) {
    const str = String(text || "").trim();
    const match = str.match(/Sent\s+(\d+)\s+(day|week|month|year)s?\s+ago/i);
    if (!match) {
      if (/Sent\s+a\s+month\s+ago/i.test(str)) return 30;
      if (/Sent\s+a\s+year\s+ago/i.test(str)) return 365;
      return 0;
    }
    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === "day") return num;
    if (unit === "week") return num * 7;
    if (unit === "month") return num * 30;
    if (unit === "year") return num * 365;
    return 0;
  }

  function querySentInvitationCards() {
    const root = document.querySelector("main") || document.body;
    const cards = [];
    const seenUrls = new Set();

    // Query card item candidates
    const itemCandidates = Array.from(
      root.querySelectorAll("[role='listitem'], div[componentkey], div._009c20ef"),
    );

    for (const item of itemCandidates) {
      const profileAnchor = item.querySelector("a[href*='/in/']");
      if (!profileAnchor) continue;

      const profileUrl = normalizeLinkedInProfileHref(profileAnchor.href);
      if (!profileUrl || seenUrls.has(profileUrl)) continue;

      const slug = getLinkedInProfileSlug(profileUrl);

      // Find time sent string e.g. "Sent 4 days ago", "Sent 2 months ago"
      const sentElement = Array.from(item.querySelectorAll("p, span")).find(
        (el) => /^Sent\s+/i.test(el.textContent?.trim() || ""),
      );
      const sentText = sentElement?.textContent?.trim() || "";
      const ageDays = parseSentAgeDays(sentText);

      // Find Withdraw button or link
      const withdrawBtn =
        item.querySelector("a[aria-label*='Withdraw']") ||
        item.querySelector("button[aria-label*='Withdraw']") ||
        Array.from(item.querySelectorAll("a, button")).find((el) => {
          const text = el.textContent?.trim();
          const label = el.getAttribute("aria-label") || "";
          return text === "Withdraw" || /Withdraw invitation sent to/i.test(label);
        });

      if (!withdrawBtn) continue;

      // Extract name
      const name =
        item.querySelector("p.a79e215d")?.textContent?.trim() ||
        item.querySelector("p")?.textContent?.trim() ||
        profileAnchor.textContent?.replace(/\s+/g, " ").trim() ||
        "";

      seenUrls.add(profileUrl);
      cards.push({
        element: item,
        profileUrl,
        slug,
        name,
        sentText,
        ageDays,
        withdrawBtn,
      });
    }

    return cards;
  }

  function findWithdrawConfirmationDialog() {
    for (const root of getLinkedInModalRoots()) {
      const dialogs = root.querySelectorAll(
        "dialog[open], [role='dialog'], div[data-testid='dialog']",
      );
      for (const dialog of dialogs) {
        if (!isElementActive(dialog)) continue;
        const text = dialog.textContent || "";
        if (
          /Withdraw invitation/i.test(text) ||
          /won't be able to resend/i.test(text) ||
          dialog.getAttribute("aria-labelledby") === "dialog-header"
        ) {
          return dialog;
        }
      }
    }
    return null;
  }

  function findConfirmWithdrawButton(dialog) {
    if (!dialog) return null;
    const buttons = Array.from(dialog.querySelectorAll("button"));
    return (
      buttons.find((btn) => {
        const text = btn.textContent?.trim();
        const label = btn.getAttribute("aria-label") || "";
        return (
          (text === "Withdraw" || /Withdraw invitation sent to/i.test(label)) &&
          isElementActive(btn)
        );
      }) || null
    );
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

  async function findPostElements({
    timeoutMs = 15_000,
    minimumCount = 1,
  } = {}) {
    const deadline = Date.now() + timeoutMs;
    let bestMatch = [];
    let lastNewPostAt = Date.now();
    let lastProgressAt = 0;

    while (Date.now() < deadline) {
      const candidates = queryPostElements().slice(0, TOP_POST_SCAN_LIMIT);
      if (candidates.length > bestMatch.length) {
        bestMatch = candidates;
        lastNewPostAt = Date.now();
      }
      if (bestMatch.length >= minimumCount) return bestMatch;

      if (candidates.length > 0 && Date.now() - lastNewPostAt >= 3_000) {
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

  function isRepostPost(postEl) {
    const headerSelectors = [
      ".update-components-header",
      ".feed-shared-header",
      "[data-view-name='feed-header']",
    ];
    return headerSelectors.some((selector) =>
      Array.from(postEl.querySelectorAll(selector)).some((header) =>
        /\breposted this\b/i.test(header.textContent?.trim() || ""),
      ),
    );
  }

  function isPostWithinAgeLimit(postEl) {
    const ageDays = extractPostAgeDays(postEl);
    return ageDays !== null && ageDays <= MAX_POST_AGE_DAYS;
  }

  function extractPostAgeDays(postEl) {
    const selectors = [
      ".update-components-actor__sub-description",
      ".feed-shared-actor__sub-description",
      "[data-view-name='feed-actor-sub-description']",
      "time",
    ];
    const values = selectors.flatMap((selector) =>
      Array.from(postEl.querySelectorAll(selector)).map(
        (element) => element.textContent?.trim() || "",
      ),
    );
    for (const value of values) {
      const ageDays = parseLinkedInRelativeAgeDays(value);
      if (ageDays !== null) return ageDays;
    }
    return null;
  }

  function parseLinkedInRelativeAgeDays(value) {
    const text = String(value || "").toLowerCase();
    if (/\b(now|just now)\b/.test(text)) return 0;
    const longMatch = text.match(
      /\b(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago\b/,
    );
    if (longMatch) {
      return relativeAgeUnitToDays(Number(longMatch[1]), longMatch[2]);
    }
    const shortMatch = text.match(/\b(\d+)\s*(mo|yr|w|d|h|m)\b/);
    if (!shortMatch) return null;
    return relativeAgeUnitToDays(Number(shortMatch[1]), shortMatch[2]);
  }

  function relativeAgeUnitToDays(amount, unit) {
    if (["m", "minute", "h", "hour"].includes(unit)) return 0;
    if (["d", "day"].includes(unit)) return amount;
    if (["w", "week"].includes(unit)) return amount * 7;
    if (["mo", "month"].includes(unit)) return amount * 30.4375;
    if (["yr", "year"].includes(unit)) return amount * 365;
    return null;
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

  async function findMoreButton(targetProfileName, timeoutMs = 20_000) {
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
    }, timeoutMs);
  }

  async function openConnectionInvitation({
    targetProfileName,
    targetProfileSlug,
  }) {
    const attemptedMethods = [];
    let directAttempted = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      const stateBeforeClick = findVisibleConnectionState(targetProfileName);
      if (["pending", "connected"].includes(stateBeforeClick)) {
        return {
          dialog: null,
          connectionState: stateBeforeClick,
          attemptedMethods,
        };
      }

      let trigger = null;
      let method = "";
      if (!directAttempted) {
        const directConnect = await waitForMatch(
          () => findDirectConnectButton(targetProfileName),
          attempt === 0 ? 5_000 : 2_000,
        );
        directAttempted = true;
        if (directConnect) {
          trigger = directConnect;
          method = "the direct Connect button";
        }
      }

      if (!trigger) {
        updateStatus("Looking for Connect in More...");
        const moreBtn = await findMoreButton(targetProfileName, 8_000);
        if (moreBtn) {
          if (moreBtn.getAttribute("aria-expanded") !== "true") {
            clickElement(moreBtn);
            addLog("Opened", "More menu");
            await sleep(900);
          }
          trigger = await findConnectOption({
            targetProfileName,
            targetProfileSlug,
            timeoutMs: 8_000,
          });
          if (trigger) method = "Connect in the More menu";
        }
      }

      if (!trigger) continue;
      attemptedMethods.push(method);
      updateStatus(`Opening the request using ${method}...`);
      // Scrolling a popover item can dismiss LinkedIn's More menu before its
      // Connect action receives the click.
      clickElement(trigger, { scroll: method !== "Connect in the More menu" });
      addLog("Opened", method);

      const outcome = await waitForMatch(() => {
        const dialog = findActiveInvitationDialog();
        if (dialog) return { dialog, connectionState: "not_connected" };
        const connectionState = findVisibleConnectionState(targetProfileName);
        return ["pending", "connected"].includes(connectionState)
          ? { dialog: null, connectionState }
          : null;
      }, 12_000);
      if (outcome) return { ...outcome, attemptedMethods };

      addLog(
        "Retry",
        `${method} did not open the request. Rechecking before one safe retry.`,
      );
      await sleep(750);
    }

    return {
      dialog: null,
      connectionState: findVisibleConnectionState(targetProfileName),
      attemptedMethods,
    };
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

  async function findConnectOption({
    targetProfileName,
    targetProfileSlug,
    timeoutMs = 10_000,
  }) {
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
    }, timeoutMs);
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
    const dialogs = uniqueElements(
      getLinkedInModalRoots().flatMap((root) =>
        Array.from(
          root.querySelectorAll(
            "[data-test-modal-id='send-invite-modal'], [role='dialog'], dialog",
          ),
        ).map((candidate) =>
          candidate.matches("[role='dialog'], dialog")
            ? candidate
            : candidate.querySelector("[role='dialog'], dialog") || candidate,
        ),
      ),
    );

    return (
      dialogs.find((dialog) => {
        if (!isElementActive(dialog)) return false;
        const heading =
          dialog.querySelector("h1, h2, h3")?.textContent?.trim() || "";
        const text = dialog.textContent?.replace(/\s+/g, " ").trim() || "";
        const hasInvitationControls = Array.from(
          dialog.querySelectorAll("button, textarea"),
        ).some((element) => {
          const label =
            element.getAttribute("aria-label")?.trim() ||
            element.textContent?.replace(/\s+/g, " ").trim() ||
            "";
          return (
            /^(?:Add a note|Send without a note|Send invitation|Send)$/i.test(
              label,
            ) ||
            element.matches(
              "textarea#custom-message, textarea[name='message']",
            )
          );
        });
        return (
          dialog.classList.contains("send-invite") ||
          dialog.getAttribute("aria-labelledby") === "send-invite-modal" ||
          dialog.getAttribute("data-test-modal-id") === "send-invite-modal" ||
          /(?:invitation|connect)/i.test(heading) ||
          hasInvitationControls ||
          /(?:add a note|send without a note).{0,80}(?:invitation|connect)/i.test(
            text,
          )
        );
      }) || null
    );
  }

  function getInvitationRecipient(dialog, targetProfileName = "") {
    const content =
      dialog.querySelector(".artdeco-modal__content") || dialog;
    const emphasizedNames = Array.from(
      content.querySelectorAll("strong"),
    ).filter((element) => element.textContent?.trim());
    const exactTarget = emphasizedNames.find((element) =>
      personNamesMatch(element.textContent, targetProfileName),
    );
    if (exactTarget) return exactTarget.textContent.trim();

    const text = content.textContent?.replace(/\s+/g, " ").trim() || "";
    if (
      targetProfileName &&
      normalizePersonName(text).includes(normalizePersonName(targetProfileName))
    ) {
      return targetProfileName;
    }
    const emphasizedName = emphasizedNames[0];
    if (emphasizedName) return emphasizedName.textContent.trim();
    return (
      text.match(
        /(?:personalize|customize)(?:\s+your)?\s+invitation\s+to\s+(.+?)(?:\s+by|\s+with|[.!?]|$)/i,
      )?.[1]
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

  function findDirectConnectButton(targetProfileName) {
    const main = document.querySelector("main");
    if (!main) return null;
    const candidates = uniqueElements([
      ...main.querySelectorAll(
        "button, a[role='button'], [role='button']",
      ),
    ]).filter(
      (element) =>
        isElementVisible(element) &&
        !element.closest("aside") &&
        isConnectActionLabel(element),
    );

    const targetHeading = Array.from(
      main.querySelectorAll("h1, h2, h3"),
    ).find(
      (heading) =>
        personNamesMatch(heading.textContent, targetProfileName) &&
        isElementVisible(heading),
    );
    if (targetHeading) {
      let scope = targetHeading.parentElement;
      while (scope && scope !== main.parentElement) {
        const scopedButton = candidates.find((button) => scope.contains(button));
        if (scopedButton) return scopedButton;
        if (scope === main) break;
        scope = scope.parentElement;
      }
    }

    return (
      candidates.find((button) => {
        const toolbar = button.closest("[role='toolbar']");
        return toolbar && containerReferencesCurrentProfile(toolbar);
      }) || null
    );
  }

  function isConnectActionLabel(element) {
    const label =
      element.getAttribute("aria-label")?.trim() ||
      element.textContent?.replace(/\s+/g, " ").trim() ||
      "";
    const href = element.getAttribute("href") || "";
    return (
      /^(?:connect|invite .+ to connect)$/i.test(label) ||
      /\/preload\/custom-invite\//i.test(href)
    );
  }

  function findVisibleConnectionState(targetProfileName = "") {
    const main = document.querySelector("main");
    if (!main) return "unavailable";

    const actions = Array.from(
      main.querySelectorAll("button, a[role='button'], [role='button']"),
    ).filter((element) => isElementVisible(element) && !element.closest("aside"));
    const labels = actions.map(
      (element) =>
        element.getAttribute("aria-label")?.replace(/\s+/g, " ").trim() ||
        element.textContent?.replace(/\s+/g, " ").trim() ||
        "",
    );
    if (
      labels.some((label) =>
        /^(?:Pending|Sent|Invitation sent|Request sent)$/i.test(label),
      )
    ) {
      return "pending";
    }
    if (labels.some((label) => /^Connected$/i.test(label))) return "connected";

    const targetHeading = Array.from(main.querySelectorAll("h1, h2, h3")).find(
      (heading) =>
        personNamesMatch(heading.textContent, targetProfileName) &&
        isElementVisible(heading),
    );
    if (targetHeading) {
      let scope = targetHeading.parentElement;
      while (scope && scope !== main) {
        const scopedActions = actions.filter((element) => scope.contains(element));
        if (scopedActions.length > 0) {
          const text = scope.innerText?.replace(/\s+/g, " ").trim() || "";
          if (/\bPending\b|\bInvitation sent\b/i.test(text)) return "pending";
          if (/\bConnected\b|\b1st\b/i.test(text)) return "connected";
        }
        scope = scope.parentElement;
      }
    }
    return "unavailable";
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

  function normalizeLinkedInMessageHref(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
      if (!/^\/messaging\/compose\/$/i.test(url.pathname)) return null;
      return `https://www.linkedin.com${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }

  function findProfileSection(main, title) {
    const heading = Array.from(
      main.querySelectorAll("h1, h2, h3, [role='heading']"),
    ).find(
      (element) =>
        element.textContent?.trim() === title && isElementVisible(element),
    );
    return heading?.closest("section") || null;
  }

  function extractProfileSectionText(section, heading, maximumLength) {
    if (!section) return null;
    const preferred = section.querySelector(
      "[data-testid='expandable-text-box'], .update-components-text",
    );
    const value = cleanProfileText(preferred?.textContent, maximumLength);
    if (value) return value;
    const texts = uniqueProfileTexts(section.querySelectorAll("p"), maximumLength)
      .filter((text) => text !== heading);
    return cleanProfileText(texts.join(" "), maximumLength) || null;
  }

  function uniqueProfileTexts(elements, maximumLength) {
    return [
      ...new Set(
        Array.from(elements)
          .map((element) => cleanProfileText(element.textContent, maximumLength))
          .filter(Boolean),
      ),
    ];
  }

  function cleanProfileText(value, maximumLength) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maximumLength);
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

  function clickElement(el, { scroll = true } = {}) {
    if (!el) return;
    if (scroll) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
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
