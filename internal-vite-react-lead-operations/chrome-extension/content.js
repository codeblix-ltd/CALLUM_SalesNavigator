// Callum Leads - Content Script for LinkedIn Real Automation

(() => {
  if (window.__CALLUM_SCOUT_CONTENT_LOADED__) return;
  window.__CALLUM_SCOUT_CONTENT_LOADED__ = true;

  let overlayContainer = null;
  let validationResolver = null;

  // Listen for messages from background script or popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "EXECUTE_POST_ENGAGEMENT") {
      runPostEngagement(message.options || {})
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
      return true;
    }

    if (message?.type === "EXECUTE_CONNECTION_REQUEST") {
      runConnectionRequest(message.options || {})
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
      return true;
    }

    if (message?.type === "EXECUTE_FULL_LEAD_AUTOMATION") {
      runFullLeadAutomation(message.lead, message.options || {})
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
      return true;
    }

    if (message?.type === "GET_PAGE_INFO") {
      sendResponse({
        url: window.location.href,
        isRecentActivity: window.location.pathname.includes("/recent-activity"),
        isProfile: window.location.pathname.startsWith("/in/"),
      });
      return false;
    }
  });

  // Inject overlay widget automatically on LinkedIn pages
  if (window.location.hostname.includes("linkedin.com") || window.location.pathname.includes("simulator")) {
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
          <span class="callum-badge">Auto</span>
        </div>
        <button class="callum-close" id="callum-close-btn" title="Close Overlay">&times;</button>
      </div>
      <div class="callum-body">
        <div class="callum-status-row">
          <div class="callum-pulse"></div>
          <span id="callum-status-text">Ready for LinkedIn automation</span>
        </div>
        <div id="callum-validation-container" style="display: none;"></div>
        <ul class="callum-log-list" id="callum-log-list">
          <li><strong>Loaded:</strong> Automation script attached to page</li>
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
    addLog("Status", text);
  }

  function addLog(title, detail) {
    const list = document.getElementById("callum-log-list");
    if (!list) return;
    const item = document.createElement("li");
    item.innerHTML = `<strong>${escapeHtml(title)}:</strong> ${escapeHtml(detail)}`;
    list.prepend(item);
  }

  // --- Core Automation Functions ---

  async function runPostEngagement(options = {}) {
    initOverlay();
    if (overlayContainer) overlayContainer.style.display = "block";
    updateStatus("Starting post engagement...");

    // Get settings from storage if not provided
    const stored = await chrome.storage.local.get(["scoutDashboard", "validateBeforeCommenting"]);
    const settings = stored.scoutDashboard?.settings || {};
    const maxPosts = options.postEngagements ?? settings.postEngagements ?? 2;
    const validate = options.validateBeforeCommenting ?? stored.validateBeforeCommenting ?? true;

    addLog("Settings", `Posts: ${maxPosts}, Validate AI comment: ${validate ? "Yes" : "No"}`);

    // Wait for posts container to load
    await sleep(1500);

    // Query posts on recent-activity page or feed
    const posts = await findPostElements();
    if (!posts || posts.length === 0) {
      throw new Error("No recent posts found on this page. Please make sure you are on /recent-activity/all/");
    }

    const countToEngage = Math.min(posts.length, maxPosts);
    addLog("Posts Found", `Found ${posts.length} posts, engaging top ${countToEngage}`);

    let engagedCount = 0;

    for (let i = 0; i < countToEngage; i++) {
      const postEl = posts[i];
      updateStatus(`Engaging post ${i + 1} of ${countToEngage}...`);

      // Scroll post into view
      postEl.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(1000);

      // 1. Click 'Like' button
      const liked = await handleLikeButton(postEl, i + 1);
      if (liked) addLog("Liked", `Liked post #${i + 1}`);

      // 2. Click 'see more' if present and extract full post commentary text
      await handleSeeMore(postEl);
      const postText = extractPostText(postEl);

      if (!postText || postText.length < 5) {
        addLog("Skipped Text", `Post #${i + 1} had no commentary text`);
        continue;
      }

      addLog("Read Post", `"${postText.substring(0, 60)}..."`);

      // 3. Request GPT-5.6 Luna draft comment
      updateStatus(`Generating comment with GPT-5.6 Luna for post ${i + 1}...`);
      let draftText = "";
      try {
        const response = await ScoutApi.authenticatedAction("scouts:draftComment", { postText });
        draftText = response?.draft?.trim() || "";
      } catch (err) {
        addLog("GPT-5.6 Error", err.message || String(err));
        draftText = `Great insights! Thanks for sharing this perspective.`;
      }

      if (!draftText) {
        draftText = "Great insights! Thanks for sharing.";
      }

      // 4. Handle Comment Validation Option
      if (validate) {
        updateStatus(`Awaiting user validation for post ${i + 1}...`);
        const userApprovedText = await promptValidationUI(postText, draftText, i + 1);
        if (!userApprovedText) {
          addLog("Skipped", `User skipped comment for post #${i + 1}`);
          continue;
        }
        draftText = userApprovedText;
      }

      // 5. Click 'Comment' button under post
      updateStatus(`Opening comment box for post ${i + 1}...`);
      const commentBoxOpened = await openCommentBox(postEl);
      if (!commentBoxOpened) {
        addLog("Error", `Could not open comment box for post #${i + 1}`);
        continue;
      }

      await sleep(1200);

      // 6. Type comment into Quill contenteditable editor
      updateStatus(`Writing comment on post ${i + 1}...`);
      const typed = await typeCommentInQuill(postEl, draftText);
      if (!typed) {
        addLog("Error", `Could not fill comment box for post #${i + 1}`);
        continue;
      }

      await sleep(1000);

      // 7. Click 'Comment' submit button
      updateStatus(`Submitting comment on post ${i + 1}...`);
      const submitted = await submitComment(postEl);
      if (submitted) {
        engagedCount++;
        addLog("Commented", `Posted comment on post #${i + 1}`);
      } else {
        addLog("Error", `Failed to click comment submit for post #${i + 1}`);
      }

      await sleep(2000);
    }

    updateStatus(`Completed post engagement on ${engagedCount} post(s)!`);
    return { engagedCount, totalProcessed: countToEngage };
  }

  async function runConnectionRequest(options = {}) {
    initOverlay();
    if (overlayContainer) overlayContainer.style.display = "block";
    updateStatus("Initiating connection request on profile...");

    await sleep(1500);

    // 1. Click 'More' button on profile
    updateStatus("Looking for profile 'More' button...");
    const moreBtn = await findMoreButton();
    if (!moreBtn) {
      throw new Error("Could not find 'More' button on LinkedIn profile header.");
    }

    clickElement(moreBtn);
    addLog("Click", "Clicked 'More' button on profile");
    await sleep(1200);

    // 2. Click 'Connect' in the dropdown menu / popover
    updateStatus("Looking for 'Connect' option in menu...");
    const connectEl = await findConnectOption();
    if (!connectEl) {
      throw new Error("Could not find 'Connect' option in 'More' menu.");
    }

    clickElement(connectEl);
    addLog("Click", "Clicked 'Connect' option");
    await sleep(1500);

    // 3. Click 'Send without a note' in the invitation modal
    updateStatus("Looking for 'Send without a note' in modal...");
    const sendBtn = await findSendWithoutNoteButton();
    if (!sendBtn) {
      throw new Error("Could not find 'Send without a note' button in invitation modal.");
    }

    clickElement(sendBtn);
    addLog("Sent", "Clicked 'Send without a note'!");
    updateStatus("Connection request sent successfully!");

    await sleep(1500);
    return { success: true };
  }

  async function runFullLeadAutomation(lead, options = {}) {
    initOverlay();
    if (overlayContainer) overlayContainer.style.display = "block";
    updateStatus(`Automating lead: ${lead?.fullName || "Current Lead"}`);

    // Check current page
    const isRecentActivity = window.location.pathname.includes("/recent-activity");
    
    if (isRecentActivity) {
      const engageResult = await runPostEngagement(options);
      updateStatus("Finished posts engagement. Navigating to profile root for connection...");
      return engageResult;
    } else {
      const connectResult = await runConnectionRequest(options);
      return connectResult;
    }
  }

  // --- Element Finder & Action Helpers ---

  async function findPostElements() {
    // Try multiple selector patterns for LinkedIn recent activity and feed updates
    const selectorLists = [
      ".scaffold-finite-scroll__content ul > li",
      "ul.display-flex.flex-wrap.list-style-none > li",
      "div.feed-shared-update-v2",
      "div[data-view-name='feed-full-update']",
      ".artdeco-card .feed-shared-update-v2"
    ];

    for (const sel of selectorLists) {
      const items = Array.from(document.querySelectorAll(sel)).filter((el) => {
        return el.querySelector(".feed-shared-social-action-bar") || el.querySelector("button[aria-label*='Like']");
      });
      if (items.length > 0) return items;
    }

    // Fallback: any list item containing a social action bar
    const fallback = Array.from(document.querySelectorAll("li")).filter((el) => {
      return el.querySelector(".feed-shared-social-action-bar") || el.querySelector(".react-button__trigger");
    });

    return fallback;
  }

  async function handleLikeButton(postEl, index) {
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

    if (!likeBtn) return false;

    // Check if already liked
    const isPressed = likeBtn.getAttribute("aria-pressed") === "true";
    const isActive = likeBtn.classList.contains("react-button--active") || likeBtn.textContent?.includes("Unlike");

    if (!isPressed && !isActive) {
      clickElement(likeBtn);
      return true;
    }

    return false;
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
      if (btn && btn.offsetParent !== null) {
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
    // Wait up to 3 seconds for comment editor to appear inside post
    let editorEl = null;
    for (let attempts = 0; attempts < 15; attempts++) {
      editorEl = postEl.querySelector(".comments-comment-box-comment__text-editor .ql-editor") ||
                 postEl.querySelector("div.ql-editor[contenteditable='true']") ||
                 postEl.querySelector("div[data-placeholder='Add a comment…']") ||
                 document.querySelector("div.ql-editor[contenteditable='true']");
      if (editorEl) break;
      await sleep(200);
    }

    if (!editorEl) return false;

    editorEl.focus();
    editorEl.innerHTML = `<p>${escapeHtml(text)}</p>`;

    // Trigger input events for Quill contenteditable
    editorEl.dispatchEvent(new Event("focus", { bubbles: true }));
    editorEl.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true }));
    editorEl.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText" }));
    editorEl.dispatchEvent(new Event("change", { bubbles: true }));
    editorEl.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

    return true;
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

    if (!submitBtn) return false;

    clickElement(submitBtn);
    return true;
  }

  async function findMoreButton() {
    const selectors = [
      "button[aria-label='More']",
      "button[aria-label='More actions']",
      "button[componentkey*='More']",
      "button[aria-label='More options']"
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) return btn;
    }

    // Search profile buttons by text "More"
    const buttons = Array.from(document.querySelectorAll("button"));
    const moreByText = buttons.find((b) => {
      const text = b.textContent?.trim();
      return (text === "More" || b.getAttribute("aria-label")?.includes("More")) && b.offsetParent !== null;
    });

    return moreByText || null;
  }

  async function findConnectOption() {
    // Wait for popover menu
    await sleep(500);

    const selectors = [
      "a[href*='/preload/custom-invite/']",
      "a[componentkey*='ConnectButton']",
      "div[componentkey*='ConnectButton']",
      "a[aria-label*='Invite']",
      "div[aria-label*='Invite']"
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // Search menuitems/links containing "Connect"
    const items = Array.from(document.querySelectorAll("[role='menuitem'], [role='menu'] a, [popover] a, [popover] div, .artdeco-dropdown__content a, .artdeco-dropdown__content div"));
    const connectItem = items.find((item) => {
      const text = item.textContent?.trim();
      return text && /\bConnect\b/i.test(text);
    });

    return connectItem || null;
  }

  async function findSendWithoutNoteButton() {
    // Wait up to 3 seconds for invitation modal
    let sendBtn = null;
    for (let attempts = 0; attempts < 15; attempts++) {
      const selectors = [
        "button[aria-label='Send without a note']",
        "button#ember57",
        "#artdeco-modal-outlet button.artdeco-button--primary",
        ".send-invite button.artdeco-button--primary",
        "div[data-test-modal-id='send-invite-modal'] button.artdeco-button--primary"
      ];

      for (const sel of selectors) {
        sendBtn = document.querySelector(sel);
        if (sendBtn) break;
      }

      if (sendBtn) break;

      // Find by text "Send without a note"
      const modal = document.querySelector("#artdeco-modal-outlet, .send-invite, [data-test-modal]");
      if (modal) {
        const btns = Array.from(modal.querySelectorAll("button"));
        const found = btns.find((b) => b.textContent?.trim().includes("Send without a note"));
        if (found) {
          sendBtn = found;
          break;
        }
      }

      await sleep(200);
    }

    return sendBtn;
  }

  // --- Validation UI Overlay for Comment Approval ---

  function promptValidationUI(postExcerpt, generatedDraft, postIndex) {
    return new Promise((resolve) => {
      const container = document.getElementById("callum-validation-container");
      if (!container) return resolve(generatedDraft);

      container.style.display = "block";
      container.innerHTML = `
        <div class="callum-validation-box">
          <span class="callum-validation-label">Review GPT-5.6 Luna Reply (Post #${postIndex})</span>
          <div class="callum-post-preview">"${escapeHtml(postExcerpt.substring(0, 150))}${postExcerpt.length > 150 ? "..." : ""}"</div>
          <textarea class="callum-textarea" id="callum-draft-editor">${escapeHtml(generatedDraft)}</textarea>
          <div class="callum-actions">
            <button class="callum-btn callum-btn-primary" id="callum-approve-btn">Approve & Comment</button>
            <button class="callum-btn callum-btn-danger" id="callum-skip-btn">Skip Post</button>
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
