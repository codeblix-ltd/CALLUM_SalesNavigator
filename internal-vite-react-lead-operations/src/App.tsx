import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useAction } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Database,
  ExternalLink,
  KeyRound,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { api } from "../convex/_generated/api";
import "./App.css";

type Stats = {
  total: number;
  assigned: number;
  updatedAt: string;
  niches: Array<{ name: string; count: number }>;
};

type Lead = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  domain: string | null;
  companyName: string | null;
  currentTitle: string | null;
  linkedinUrl: string;
  geographicRegion: string | null;
  companyIndustry: string | null;
  companySize: string | null;
  companyLinkedin: string | null;
  employeeCount: number | null;
  companyLocation: string | null;
  foundedYear: number | null;
  connectionDegree: string | null;
  premium: boolean | null;
};

const TOKEN_STORAGE_KEY = "callum-leads-access-token";

function App() {
  const getStats = useAction(api.leads.getStats);
  const listLeads = useAction(api.leads.list);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState("");
  const [accessToken, setAccessToken] = useState(
    () => localStorage.getItem(TOKEN_STORAGE_KEY) ?? "",
  );
  const [tokenDraft, setTokenDraft] = useState(accessToken);
  const [niche, setNiche] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [leadError, setLeadError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refreshStats = useCallback(async () => {
    try {
      setStatsError("");
      setStats(await getStats({}));
    } catch (error) {
      setStatsError(readError(error));
    }
  }, [getStats]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim().length >= 3 ? search.trim() : "");
      setCursor(null);
      setCursorHistory([]);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    setCursor(null);
    setCursorHistory([]);
  }, [niche]);

  const loadLeads = useCallback(async () => {
    if (!accessToken) {
      setLeads([]);
      return;
    }
    setLoading(true);
    setLeadError("");
    try {
      const page = await listLeads({
        accessToken,
        niche: niche || null,
        search: debouncedSearch || null,
        cursor,
        limit: 50,
      });
      setLeads(page.leads);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (error) {
      setLeadError(readError(error));
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, cursor, debouncedSearch, listLeads, niche]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  const currentPage = cursorHistory.length + 1;
  const available = Math.max(0, (stats?.total ?? 0) - (stats?.assigned ?? 0));
  const activeNicheCount = useMemo(
    () => stats?.niches.find((item) => item.name === niche)?.count ?? stats?.total ?? 0,
    [niche, stats],
  );

  function unlock(event: FormEvent) {
    event.preventDefault();
    const token = tokenDraft.trim();
    if (!token) return;
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    setAccessToken(token);
    setSettingsOpen(false);
  }

  function lockWorkspace() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setAccessToken("");
    setTokenDraft("");
    setLeads([]);
    setSettingsOpen(false);
  }

  function nextPage() {
    if (!nextCursor) return;
    setCursorHistory((history) => [...history, cursor]);
    setCursor(nextCursor);
  }

  function previousPage() {
    if (cursorHistory.length === 0) return;
    const history = [...cursorHistory];
    setCursor(history.pop() ?? null);
    setCursorHistory(history);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Callum Leads home">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <span>Callum<span className="brand-accent">Leads</span></span>
        </a>
        <div className="topbar-actions">
          <span className={`connection-state ${statsError ? "has-error" : ""}`}>
            <span className="connection-dot" />
            {statsError ? "Database unavailable" : stats ? "CockroachDB connected" : "Connecting…"}
          </span>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Access settings">
            <KeyRound size={18} />
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow"><Database size={15} /> Lead operations</p>
            <h1>Your lead universe,<br /><span>ready to work.</span></h1>
            <p className="hero-copy">
              Search, segment, and prepare clean Sales Navigator leads for your operator team.
            </p>
          </div>
          <div className="hero-orbit" aria-hidden="true">
            <div className="orbit-ring orbit-one" />
            <div className="orbit-ring orbit-two" />
            <div className="orbit-core"><Users size={30} /></div>
          </div>
        </section>

        <section className="stats-grid" aria-label="Lead statistics">
          <StatCard
            label="Total leads"
            value={stats ? formatNumber(stats.total) : "—"}
            detail="Unique LinkedIn profiles"
            icon={<Users size={20} />}
            tone="violet"
          />
          <StatCard
            label="Available"
            value={stats ? formatNumber(available) : "—"}
            detail="Not assigned to an operator"
            icon={<ShieldCheck size={20} />}
            tone="mint"
          />
          <StatCard
            label="Assigned"
            value={stats ? formatNumber(stats.assigned) : "—"}
            detail="Across the operator team"
            icon={<Building2 size={20} />}
            tone="amber"
          />
          <StatCard
            label="Niches"
            value={stats ? formatNumber(stats.niches.length) : "—"}
            detail="Imported lead segments"
            icon={<Database size={20} />}
            tone="blue"
          />
        </section>

        {statsError && <Notice message={statsError} onRetry={refreshStats} />}

        <section className="workspace">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">Lead directory</p>
              <h2>{niche || "All leads"}</h2>
              <p>{formatNumber(activeNicheCount)} profiles in this view</p>
            </div>
            <button className="secondary-button" onClick={() => void loadLeads()} disabled={!accessToken || loading}>
              <RefreshCw size={16} className={loading ? "spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="filters">
            <label className="search-field">
              <Search size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, company, title, industry…"
                disabled={!accessToken}
              />
              {search && (
                <button onClick={() => setSearch("")} aria-label="Clear search"><X size={16} /></button>
              )}
            </label>
            <select value={niche} onChange={(event) => setNiche(event.target.value)} disabled={!accessToken}>
              <option value="">All niches</option>
              {stats?.niches.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name} ({formatNumber(item.count)})
                </option>
              ))}
            </select>
          </div>

          {!accessToken ? (
            <UnlockPanel
              token={tokenDraft}
              setToken={setTokenDraft}
              onSubmit={unlock}
            />
          ) : leadError ? (
            <Notice message={leadError} onRetry={loadLeads} />
          ) : (
            <LeadTable leads={leads} loading={loading} />
          )}

          {accessToken && !leadError && (
            <div className="pagination">
              <p>Page {currentPage} · Up to 50 leads per page</p>
              <div>
                <button onClick={previousPage} disabled={cursorHistory.length === 0 || loading}>
                  <ArrowLeft size={16} /> Previous
                </button>
                <button onClick={nextPage} disabled={!hasMore || !nextCursor || loading}>
                  Next <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      <footer>
        <span>Callum Leads · Convex orchestration + CockroachDB storage</span>
        <span>{stats?.updatedAt ? `Synced ${formatDate(stats.updatedAt)}` : "Connecting…"}</span>
      </footer>

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="Close"><X size={18} /></button>
            <p className="eyebrow">Workspace security</p>
            <h2 id="settings-title">Access settings</h2>
            <p>The token is stored only in this browser. It is never included in the application source.</p>
            <form onSubmit={unlock}>
              <label>Lead access token</label>
              <input type="password" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} autoFocus />
              <button className="primary-button" type="submit">Save and unlock</button>
            </form>
            {accessToken && <button className="danger-button" onClick={lockWorkspace}>Lock this browser</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-icon">{icon}</div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function UnlockPanel({
  token,
  setToken,
  onSubmit,
}: {
  token: string;
  setToken: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div className="unlock-panel">
      <div className="unlock-icon"><KeyRound size={24} /></div>
      <h3>Unlock the lead directory</h3>
      <p>
        Counts are public to your extension. Lead details require the server-generated access token.
      </p>
      <form onSubmit={onSubmit}>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste access token"
          aria-label="Lead access token"
        />
        <button className="primary-button" type="submit">Unlock workspace</button>
      </form>
    </div>
  );
}

function LeadTable({ leads, loading }: { leads: Lead[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="table-loading">
        <RefreshCw className="spin" size={22} />
        Loading leads from CockroachDB…
      </div>
    );
  }
  if (leads.length === 0) {
    return (
      <div className="empty-state">
        <Search size={24} />
        <h3>No leads found</h3>
        <p>Try another niche or a broader search phrase.</p>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Lead</th>
            <th>Company</th>
            <th>Location</th>
            <th>Industry</th>
            <th>Size</th>
            <th><span className="sr-only">Profile</span></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id}>
              <td>
                <div className="lead-cell">
                  <span className="avatar">{initials(lead.fullName)}</span>
                  <div>
                    <strong>{lead.fullName || "Unnamed lead"}</strong>
                    <span>{lead.currentTitle || "Title unavailable"}</span>
                  </div>
                </div>
              </td>
              <td>
                <strong className="company-name">{lead.companyName || "—"}</strong>
                <span className="subtle">{lead.domain || lead.companySize || ""}</span>
              </td>
              <td><span className="location"><MapPin size={14} />{lead.geographicRegion || lead.companyLocation || "—"}</span></td>
              <td><span className="industry-pill">{lead.companyIndustry || "Uncategorized"}</span></td>
              <td>{lead.employeeCount ? formatNumber(lead.employeeCount) : lead.companySize || "—"}</td>
              <td>
                {lead.linkedinUrl ? (
                  <a className="profile-link" href={lead.linkedinUrl} target="_blank" rel="noreferrer" title="Open LinkedIn profile">
                    <ExternalLink size={16} />
                  </a>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Notice({ message, onRetry }: { message: string; onRetry: () => void | Promise<void> }) {
  return (
    <div className="notice">
      <div><strong>Connection needs attention</strong><span>{message}</span></div>
      <button onClick={() => void onRetry()}>Try again</button>
    </div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "recently"
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function initials(name: string | null) {
  if (!name) return "?";
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function readError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^.*?Uncaught Error:\s*/s, "").split("\n")[0]
    : "An unexpected error occurred.";
}

export default App;
