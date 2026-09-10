/* Support is available even when the dashboard is still loading. */
(() => {
  const version = document.createElement("span");
  version.textContent = `v${chrome.runtime.getManifest().version}`;
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
  chrome.storage.local.get("scoutAvailableUpdate").then(({ scoutAvailableUpdate }) => {
    const installed = chrome.runtime.getManifest().version.split(".").map(Number);
    const available = String(scoutAvailableUpdate || "").split(".").map(Number);
    const difference = available.map((part, index) => part - (installed[index] || 0)).find(part => part !== 0);
    if (!/^\d+(\.\d+){0,3}$/.test(String(scoutAvailableUpdate)) || !(difference > 0)) return;
    const notice = document.createElement("p");
    notice.className = "card";
    notice.textContent = `New version available: ${scoutAvailableUpdate}. Finish or safely pause your run, then restart Chrome to apply the update.`;
    document.querySelector(".topbar")?.after(notice);
  });
})();
