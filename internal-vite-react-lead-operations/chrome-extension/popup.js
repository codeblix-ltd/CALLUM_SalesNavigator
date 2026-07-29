const totalElement = document.querySelector("#total");
const nichesElement = document.querySelector("#niches");
const updatedElement = document.querySelector("#updated");
const meterElement = document.querySelector("#meter");
const refreshButton = document.querySelector("#refresh");
const errorElement = document.querySelector("#error");
const connectionElement = document.querySelector("#connection");
const extensionApi = globalThis.chrome?.runtime
  ? globalThis.chrome
  : createPreviewApi();

refreshButton.addEventListener("click", refresh);
void hydrate();

async function hydrate() {
  const cached = await extensionApi.storage.local.get(["leadStats", "leadStatsUpdatedAt"]);
  if (cached.leadStats) render(cached.leadStats, cached.leadStatsUpdatedAt);
  await refresh();
}

async function refresh() {
  refreshButton.disabled = true;
  errorElement.hidden = true;
  try {
    const response = await extensionApi.runtime.sendMessage({ type: "REFRESH_TOTAL" });
    if (!response?.ok) throw new Error(response?.error || "Unable to refresh.");
    render(response.stats, Date.now());
    connectionElement.classList.remove("error");
    connectionElement.lastChild.textContent = " Database connected";
  } catch (error) {
    errorElement.textContent = error instanceof Error ? error.message : String(error);
    errorElement.hidden = false;
    connectionElement.classList.add("error");
    connectionElement.lastChild.textContent = " Connection issue";
  } finally {
    refreshButton.disabled = false;
  }
}

function render(stats, updatedAt) {
  const total = Number(stats.total) || 0;
  totalElement.textContent = new Intl.NumberFormat("en-US").format(total);
  nichesElement.textContent = `${stats.niches?.length || 0} niches`;
  updatedElement.textContent = `Updated ${relativeTime(updatedAt)}`;
  meterElement.style.width = total > 0 ? "100%" : "0";
}

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - Number(timestamp || Date.now())) / 1000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function createPreviewApi() {
  return {
    storage: {
      local: {
        async get() {
          return {};
        },
      },
    },
    runtime: {
      async sendMessage() {
        try {
          const siteUrl = globalThis.LEADS_EXTENSION_CONFIG?.CONVEX_SITE_URL;
          const response = await fetch(`${siteUrl}/api/leads/stats`, { cache: "no-store" });
          if (!response.ok) throw new Error(`Stats request failed (${response.status}).`);
          return { ok: true, stats: await response.json() };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      },
    },
  };
}
