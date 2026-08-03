import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useAction, useQuery } from "convex/react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { api } from "../convex/_generated/api";
import "./App.css";

type Range = "7d" | "30d" | "90d" | "all";
type View = "overview" | "leads";
type ScoutSort = "activity" | "emails" | "accepted" | "assigned" | "name";

type Stats = {
  total: number;
  assigned: number;
  updatedAt: string;
  niches: Array<{ name: string; count: number }>;
};

type Summary = {
  totalScouts: number;
  activeScouts: number;
  scoutsWithActivity: number;
  totalLeads: number;
  assignedLeads: number;
  availableLeads: number;
  freshLeads: number;
  viewedLeads: number;
  engagedLeads: number;
  requestsSent: number;
  pendingRequests: number;
  acceptedLeads: number;
  emailsExtracted: number;
  skippedLeads: number;
  failedLeads: number;
  acceptanceRate: number;
  emailYield: number;
};

type ScoutMetrics = {
  username: string;
  operatorId: string;
  active: boolean;
  hasAccount: boolean;
  assigned: number;
  fresh: number;
  viewed: number;
  engaged: number;
  requests: number;
  pending: number;
  accepted: number;
  emails: number;
  skipped: number;
  failed: number;
  activityCount: number;
  acceptanceRate: number;
  emailYield: number;
  lastActive: string | null;
};

type TrendPoint = {
  at: string;
  engaged: number;
  requests: number;
  accepted: number;
  emails: number;
};

type RecentActivity = {
  id: string;
  operatorId: string;
  eventType: string;
  leadName: string | null;
  detail: string | null;
  url: string | null;
  at: string;
};

type PostActivity = {
  id: string;
  operatorId: string;
  leadName: string | null;
  profileUrl: string;
  postUrl: string;
  commentText: string;
  liked: boolean;
  at: string;
};

type Analytics = {
  range: Range;
  rangeLabel: string;
  generatedAt: string;
  scoutsTruncated: boolean;
  summary: Summary;
  scouts: ScoutMetrics[];
  trend: TrendPoint[];
  recentActivity: RecentActivity[];
  postActivities: PostActivity[];
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

type CodexStatus = {
  connected: boolean;
  account: { email: string | null; planType: string } | null;
  model: string;
  queuedDrafts: number;
};

type DeviceLogin = {
  loginId: string;
  verificationUrl: string;
  userCode: string;
};

function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const admin = useQuery(
    api.adminIdentity.currentAdmin,
    isAuthenticated ? {} : "skip",
  );

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <LoginScreen />;
  if (admin === undefined) return <LoadingScreen />;
  if (admin === null) return <UnauthorizedScreen />;
  return <Dashboard adminName={admin.username} />;
}

function LoginScreen() {
  const { signIn } = useAuthActions();
  const [username, setUsername] = useState("callum2024");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError("");
    const params = {
      username: username.trim().toLowerCase(),
      password,
    };
    try {
      await signIn("admin", { ...params, flow: "signIn" });
    } catch {
      try {
        await signIn("admin", { ...params, flow: "signUp" });
      } catch {
        setError("Username or password is incorrect.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-glow auth-glow-one" />
      <div className="auth-glow auth-glow-two" />
      <main className="login-card">
        <div className="login-brand">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <span>Callum<span>Leads</span></span>
        </div>
        <div className="login-lock"><LockKeyhole size={25} /></div>
        <p className="eyebrow">Private operations</p>
        <h1>Internal workspace</h1>
        <p className="login-copy">
          Sign in to view lead inventory, scout performance, and team activity.
        </p>
        <form onSubmit={submit} className="login-form">
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Enter your password"
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button className="primary-button login-button" type="submit" disabled={busy}>
            {busy ? <RefreshCw size={16} className="spin" /> : <KeyRound size={16} />}
            {busy ? "Checking credentials…" : "Unlock dashboard"}
          </button>
        </form>
        <p className="login-footnote"><ShieldCheck size={14} /> Authenticated admin sessions only</p>
      </main>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <span className="brand-mark"><Sparkles size={18} /></span>
      <RefreshCw size={19} className="spin" />
      <p>Securing your workspace…</p>
    </div>
  );
}

function UnauthorizedScreen() {
  const { signOut } = useAuthActions();
  return (
    <div className="loading-screen">
      <LockKeyhole size={28} />
      <h2>Admin access required</h2>
      <p>This session is not permitted to open the internal dashboard.</p>
      <button className="primary-button" onClick={() => void signOut()}>Return to sign in</button>
    </div>
  );
}

function Dashboard({ adminName }: { adminName: string }) {
  const { signOut } = useAuthActions();
  const getOverview = useAction(api.adminAnalytics.getOverview);
  const getStats = useAction(api.leads.getStats);
  const listLeads = useAction(api.leads.list);
  const getCodexStatus = useAction(api.codexGateway.getStatus);
  const startCodexLogin = useAction(api.codexGateway.startDeviceLogin);
  const getCodexLoginStatus = useAction(api.codexGateway.getDeviceLoginStatus);
  const logoutCodex = useAction(api.codexGateway.logout);
  const [view, setView] = useState<View>("overview");
  const [range, setRange] = useState<Range>("all");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [niche, setNiche] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadError, setLeadError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [scoutSearch, setScoutSearch] = useState("");
  const [scoutSort, setScoutSort] = useState<ScoutSort>("activity");
  const [selectedScout, setSelectedScout] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [codexError, setCodexError] = useState("");
  const [codexBusy, setCodexBusy] = useState(false);
  const [deviceLogin, setDeviceLogin] = useState<DeviceLogin | null>(null);

  const refreshOverview = useCallback(async () => {
    setAnalyticsLoading(true);
    setAnalyticsError("");
    try {
      setAnalytics(await getOverview({ range }));
    } catch (error) {
      setAnalyticsError(readError(error));
    } finally {
      setAnalyticsLoading(false);
    }
  }, [getOverview, range]);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await getStats({}));
    } catch (error) {
      setLeadError(readError(error));
    }
  }, [getStats]);

  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    setLeadError("");
    try {
      const page = await listLeads({
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
      setLeadsLoading(false);
    }
  }, [cursor, debouncedSearch, listLeads, niche]);

  const refreshCodexStatus = useCallback(async () => {
    try {
      setCodexError("");
      setCodexStatus(await getCodexStatus({}));
    } catch (error) {
      setCodexError(readError(error));
      setCodexStatus(null);
    }
  }, [getCodexStatus]);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

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

  useEffect(() => {
    if (view === "leads") void loadLeads();
  }, [loadLeads, view]);

  useEffect(() => {
    if (settingsOpen) void refreshCodexStatus();
  }, [refreshCodexStatus, settingsOpen]);

  useEffect(() => {
    if (!deviceLogin) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await getCodexLoginStatus({ loginId: deviceLogin.loginId });
        if (cancelled) return;
        if (result.connected) {
          setDeviceLogin(null);
          await refreshCodexStatus();
        } else if (result.state === "failed") {
          setCodexError(result.error || "OpenAI authorization failed.");
          setDeviceLogin(null);
        }
      } catch (error) {
        if (!cancelled) setCodexError(readError(error));
      }
    };
    void poll();
    const handle = window.setInterval(() => void poll(), 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [deviceLogin, getCodexLoginStatus, refreshCodexStatus]);

  const filteredScouts = useMemo(() => {
    const term = scoutSearch.trim().toLowerCase();
    const rows = (analytics?.scouts ?? []).filter((scout) =>
      !term || scout.username.toLowerCase().includes(term) || scout.operatorId.toLowerCase().includes(term),
    );
    return [...rows].sort((left, right) => {
      if (scoutSort === "name") return left.username.localeCompare(right.username);
      if (scoutSort === "emails") return right.emails - left.emails;
      if (scoutSort === "accepted") return right.accepted - left.accepted;
      if (scoutSort === "assigned") return right.assigned - left.assigned;
      return right.activityCount - left.activityCount;
    });
  }, [analytics, scoutSearch, scoutSort]);

  const activeScout = analytics?.scouts.find((scout) => scout.operatorId === selectedScout) ?? null;
  const scoutActivity = analytics?.recentActivity.filter(
    (item) => !selectedScout || item.operatorId === selectedScout,
  ) ?? [];
  const scoutPosts = analytics?.postActivities.filter(
    (item) => !selectedScout || item.operatorId === selectedScout,
  ) ?? [];
  const currentPage = cursorHistory.length + 1;
  const activeNicheCount = useMemo(
    () => stats?.niches.find((item) => item.name === niche)?.count ?? stats?.total ?? 0,
    [niche, stats],
  );

  async function connectCodex() {
    setCodexBusy(true);
    setCodexError("");
    try {
      const result = await startCodexLogin({});
      if (result.connected) {
        setDeviceLogin(null);
        await refreshCodexStatus();
      } else if (result.loginId && result.verificationUrl && result.userCode) {
        setDeviceLogin({
          loginId: result.loginId,
          verificationUrl: result.verificationUrl,
          userCode: result.userCode,
        });
      } else {
        throw new Error("The gateway did not return an authorization code.");
      }
    } catch (error) {
      setCodexError(readError(error));
    } finally {
      setCodexBusy(false);
    }
  }

  async function disconnectCodex() {
    setCodexBusy(true);
    setCodexError("");
    try {
      await logoutCodex({});
      setDeviceLogin(null);
      await refreshCodexStatus();
    } catch (error) {
      setCodexError(readError(error));
    } finally {
      setCodexBusy(false);
    }
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

  const connectionError = analyticsError || leadError;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Callum Leads home">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <span>Callum<span className="brand-accent">Leads</span></span>
        </a>
        <nav className="main-nav" aria-label="Workspace views">
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>Overview</button>
          <button className={view === "leads" ? "active" : ""} onClick={() => setView("leads")}>Lead directory</button>
        </nav>
        <div className="topbar-actions">
          <span className={`connection-state ${connectionError ? "has-error" : ""}`}>
            <span className="connection-dot" />
            {connectionError ? "Data needs attention" : "Private workspace"}
          </span>
          <button className="admin-chip" onClick={() => setSettingsOpen(true)}>
            <span>{initials(adminName)}</span>
            <span><strong>{adminName}</strong><small>Administrator</small></span>
          </button>
        </div>
      </header>

      <main>
        <section className="hero hero-dashboard">
          <div>
            <p className="eyebrow"><Database size={15} /> Lead operations</p>
            <h1>Your lead universe,<br /><span>ready to work.</span></h1>
            <p className="hero-copy">
              One private view of scout capacity, pipeline progress, and every lead outcome.
            </p>
          </div>
          {view === "overview" && (
            <div className="range-control" aria-label="Analytics period">
              {(["7d", "30d", "90d", "all"] as Range[]).map((value) => (
                <button key={value} className={range === value ? "active" : ""} onClick={() => setRange(value)}>
                  {value === "all" ? "All time" : value.replace("d", " days")}
                </button>
              ))}
            </div>
          )}
        </section>

        {view === "overview" ? (
          <Overview
            analytics={analytics}
            loading={analyticsLoading}
            error={analyticsError}
            onRefresh={refreshOverview}
            scouts={filteredScouts}
            scoutSearch={scoutSearch}
            setScoutSearch={setScoutSearch}
            scoutSort={scoutSort}
            setScoutSort={setScoutSort}
            selectedScout={selectedScout}
            setSelectedScout={setSelectedScout}
            activeScout={activeScout}
            scoutActivity={scoutActivity}
            scoutPosts={scoutPosts}
          />
        ) : (
          <LeadDirectory
            stats={stats}
            niche={niche}
            setNiche={setNiche}
            search={search}
            setSearch={setSearch}
            activeNicheCount={activeNicheCount}
            leads={leads}
            loading={leadsLoading}
            error={leadError}
            onRefresh={loadLeads}
            currentPage={currentPage}
            canGoPrevious={cursorHistory.length > 0}
            canGoNext={hasMore && Boolean(nextCursor)}
            previousPage={previousPage}
            nextPage={nextPage}
          />
        )}
      </main>

      <footer>
        <span><LockKeyhole size={12} /> Internal analytics · Convex auth + CockroachDB</span>
        <span>{analytics?.generatedAt ? `Updated ${formatRelativeTime(analytics.generatedAt)}` : "Connecting…"}</span>
      </footer>

      {settingsOpen && (
        <SettingsModal
          codexStatus={codexStatus}
          codexError={codexError}
          codexBusy={codexBusy}
          deviceLogin={deviceLogin}
          close={() => setSettingsOpen(false)}
          connectCodex={connectCodex}
          disconnectCodex={disconnectCodex}
          lockWorkspace={() => void signOut()}
        />
      )}
    </div>
  );
}

function Overview({
  analytics,
  loading,
  error,
  onRefresh,
  scouts,
  scoutSearch,
  setScoutSearch,
  scoutSort,
  setScoutSort,
  selectedScout,
  setSelectedScout,
  activeScout,
  scoutActivity,
  scoutPosts,
}: {
  analytics: Analytics | null;
  loading: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  scouts: ScoutMetrics[];
  scoutSearch: string;
  setScoutSearch: (value: string) => void;
  scoutSort: ScoutSort;
  setScoutSort: (value: ScoutSort) => void;
  selectedScout: string | null;
  setSelectedScout: (value: string | null) => void;
  activeScout: ScoutMetrics | null;
  scoutActivity: RecentActivity[];
  scoutPosts: PostActivity[];
}) {
  if (!analytics && loading) {
    return <div className="overview-loading"><RefreshCw size={22} className="spin" /> Building the team overview…</div>;
  }
  if (!analytics) return <Notice message={error || "Analytics could not be loaded."} onRetry={onRefresh} />;
  const summary = analytics.summary;

  return (
    <div className={`overview-stack ${loading ? "is-refreshing" : ""}`}>
      {error && <Notice message={error} onRetry={onRefresh} />}
      <div className="overview-toolbar">
        <p><span className="live-dot" /> Showing <strong>{analytics.rangeLabel.toLowerCase()}</strong> activity</p>
        <button className="secondary-button" onClick={() => void onRefresh()} disabled={loading}>
          <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh data
        </button>
      </div>

      <section className="kpi-grid" aria-label="Team performance summary">
        <MetricCard
          label="Total scouts"
          value={summary.totalScouts}
          detail={`${summary.activeScouts} active accounts · ${summary.scoutsWithActivity} active in period`}
          icon={<Users size={20} />}
          tone="violet"
        />
        <MetricCard
          label="Leads assigned"
          value={summary.assignedLeads}
          detail={`${formatNumber(summary.availableLeads)} still available`}
          icon={<Target size={20} />}
          tone="blue"
        />
        <MetricCard
          label="Engaged leads"
          value={summary.engagedLeads}
          detail={`${formatNumber(summary.requestsSent)} connection requests sent`}
          icon={<Activity size={20} />}
          tone="amber"
        />
        <MetricCard
          label="Emails extracted"
          value={summary.emailsExtracted}
          detail={`${formatPercent(summary.emailYield)} yield from accepted leads`}
          icon={<Mail size={20} />}
          tone="mint"
        />
      </section>

      <section className="metric-ribbon" aria-label="Pipeline status">
        <RibbonMetric label="Fresh to work" value={summary.freshLeads} icon={<Sparkles size={16} />} />
        <RibbonMetric label="Pending requests" value={summary.pendingRequests} icon={<Clock3 size={16} />} />
        <RibbonMetric label="Accepted" value={summary.acceptedLeads} icon={<UserCheck size={16} />} />
        <RibbonMetric label="Failed" value={summary.failedLeads} icon={<ShieldCheck size={16} />} danger={summary.failedLeads > 0} />
      </section>

      <section className="analytics-grid">
        <article className="panel chart-panel">
          <PanelHeading
            eyebrow="Activity pulse"
            title="Milestones over time"
            description={`Engagement and outcomes · ${analytics.rangeLabel}`}
            icon={<TrendingUp size={18} />}
          />
          <ActivityChart points={analytics.trend} />
        </article>
        <article className="panel funnel-panel">
          <PanelHeading
            eyebrow="Conversion"
            title="Lead journey"
            description="From engaged profile to captured email"
            icon={<BarChart3 size={18} />}
          />
          <Funnel summary={summary} />
        </article>
      </section>

      <section className="panel scout-panel">
        <div className="scout-panel-head">
          <PanelHeading
            eyebrow="Scout performance"
            title="Team activity by scout"
            description={`Assignment status plus ${analytics.rangeLabel.toLowerCase()} outcomes`}
            icon={<Users size={18} />}
          />
          <div className="scout-controls">
            <label className="search-field compact">
              <Search size={16} />
              <input value={scoutSearch} onChange={(event) => setScoutSearch(event.target.value)} placeholder="Find a scout" />
              {scoutSearch && <button onClick={() => setScoutSearch("")} aria-label="Clear scout search"><X size={14} /></button>}
            </label>
            <select value={scoutSort} onChange={(event) => setScoutSort(event.target.value as ScoutSort)} aria-label="Sort scouts">
              <option value="activity">Most activity</option>
              <option value="emails">Most emails</option>
              <option value="accepted">Most accepted</option>
              <option value="assigned">Most assigned</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>
        <ScoutTable scouts={scouts} selectedScout={selectedScout} setSelectedScout={setSelectedScout} />
        {activeScout && (
          <ScoutDetail
            scout={activeScout}
            activity={scoutActivity}
            close={() => setSelectedScout(null)}
          />
        )}
        {analytics.scoutsTruncated && <p className="table-note">Only the first 500 scout accounts are included.</p>}
      </section>

      <section className="activity-inventory-grid">
        <article className="panel activity-panel">
          <PanelHeading
            eyebrow="Live history"
            title={selectedScout ? `${activeScout?.username ?? selectedScout} activity` : "Recent team activity"}
            description="Latest recorded lead milestones"
            icon={<Activity size={18} />}
          />
          <ActivityFeed items={scoutActivity.slice(0, 12)} />
          <div className="post-history-heading">
            <strong>Saved LinkedIn posts & comments</strong>
            <span>{scoutPosts.length} shown in this period</span>
          </div>
          <PostActivityFeed items={scoutPosts} />
        </article>
        <article className="panel inventory-panel">
          <PanelHeading
            eyebrow="Inventory"
            title="Lead coverage"
            description="Current database allocation"
            icon={<Database size={18} />}
          />
          <Inventory summary={summary} />
        </article>
      </section>
    </div>
  );
}

function MetricCard({ label, value, detail, icon, tone }: { label: string; value: number; detail: string; icon: ReactNode; tone: string }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-card-top"><div className="metric-icon">{icon}</div><span>Live</span></div>
      <p>{label}</p>
      <strong>{formatNumber(value)}</strong>
      <small>{detail}</small>
    </article>
  );
}

function RibbonMetric({ label, value, icon, danger = false }: { label: string; value: number; icon: ReactNode; danger?: boolean }) {
  return (
    <div className={danger ? "ribbon-item danger" : "ribbon-item"}>
      <span>{icon}</span><div><small>{label}</small><strong>{formatNumber(value)}</strong></div>
    </div>
  );
}

function PanelHeading({ eyebrow, title, description, icon }: { eyebrow: string; title: string; description: string; icon: ReactNode }) {
  return (
    <div className="panel-heading">
      <div className="panel-heading-icon">{icon}</div>
      <div><p>{eyebrow}</p><h2>{title}</h2><span>{description}</span></div>
    </div>
  );
}

function ActivityChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <div className="chart-empty"><Activity size={21} /><p>No milestones recorded in this period yet.</p></div>;
  }
  const width = 760;
  const height = 210;
  const top = 18;
  const bottom = 22;
  const max = Math.max(1, ...points.flatMap((point) => [point.engaged, point.requests, point.accepted, point.emails]));
  const x = (index: number) => points.length === 1 ? width / 2 : 12 + (index / (points.length - 1)) * (width - 24);
  const y = (value: number) => top + (1 - value / max) * (height - top - bottom);
  const line = (key: keyof Omit<TrendPoint, "at">) => points.map((point, index) => `${x(index)},${y(point[key])}`).join(" ");
  const area = `12,${height - bottom} ${line("engaged")} ${width - 12},${height - bottom}`;
  const labels = points.length <= 3 ? points : [points[0], points[Math.floor(points.length / 2)], points.at(-1)!];
  return (
    <div className="activity-chart">
      <div className="chart-legend">
        <span className="engaged">Engaged</span><span className="requests">Requests</span><span className="accepted">Accepted</span><span className="emails">Emails</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Lead activity trend">
        {[0.25, 0.5, 0.75, 1].map((step) => <line key={step} x1="12" x2={width - 12} y1={y(max * step)} y2={y(max * step)} className="chart-gridline" />)}
        <polygon points={area} className="chart-area" />
        <polyline points={line("engaged")} className="chart-line engaged" />
        <polyline points={line("requests")} className="chart-line requests" />
        <polyline points={line("accepted")} className="chart-line accepted" />
        <polyline points={line("emails")} className="chart-line emails" />
      </svg>
      <div className="chart-axis">{labels.map((point) => <span key={point.at}>{formatChartDate(point.at)}</span>)}</div>
    </div>
  );
}

function Funnel({ summary }: { summary: Summary }) {
  const rows = [
    { label: "Engaged", value: summary.engagedLeads, tone: "#7355dd" },
    { label: "Requests sent", value: summary.requestsSent, tone: "#3f79d8" },
    { label: "Accepted", value: summary.acceptedLeads, tone: "#e19a33" },
    { label: "Emails found", value: summary.emailsExtracted, tone: "#279c73" },
  ];
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="funnel">
      {rows.map((row) => (
        <div className="funnel-row" key={row.label}>
          <div><span>{row.label}</span><strong>{formatNumber(row.value)}</strong></div>
          <div className="funnel-track"><span style={{ width: `${Math.max(3, row.value / max * 100)}%`, background: row.tone }} /></div>
        </div>
      ))}
      <div className="conversion-pair">
        <div><strong>{formatPercent(summary.acceptanceRate)}</strong><span>Request acceptance</span></div>
        <div><strong>{formatPercent(summary.emailYield)}</strong><span>Email yield</span></div>
      </div>
    </div>
  );
}

function ScoutTable({ scouts, selectedScout, setSelectedScout }: { scouts: ScoutMetrics[]; selectedScout: string | null; setSelectedScout: (value: string | null) => void }) {
  if (scouts.length === 0) return <div className="empty-state compact-empty"><Users size={23} /><h3>No scouts found</h3><p>Try clearing the scout search.</p></div>;
  return (
    <div className="scout-table-scroll">
      <table className="scout-table">
        <thead><tr><th>Scout</th><th>Assigned</th><th>Fresh</th><th>Engaged</th><th>Requests</th><th>Pending</th><th>Accepted</th><th>Emails</th><th>Failed</th><th>Last active</th></tr></thead>
        <tbody>
          {scouts.map((scout) => (
            <tr key={scout.operatorId} className={selectedScout === scout.operatorId ? "selected" : ""} onClick={() => setSelectedScout(selectedScout === scout.operatorId ? null : scout.operatorId)}>
              <td><div className="scout-cell"><span>{initials(scout.username)}</span><div><strong>{scout.username}</strong><small className={scout.active ? "status-active" : "status-inactive"}>{scout.active ? "Active" : scout.hasAccount ? "Disabled" : "Unlinked"}</small></div></div></td>
              <td>{formatNumber(scout.assigned)}</td><td>{formatNumber(scout.fresh)}</td><td><strong>{formatNumber(scout.engaged)}</strong></td><td>{formatNumber(scout.requests)}</td><td>{formatNumber(scout.pending)}</td><td>{formatNumber(scout.accepted)}</td><td><span className="email-count"><Mail size={13} />{formatNumber(scout.emails)}</span></td><td><span className={scout.failed ? "failed-count" : ""}>{formatNumber(scout.failed)}</span></td><td><span className="last-active">{scout.lastActive ? formatRelativeTime(scout.lastActive) : "No activity"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoutDetail({ scout, activity, close }: { scout: ScoutMetrics; activity: RecentActivity[]; close: () => void }) {
  return (
    <div className="scout-detail">
      <div className="scout-detail-head"><div><p className="eyebrow">Scout snapshot</p><h3>{scout.username}</h3><span>{scout.operatorId}</span></div><button onClick={close} aria-label="Close scout detail"><X size={17} /></button></div>
      <div className="scout-detail-grid">
        <div><small>Recorded actions</small><strong>{formatNumber(scout.activityCount)}</strong></div>
        <div><small>Acceptance</small><strong>{formatPercent(scout.acceptanceRate)}</strong></div>
        <div><small>Email yield</small><strong>{formatPercent(scout.emailYield)}</strong></div>
        <div><small>Skipped</small><strong>{formatNumber(scout.skipped)}</strong></div>
      </div>
      <div className="scout-progress">
        <ProgressBar label="Assigned leads engaged" value={scout.engaged} total={scout.assigned} />
        <ProgressBar label="Accepted leads with email" value={scout.emails} total={scout.accepted} />
      </div>
      <p className="scout-detail-note">{activity.length ? `${activity.length} recent events are available below.` : "No recent events in this period."}</p>
    </div>
  );
}

function ProgressBar({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total > 0 ? Math.min(100, value / total * 100) : 0;
  return <div><p><span>{label}</span><strong>{formatPercent(percent)}</strong></p><div><span style={{ width: `${percent}%` }} /></div></div>;
}

function ActivityFeed({ items }: { items: RecentActivity[] }) {
  if (items.length === 0) return <div className="activity-empty"><Clock3 size={19} /><span>No activity in this period.</span></div>;
  return (
    <div className="activity-feed">
      {items.map((item) => (
        <div className="activity-item" key={item.id}>
          <span className={`activity-mark ${activityTone(item.eventType)}`}>{activityIcon(item.eventType)}</span>
          <div>
            <p><strong>{item.operatorId}</strong> {activityLabel(item.eventType)}</p>
            <span>{item.leadName || "Unnamed lead"}</span>
            {item.detail && <small className="activity-detail">“{item.detail}”</small>}
            {item.url && <a className="activity-link" href={item.url} target="_blank" rel="noreferrer">Open LinkedIn <ExternalLink size={11} /></a>}
          </div>
          <time dateTime={item.at}>{formatRelativeTime(item.at)}</time>
        </div>
      ))}
    </div>
  );
}

function PostActivityFeed({ items }: { items: PostActivity[] }) {
  if (items.length === 0) {
    return <div className="post-history-empty">No LinkedIn post engagements recorded in this period.</div>;
  }
  return (
    <div className="post-history">
      {items.map((item) => (
        <article key={item.id}>
          <div>
            <strong>{item.leadName || "Unnamed lead"}</strong>
            <span>{item.operatorId} · {item.liked ? "Liked and commented" : "Commented"}</span>
          </div>
          <p>“{item.commentText}”</p>
          <div className="post-history-links">
            <a href={item.postUrl} target="_blank" rel="noreferrer">Post <ExternalLink size={11} /></a>
            <a href={item.profileUrl} target="_blank" rel="noreferrer">Profile <ExternalLink size={11} /></a>
            <time dateTime={item.at}>{formatRelativeTime(item.at)}</time>
          </div>
        </article>
      ))}
    </div>
  );
}

function Inventory({ summary }: { summary: Summary }) {
  const assignedPercent = summary.totalLeads > 0 ? summary.assignedLeads / summary.totalLeads * 100 : 0;
  return (
    <div className="inventory-content">
      <div className="inventory-total"><strong>{formatNumber(summary.totalLeads)}</strong><span>Total unique leads</span></div>
      <div className="inventory-bar"><span style={{ width: `${Math.min(100, assignedPercent)}%` }} /></div>
      <div className="inventory-legend"><span><i className="assigned" />Assigned <strong>{formatNumber(summary.assignedLeads)}</strong></span><span><i className="available" />Available <strong>{formatNumber(summary.availableLeads)}</strong></span></div>
      <p>{formatPercent(assignedPercent)} of the lead universe is currently allocated.</p>
    </div>
  );
}

function LeadDirectory({ stats, niche, setNiche, search, setSearch, activeNicheCount, leads, loading, error, onRefresh, currentPage, canGoPrevious, canGoNext, previousPage, nextPage }: {
  stats: Stats | null;
  niche: string;
  setNiche: (value: string) => void;
  search: string;
  setSearch: (value: string) => void;
  activeNicheCount: number;
  leads: Lead[];
  loading: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  currentPage: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  previousPage: () => void;
  nextPage: () => void;
}) {
  return (
    <section className="workspace">
      <div className="workspace-heading"><div><p className="eyebrow">Lead directory</p><h2>{niche || "All leads"}</h2><p>{formatNumber(activeNicheCount)} profiles in this view</p></div><button className="secondary-button" onClick={() => void onRefresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />Refresh</button></div>
      <div className="filters"><label className="search-field"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, company, title, industry…" />{search && <button onClick={() => setSearch("")} aria-label="Clear search"><X size={16} /></button>}</label><select value={niche} onChange={(event) => setNiche(event.target.value)}><option value="">All niches</option>{stats?.niches.map((item) => <option key={item.name} value={item.name}>{item.name} ({formatNumber(item.count)})</option>)}</select></div>
      {error ? <div className="directory-notice"><Notice message={error} onRetry={onRefresh} /></div> : <LeadTable leads={leads} loading={loading} />}
      {!error && <div className="pagination"><p>Page {currentPage} · Up to 50 leads per page</p><div><button onClick={previousPage} disabled={!canGoPrevious || loading}><ArrowLeft size={16} /> Previous</button><button onClick={nextPage} disabled={!canGoNext || loading}>Next <ArrowRight size={16} /></button></div></div>}
    </section>
  );
}

function LeadTable({ leads, loading }: { leads: Lead[]; loading: boolean }) {
  if (loading) return <div className="table-loading"><RefreshCw className="spin" size={22} />Loading leads from CockroachDB…</div>;
  if (leads.length === 0) return <div className="empty-state"><Search size={24} /><h3>No leads found</h3><p>Try another niche or a broader search phrase.</p></div>;
  return (
    <div className="table-scroll"><table><thead><tr><th>Lead</th><th>Company</th><th>Location</th><th>Industry</th><th>Size</th><th><span className="sr-only">Profile</span></th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><div className="lead-cell"><span className="avatar">{initials(lead.fullName)}</span><div><strong>{lead.fullName || "Unnamed lead"}</strong><span>{lead.currentTitle || "Title unavailable"}</span></div></div></td><td><strong className="company-name">{lead.companyName || "—"}</strong><span className="subtle">{lead.domain || lead.companySize || ""}</span></td><td><span className="location"><MapPin size={14} />{lead.geographicRegion || lead.companyLocation || "—"}</span></td><td><span className="industry-pill">{lead.companyIndustry || "Uncategorized"}</span></td><td>{lead.employeeCount ? formatNumber(lead.employeeCount) : lead.companySize || "—"}</td><td>{lead.linkedinUrl ? <a className="profile-link" href={lead.linkedinUrl} target="_blank" rel="noreferrer" title="Open LinkedIn profile"><ExternalLink size={16} /></a> : "—"}</td></tr>)}</tbody></table></div>
  );
}

function SettingsModal({ codexStatus, codexError, codexBusy, deviceLogin, close, connectCodex, disconnectCodex, lockWorkspace }: {
  codexStatus: CodexStatus | null;
  codexError: string;
  codexBusy: boolean;
  deviceLogin: DeviceLogin | null;
  close: () => void;
  connectCodex: () => Promise<void>;
  disconnectCodex: () => Promise<void>;
  lockWorkspace: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={close} aria-label="Close"><X size={18} /></button><p className="eyebrow">Workspace security</p><h2 id="settings-title">Admin session</h2><p>This browser is signed in with the private administrator account. Analytics and lead data are checked server-side on every request.</p><div className="security-card"><ShieldCheck size={19} /><div><strong>Credentials verified</strong><span>Only the admin role can call dashboard APIs.</span></div></div><button className="danger-button lock-button" onClick={lockWorkspace}><LogOut size={15} /> Sign out and lock</button><div className="modal-divider" /><div className="codex-heading"><div className="codex-icon"><Bot size={19} /></div><div><h3>Codex subscription</h3><p>Draft with GPT-5.6 Luna</p></div></div>{codexStatus?.connected ? <div className="codex-connected"><div><CheckCircle2 size={18} /><span><strong>Connected</strong>{codexStatus.account?.email || "ChatGPT account"} · {codexStatus.account?.planType}</span></div><p>Model: {codexStatus.model}{codexStatus.queuedDrafts > 0 ? ` · ${codexStatus.queuedDrafts} queued` : ""}</p><button className="danger-button codex-disconnect" onClick={() => void disconnectCodex()} disabled={codexBusy}>Disconnect subscription</button></div> : deviceLogin ? <div className="device-login"><p>Open the official OpenAI device page, then enter this one-time code:</p><div className="device-code"><strong>{deviceLogin.userCode}</strong><button type="button" onClick={() => void navigator.clipboard.writeText(deviceLogin.userCode)} title="Copy code"><Copy size={16} /></button></div><a className="primary-button" href={deviceLogin.verificationUrl} target="_blank" rel="noreferrer">Open OpenAI authorization <ExternalLink size={15} /></a><span className="polling-label"><RefreshCw size={13} className="spin" /> Waiting for approval…</span></div> : <button className="primary-button codex-connect" onClick={() => void connectCodex()} disabled={codexBusy}>{codexBusy ? <RefreshCw size={15} className="spin" /> : <Bot size={16} />}Connect ChatGPT subscription</button>}{codexError && <p className="codex-error">{codexError}</p>}</div></div>
  );
}

function Notice({ message, onRetry }: { message: string; onRetry: () => void | Promise<void> }) {
  return <div className="notice"><div><strong>Connection needs attention</strong><span>{message}</span></div><button onClick={() => void onRetry()}>Try again</button></div>;
}

function activityLabel(type: string) {
  const labels: Record<string, string> = {
    viewed: "opened a lead",
    engaged: "completed engagement for",
    post_engaged: "liked and commented on a post by",
    connection_requested: "sent a connection request to",
    accepted: "recorded an acceptance for",
    email_collected: "extracted an email for",
    profile_visited: "visited the LinkedIn profile for",
    contact_info_checked: "checked contact info for",
    skipped: "skipped",
    failed: "reported a failure for",
    error: "reported an error for",
  };
  return labels[type] ?? `recorded ${type.replaceAll("_", " ")} for`;
}

function activityTone(type: string) {
  if (type === "email_collected") return "mint";
  if (type === "accepted") return "amber";
  if (type === "connection_requested") return "blue";
  if (type === "failed" || type === "error") return "red";
  return "violet";
}

function activityIcon(type: string) {
  if (type === "email_collected") return <Mail size={13} />;
  if (type === "accepted") return <UserCheck size={13} />;
  if (type === "connection_requested") return <Send size={13} />;
  return <Activity size={13} />;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatChartDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: date.getUTCDate() === 1 ? undefined : "numeric", year: date.getUTCMonth() === 0 && date.getUTCDate() === 1 ? "2-digit" : undefined }).format(date);
}

function formatRelativeTime(value: string) {
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
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function initials(name: string | null) {
  if (!name) return "?";
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function readError(error: unknown) {
  return error instanceof Error ? error.message.replace(/^.*?Uncaught Error:\s*/s, "").split("\n")[0] : "An unexpected error occurred.";
}

export default App;
