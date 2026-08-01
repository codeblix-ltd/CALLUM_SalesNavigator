(() => {
  if (window.__linkedinPagePostCleanerLoaded) return;
  window.__linkedinPagePostCleanerLoaded = true;

  const state = {
    running: false,
    paused: false,
    stopRequested: false,
    matched: 0,
    deleted: 0,
    errors: 0,
    idleScrolls: 0,
    lastMessage: "Ready.",
    startedAt: null
  };

  const SELECTORS = {
    card: ".artdeco-card.mb2",
    authorLink: ".org-light-update-header__member-name a",
    date: ".org-light-update-header__date",
    menuButton: ".org-update-actions-dropdown__control-menu button.artdeco-dropdown__trigger",
    menuItem: ".org-update-actions-dropdown__dropdown-content .artdeco-dropdown__item",
    modal: "#artdeco-modal-outlet [role='alertdialog']",
    modalTitle: "[data-test-dialog-title]",
    confirmButton: "[data-test-dialog-primary-btn]"
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function normalizeText(value) {
    const special = {
      "ø": "o", "Ø": "o", "đ": "d", "Đ": "d", "ł": "l", "Ł": "l",
      "ð": "d", "Ð": "d", "þ": "th", "Þ": "th", "æ": "ae", "Æ": "ae",
      "œ": "oe", "Œ": "oe", "ß": "ss"
    };
    return String(value || "")
      .replace(/[øØđĐłŁðÐþÞæÆœŒß]/g, (char) => special[char] || char)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .toLowerCase();
  }

  function profileSlugFromHref(href) {
    try {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(/^\/in\/([^/]+)/i);
      return match ? decodeURIComponent(match[1]).toLowerCase() : "";
    } catch {
      return "";
    }
  }

  function validPage(config) {
    const expected = config.companyId
      ? `/company/${config.companyId}/admin/page-posts/published`
      : "/admin/page-posts/published";
    return location.hostname === "www.linkedin.com" && location.pathname.includes(expected);
  }

  function cardData(card) {
    const authorLink = card.querySelector(SELECTORS.authorLink);
    const feed = card.querySelector("[data-urn]");
    return {
      card,
      authorLink,
      author: authorLink?.textContent?.trim() || "",
      slug: profileSlugFromHref(authorLink?.href || ""),
      date: card.querySelector(SELECTORS.date)?.textContent?.trim() || "",
      urn: feed?.getAttribute("data-urn") || ""
    };
  }

  function isMatch(data, config) {
    const wantedName = normalizeText(config.authorName);
    const wantedSlug = String(config.profileSlug || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    const nameMatches = Boolean(wantedName) && normalizeText(data.author) === wantedName;
    const slugMatches = Boolean(wantedSlug) && data.slug === wantedSlug;
    return nameMatches || slugMatches;
  }

  function matchingCards(config) {
    return [...document.querySelectorAll(SELECTORS.card)]
      .map(cardData)
      .filter((data) => isMatch(data, config));
  }

  function highlightMatches(matches) {
    document.querySelectorAll("[data-lbpc-highlight]").forEach((node) => {
      node.style.outline = node.dataset.lbpcOldOutline || "";
      delete node.dataset.lbpcHighlight;
      delete node.dataset.lbpcOldOutline;
    });
    for (const match of matches) {
      match.card.dataset.lbpcOldOutline = match.card.style.outline || "";
      match.card.dataset.lbpcHighlight = "true";
      match.card.style.outline = "4px solid #f59e0b";
    }
  }

  async function waitFor(predicate, timeoutMs = 10000, intervalMs = 120) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      await sleep(intervalMs);
    }
    throw new Error("Timed out waiting for LinkedIn to update the page.");
  }

  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  async function waitWhilePaused() {
    while (state.paused && !state.stopRequested) {
      updatePanel();
      await sleep(300);
    }
  }

  async function deleteCard(data) {
    const card = data.card;
    if (!card.isConnected) throw new Error("Post card disappeared before deletion.");
    card.dataset.lbpcProcessing = "true";
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(500);

    const menuButton = card.querySelector(SELECTORS.menuButton);
    if (!menuButton) throw new Error("Could not find the post three-dot menu button.");
    menuButton.click();

    const deleteItem = await waitFor(() => {
      const items = [...card.querySelectorAll(SELECTORS.menuItem)].filter(visible);
      return items.find((item) => normalizeText(item.textContent).startsWith("delete post"));
    }, 8000);
    deleteItem.click();

    const modal = await waitFor(() => {
      const candidate = document.querySelector(SELECTORS.modal);
      if (!visible(candidate)) return null;
      const title = normalizeText(candidate.querySelector(SELECTORS.modalTitle)?.textContent);
      return title.includes("delete post") ? candidate : null;
    }, 8000);

    const confirm = [...modal.querySelectorAll(SELECTORS.confirmButton)]
      .find((button) => visible(button) && normalizeText(button.textContent) === "delete");
    if (!confirm) throw new Error("Could not find the final Delete confirmation button.");
    confirm.click();

    await waitFor(() => !document.contains(modal) || !visible(modal), 12000);
    card.dataset.lbpcProcessed = "true";
    card.style.opacity = "0.55";
  }

  async function scrollForMore() {
    const beforeHeight = document.documentElement.scrollHeight;
    const beforeCards = document.querySelectorAll(SELECTORS.card).length;

    const loadMore = [...document.querySelectorAll("button")]
      .find((button) => visible(button) && /load more|show more/i.test(button.textContent || ""));
    if (loadMore) loadMore.click();
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    await sleep(2400);

    const afterHeight = document.documentElement.scrollHeight;
    const afterCards = document.querySelectorAll(SELECTORS.card).length;
    return afterHeight > beforeHeight || afterCards > beforeCards;
  }

  function publicState() {
    return { ...state };
  }

  function setMessage(message) {
    state.lastMessage = message;
    updatePanel();
  }

  function ensurePanel() {
    let panel = document.getElementById("lbpc-floating-panel");
    if (panel) return panel;
    panel = document.createElement("aside");
    panel.id = "lbpc-floating-panel";
    panel.setAttribute("aria-live", "polite");
    panel.style.cssText = [
      "position:fixed", "right:18px", "bottom:18px", "z-index:2147483647",
      "width:300px", "padding:14px", "border-radius:12px", "background:#111827",
      "color:white", "font:13px/1.4 system-ui,sans-serif", "box-shadow:0 12px 35px rgba(0,0,0,.35)"
    ].join(";");
    panel.innerHTML = `
      <div style="font-weight:800;margin-bottom:6px">LinkedIn Page Post Cleaner</div>
      <div id="lbpc-panel-status" style="white-space:pre-wrap;margin-bottom:10px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button id="lbpc-panel-pause" type="button" style="padding:7px;border:0;border-radius:999px;cursor:pointer">Pause</button>
        <button id="lbpc-panel-stop" type="button" style="padding:7px;border:0;border-radius:999px;cursor:pointer">Stop</button>
      </div>`;
    document.documentElement.appendChild(panel);
    panel.querySelector("#lbpc-panel-pause").addEventListener("click", () => {
      state.paused = !state.paused;
      setMessage(state.paused ? "Paused by user." : "Resumed by user.");
    });
    panel.querySelector("#lbpc-panel-stop").addEventListener("click", () => {
      state.stopRequested = true;
      state.paused = false;
      setMessage("Stopping after the current action…");
    });
    return panel;
  }

  function updatePanel() {
    const panel = state.running ? ensurePanel() : document.getElementById("lbpc-floating-panel");
    if (!panel) return;
    const status = panel.querySelector("#lbpc-panel-status");
    const pause = panel.querySelector("#lbpc-panel-pause");
    status.textContent = [
      `Deleted: ${state.deleted}`,
      `Errors: ${state.errors}`,
      `Empty scrolls: ${state.idleScrolls}`,
      state.lastMessage
    ].join("\n");
    pause.textContent = state.paused ? "Resume" : "Pause";
    if (!state.running) {
      setTimeout(() => panel.remove(), 8000);
    }
  }

  async function run(config) {
    state.running = true;
    state.paused = false;
    state.stopRequested = false;
    state.matched = 0;
    state.deleted = 0;
    state.errors = 0;
    state.idleScrolls = 0;
    state.startedAt = new Date().toISOString();
    setMessage("Started. Searching visible posts…");

    try {
      if (!validPage(config)) throw new Error("The active page does not match the configured Company ID and published-posts admin route.");

      while (!state.stopRequested && state.deleted < config.maxDeletes) {
        await waitWhilePaused();
        if (state.stopRequested) break;

        const candidates = matchingCards(config)
          .filter((data) => !data.card.dataset.lbpcProcessed && !data.card.dataset.lbpcProcessing);

        if (candidates.length > 0) {
          const target = candidates[0];
          state.matched += 1;
          setMessage(`Deleting ${target.author} ${target.date ? `(${target.date})` : ""}…`);
          try {
            await deleteCard(target);
            state.deleted += 1;
            setMessage(`Deleted ${state.deleted} matching post${state.deleted === 1 ? "" : "s"}.`);
          } catch (error) {
            state.errors += 1;
            target.card.dataset.lbpcProcessed = "error";
            target.card.style.outline = "4px solid #dc2626";
            setMessage(`Skipped one post: ${error.message}`);
          }

          if (state.stopRequested || state.deleted >= config.maxDeletes) continue;
          await sleep(randomBetween(config.minDelay, config.maxDelay));
          continue;
        }

        setMessage("No unprocessed matches visible. Scrolling for more…");
        const progressed = await scrollForMore();
        state.idleScrolls = progressed ? 0 : state.idleScrolls + 1;
        if (state.idleScrolls >= config.maxIdleScrolls) {
          setMessage("Stopped because repeated scrolling found no additional posts.");
          break;
        }
      }

      if (state.deleted >= config.maxDeletes) {
        setMessage(`Reached the configured maximum of ${config.maxDeletes} deletions.`);
      } else if (state.stopRequested) {
        setMessage("Stopped by user.");
      }
    } catch (error) {
      state.errors += 1;
      setMessage(`Stopped: ${error.message}`);
    } finally {
      state.running = false;
      state.paused = false;
      state.stopRequested = false;
      updatePanel();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.source !== "linkedin-page-post-cleaner") return;

    if (message.command === "status") {
      sendResponse({ ok: true, state: publicState() });
      return;
    }

    if (message.command === "scan") {
      try {
        if (!validPage(message.config)) throw new Error("Wrong LinkedIn Page admin URL or Company ID.");
        const matches = matchingCards(message.config);
        highlightMatches(matches);
        sendResponse({
          ok: true,
          count: matches.length,
          matches: matches.map(({ author, slug, date, urn }) => ({ author, slug, date, urn })),
          state: publicState()
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message, count: 0, matches: [], state: publicState() });
      }
      return;
    }

    if (message.command === "start") {
      if (state.running) {
        sendResponse({ ok: false, error: "A deletion run is already active.", state: publicState() });
        return;
      }
      run(message.config);
      sendResponse({ ok: true, state: publicState() });
      return;
    }

    if (message.command === "pause") {
      state.paused = true;
      setMessage("Paused by user.");
      sendResponse({ ok: true, state: publicState() });
      return;
    }

    if (message.command === "resume") {
      state.paused = false;
      setMessage("Resumed by user.");
      sendResponse({ ok: true, state: publicState() });
      return;
    }

    if (message.command === "stop") {
      state.stopRequested = true;
      state.paused = false;
      setMessage("Stopping after the current action…");
      sendResponse({ ok: true, state: publicState() });
    }
  });
})();
