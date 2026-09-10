/* Support is available even when the dashboard is still loading. */
(() => {
  const version = document.createElement("span");
  const installedVersion = chrome.runtime.getManifest().version;
  version.className = "installed-version";
  version.textContent = `v${installedVersion}`;
  version.title = "Your installed Callum Scout version";
  document.querySelector(".topbar strong")?.append(version);
  const button = document.createElement("button");
  button.className = "text-button";
  button.textContent = "Report bug";
  document.querySelector(".topbar-actions")?.prepend(button);
  button.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?tab=${tab?.id ?? ""}`) });
    window.close();
  });
  const notice = document.createElement("section");
  notice.className = "card extension-update";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  const heading = document.createElement("strong");
  const instructions = document.createElement("p");
  notice.append(heading, instructions);
  document.querySelector(".topbar")?.after(notice);

  function renderUpdate(value) {
    const valid = typeof value === "string" && /^\d+(\.\d+){0,3}$/.test(value);
    const installed = installedVersion.split(".").map(Number);
    const available = valid ? value.split(".").map(Number) : [];
    const difference = Array.from({ length: 4 }, (_, index) =>
      (available[index] || 0) - (installed[index] || 0),
    ).find(part => part !== 0);
    notice.hidden = !valid || !(difference > 0);
    if (notice.hidden) return;
    heading.textContent = `New version available: v${value}`;
    instructions.textContent = `You’re using v${installedVersion}. Finish your current work, then restart Chrome to apply the update.`;
  }

  // A freshly delivered update must win over an older storage snapshot.
  let updateChanged = false;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.scoutAvailableUpdate) return;
    updateChanged = true;
    renderUpdate(changes.scoutAvailableUpdate.newValue);
  });
  chrome.storage.local.get("scoutAvailableUpdate").then(({ scoutAvailableUpdate }) => {
    if (!updateChanged) renderUpdate(scoutAvailableUpdate);
  }).catch(() => {});
})();
