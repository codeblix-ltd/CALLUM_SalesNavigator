import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useAction, useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  CloudUpload,
  Copy,
  Database,
  ChevronDown,
  Download,
  ExternalLink,
  FileCheck2,
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
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { api } from "../convex/_generated/api";
import { WeeklyPerformance } from "./WeeklyPerformance";
import "./App.css";

type Range = "7d" | "30d" | "90d" | "all";
type View = "overview" | "scouts" | "weekly" | "operations" | "leads";
type DirectorySection = "leads" | "veblen";
type OverviewSection = "summary" | "trends" | "scouts" | "activity";
type ScoutsSection = "accounts" | "allocation" | "directory";
type WeeklySection = "board" | "comments";
type OperationsSection = "summary" | "questions" | "requests" | "crm";
type ScoutSort = "activity" | "emails" | "accepted" | "assigned" | "name";
type EmailAvailability = "present" | "missing";
type EmailValidation = "validated" | "not_validated";

const SCOUT_PAGE_SIZE = 5;
const ACTIVITY_PAGE_SIZE = 8;
const POST_ACTIVITY_PAGE_SIZE = 5;

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

type DailyScoutEmail = {
  day: string;
  operatorId: string;
  username: string;
  originalEmails: number;
  workEmails: number;
  totalEmails: number;
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

type ScoutAssignedLead = {
  id: string;
  fullName: string | null;
  currentTitle: string | null;
  companyName: string | null;
  profileUrl: string;
  status: string;
  originalEmail: string | null;
  workEmail: string | null;
  assignedAt: string;
  viewedAt: string | null;
  engagedAt: string | null;
  connectionRequestedAt: string | null;
  acceptedAt: string | null;
  emailCollectedAt: string | null;
  canUnassign: boolean;
  unassignBlockedReason: string | null;
};

type ScoutAssignedLeadsPage = {
  generatedAt: string;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  leads: ScoutAssignedLead[];
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
  dailyScoutEmails: DailyScoutEmail[];
  recentActivity: RecentActivity[];
  postActivities: PostActivity[];
};

type NicheAssignment = {
  name: string;
  total: number;
  assigned: number;
  excluded: number;
  unassigned: number;
};

type UnassignedLead = {
  id: string;
  fullName: string | null;
  currentTitle: string | null;
  companyName: string | null;
  profileUrl: string;
};

type UnassignedLeadPage = {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  leads: UnassignedLead[];
};

type HermesUploadLead = {
  id: string;
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  headline: string;
  location: string;
  currentRole: string | null;
  currentCompany: string | null;
  dateFound: string;
  sourceRow: number;
  excludedAsVeblenMember: boolean;
};

type HermesUploadScout = {
  operatorId: string;
  username: string;
};

type HermesUploadResult = {
  importId: string;
  fileName: string;
  niche: string;
  totalRows: number;
  uniqueRows: number;
  leads: HermesUploadLead[];
  scouts: HermesUploadScout[];
};

type HermesAssignmentResult = {
  assignedCount: number;
  skippedCount: number;
  allocations: Array<{
    operatorId: string;
    username: string;
    count: number;
  }>;
};

type VeblenMatch = {
  leadId: string;
  leadName: string | null;
  leadLinkedInUrl: string;
  originalEmail: string | null;
  workEmail: string | null;
  memberId: string;
  memberName: string;
  memberEmail: string | null;
  memberLinkedInUrl: string | null;
  memberProfileUrl: string;
  matchType: string;
  assignedTo: string | null;
  assignmentStatus: string | null;
};

type VeblenMatchesPage = {
  generatedAt: string;
  members: number;
  memberLinkedInUrls: number;
  memberEmails: number;
  matchedLeads: number;
  assignedMatches: number;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  matches: VeblenMatch[];
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
  originalEmail: string | null;
  originalEmailStatus: string;
  originalEmailCheckedAt: string | null;
  workEmail: string | null;
  workEmailValidation: string | null;
  workEmailStatus: string;
  leadNote: string | null;
  leadNoteUpdatedAt: string | null;
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

type Operations = {
  generatedAt: string;
  summary: {
    oldRequests: number;
    followupsDue: number;
    followupsPending: number;
    checklistDone: number;
    checklistTotal: number;
    leadsToCheck: number;
    openEscalations: number;
    crmPending: number;
    crmFailed: number;
    crmSent: number;
  };
  escalations: Array<{
    id: string;
    operatorId: string;
    leadName: string | null;
    subject: string;
    message: string;
    createdAt: string;
  }>;
  crmRows: Array<{
    id: string;
    operatorId: string;
    leadName: string | null;
    email: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    createdAt: string;
  }>;
  oldRequests: Array<{
    operatorId: string;
    leadName: string | null;
    profileUrl: string;
    requestedAt: string;
    ageDays: number;
  }>;
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
  const [username, setUsername] = useState("");
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

function SidebarSectionNav({ ariaLabel, items }: {
  ariaLabel: string;
  items: Array<{ label: string; icon: ReactNode; active: boolean; onClick: () => void }>;
}) {
  return (
    <div className="sidebar-subnav" aria-label={ariaLabel}>
      {items.map((item) => (
        <button key={item.label} className={item.active ? "active" : ""} onClick={item.onClick} aria-current={item.active ? "page" : undefined}>
          {item.icon} {item.label}
        </button>
      ))}
    </div>
  );
}

function Dashboard({ adminName }: { adminName: string }) {
  const { signOut } = useAuthActions();
  const getOverview = useAction(api.adminAnalytics.getOverview);
  const getScoutAssignedLeads = useAction(api.adminAnalytics.getScoutAssignedLeads);
  const getOperations = useAction(api.adminAnalytics.getOperations);
  const exportCleanCsv = useAction(api.adminAnalytics.exportCleanCsv);
  const resolveEscalation = useAction(api.adminAnalytics.resolveEscalation);
  const retryCrmDelivery = useAction(api.adminAnalytics.retryCrmDelivery);
  const getStats = useAction(api.leads.getStats);
  const listLeads = useAction(api.leads.list);
  const exportFilteredLeads = useAction(api.leads.exportCsv);
  const getCodexStatus = useAction(api.codexGateway.getStatus);
  const startCodexLogin = useAction(api.codexGateway.startDeviceLogin);
  const getCodexLoginStatus = useAction(api.codexGateway.getDeviceLoginStatus);
  const logoutCodex = useAction(api.codexGateway.logout);
  const uploadHermesLeads = useAction(api.hermesUpload.uploadLeads);
  const confirmHermesAssignments = useAction(api.hermesUpload.confirmAssignments);
  const createScout = useAction(api.adminScouts.createScout);
  const getNicheAssignments = useAction(api.adminScouts.getNicheAssignments);
  const listUnassignedLeads = useAction(api.adminScouts.listUnassignedLeads);
  const assignLeadsToScout = useAction(api.adminScouts.assignLeads);
  const assignLeadCount = useAction(api.adminScouts.assignLeadCount);
  const setScoutActive = useAction(api.adminScouts.setScoutActive);
  const getVeblenMatches = useAction(api.adminVeblenMembers.getMatches);
  const [view, setView] = useState<View>("overview");
  const [overviewSection, setOverviewSection] = useState<OverviewSection>("summary");
  const [scoutsSection, setScoutsSection] = useState<ScoutsSection>("accounts");
  const [weeklySection, setWeeklySection] = useState<WeeklySection>("board");
  const [operationsSection, setOperationsSection] = useState<OperationsSection>("summary");
  const [directorySection, setDirectorySection] = useState<DirectorySection>("leads");
  const [range, setRange] = useState<Range>("all");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState("");
  const [operations, setOperations] = useState<Operations | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsError, setOperationsError] = useState("");
  const [operationsNotice, setOperationsNotice] = useState("");
  const [operationsBusy, setOperationsBusy] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [niches, setNiches] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [originalEmailFilters, setOriginalEmailFilters] = useState<EmailAvailability[]>([]);
  const [workEmailFilters, setWorkEmailFilters] = useState<EmailAvailability[]>([]);
  const [workEmailValidationFilters, setWorkEmailValidationFilters] = useState<EmailValidation[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filteredLeadCount, setFilteredLeadCount] = useState<number | null>(null);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadExporting, setLeadExporting] = useState(false);
  const [leadNotice, setLeadNotice] = useState("");
  const [leadError, setLeadError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [scoutSearch, setScoutSearch] = useState("");
  const [scoutSort, setScoutSort] = useState<ScoutSort>("activity");
  const [selectedScout, setSelectedScout] = useState<string | null>(null);
  const [scoutAssignedLeads, setScoutAssignedLeads] = useState<ScoutAssignedLeadsPage | null>(null);
  const [scoutAssignedLeadsPage, setScoutAssignedLeadsPage] = useState(1);
  const [scoutAssignedLeadsLoading, setScoutAssignedLeadsLoading] = useState(false);
  const [scoutAssignedLeadsError, setScoutAssignedLeadsError] = useState("");
  const [scoutAssignedLeadsRefreshKey, setScoutAssignedLeadsRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [codexError, setCodexError] = useState("");
  const [codexBusy, setCodexBusy] = useState(false);
  const [deviceLogin, setDeviceLogin] = useState<DeviceLogin | null>(null);
  const [uploadLeadsOpen, setUploadLeadsOpen] = useState(false);
  const [nicheAssignments, setNicheAssignments] = useState<NicheAssignment[]>([]);
  const [nicheAssignmentsLoading, setNicheAssignmentsLoading] = useState(false);
  const [scoutAdminError, setScoutAdminError] = useState("");

  const navigateTo = useCallback((nextView: View) => {
    setView(nextView);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

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

  const refreshOperations = useCallback(async () => {
    setOperationsLoading(true);
    setOperationsError("");
    try {
      setOperations(await getOperations({}));
    } catch (error) {
      setOperationsError(readError(error));
    } finally {
      setOperationsLoading(false);
    }
  }, [getOperations]);

  const refreshNicheAssignments = useCallback(async () => {
    setNicheAssignmentsLoading(true);
    setScoutAdminError("");
    try {
      const result = await getNicheAssignments({});
      setNicheAssignments(result.niches);
    } catch (error) {
      setScoutAdminError(readError(error));
    } finally {
      setNicheAssignmentsLoading(false);
    }
  }, [getNicheAssignments]);

  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    setLeadError("");
    try {
      const page = await listLeads({
        niches,
        search: debouncedSearch || null,
        originalEmailFilters,
        workEmailFilters,
        workEmailValidationFilters,
        cursor,
        limit: 50,
      });
      setLeads(page.leads);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setFilteredLeadCount(page.filteredCount);
    } catch (error) {
      setLeadError(readError(error));
      setLeads([]);
      setFilteredLeadCount(null);
    } finally {
      setLeadsLoading(false);
    }
  }, [cursor, debouncedSearch, listLeads, niches, originalEmailFilters, workEmailFilters, workEmailValidationFilters]);

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
      setFilteredLeadCount(null);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    setCursor(null);
    setCursorHistory([]);
    setFilteredLeadCount(null);
    setLeadNotice("");
  }, [niches, originalEmailFilters, workEmailFilters, workEmailValidationFilters]);

  useEffect(() => {
    if (view === "leads" && directorySection === "leads") void loadLeads();
  }, [directorySection, loadLeads, view]);

  useEffect(() => {
    if (view === "operations") void refreshOperations();
  }, [refreshOperations, view]);

  useEffect(() => {
    if (view === "scouts") void refreshNicheAssignments();
  }, [refreshNicheAssignments, view]);

  useEffect(() => {
    setScoutAssignedLeadsPage(1);
    setScoutAssignedLeads(null);
    setScoutAssignedLeadsError("");
  }, [selectedScout]);

  useEffect(() => {
    if (!selectedScout) {
      setScoutAssignedLeads(null);
      return;
    }
    let cancelled = false;
    setScoutAssignedLeadsLoading(true);
    setScoutAssignedLeadsError("");
    void getScoutAssignedLeads({
      operatorId: selectedScout,
      page: scoutAssignedLeadsPage,
      pageSize: 25,
    }).then((result) => {
      if (!cancelled) setScoutAssignedLeads(result);
    }).catch((error) => {
      if (!cancelled) setScoutAssignedLeadsError(readError(error));
    }).finally(() => {
      if (!cancelled) setScoutAssignedLeadsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [getScoutAssignedLeads, scoutAssignedLeadsPage, scoutAssignedLeadsRefreshKey, selectedScout]);

  const handleAssignedLeadChanged = useCallback(async () => {
    setScoutAssignedLeadsRefreshKey((current) => current + 1);
    await Promise.all([refreshOverview(), refreshNicheAssignments()]);
  }, [refreshNicheAssignments, refreshOverview]);

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
    () => niches.length === 1
      ? stats?.niches.find((item) => item.name === niches[0])?.count ?? stats?.total ?? 0
      : stats?.total ?? 0,
    [niches, stats],
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

  async function downloadCleanExport() {
    setOperationsBusy(true);
    setOperationsError("");
    setOperationsNotice("");
    try {
      const result = await exportCleanCsv({});
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setOperationsNotice(
        `Downloaded ${formatNumber(result.rowCount)} clean rows${result.invalidEmailsRemoved ? `; ${result.invalidEmailsRemoved} bad email values were left blank` : ""}.`,
      );
    } catch (error) {
      setOperationsError(readError(error));
    } finally {
      setOperationsBusy(false);
    }
  }

  async function downloadFilteredLeads() {
    setLeadExporting(true);
    setLeadError("");
    setLeadNotice("");
    try {
      const result = await exportFilteredLeads({
        niches,
        search: debouncedSearch || null,
        originalEmailFilters,
        workEmailFilters,
        workEmailValidationFilters,
      });
      const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setLeadNotice(`Downloaded ${formatNumber(result.rowCount)} filtered leads${result.truncated ? " (export capped at 25,000 rows)" : ""}.`);
    } catch (error) {
      setLeadError(readError(error));
    } finally {
      setLeadExporting(false);
    }
  }

  async function sendWaitingCrmRows() {
    setOperationsBusy(true);
    setOperationsError("");
    setOperationsNotice("");
    try {
      const result = await retryCrmDelivery({ outboxId: null });
      setOperationsNotice(
        result.attempted === 0
          ? "There are no CRM records waiting."
          : `Sent ${result.sent} of ${result.attempted} records. ${result.failed} need attention.`,
      );
      await refreshOperations();
    } catch (error) {
      setOperationsError(readError(error));
    } finally {
      setOperationsBusy(false);
    }
  }

  async function closeEscalation(escalationId: string) {
    setOperationsBusy(true);
    setOperationsError("");
    try {
      await resolveEscalation({ escalationId });
      setOperationsNotice("Question closed.");
      await refreshOperations();
    } catch (error) {
      setOperationsError(readError(error));
    } finally {
      setOperationsBusy(false);
    }
  }

  const connectionError = analyticsError || leadError || scoutAdminError;
  const viewLabel = view === "overview"
    ? "Overview"
    : view === "scouts"
      ? "Scout administration"
      : view === "weekly"
        ? "Weekly board"
        : view === "operations"
          ? "Daily work"
          : "Lead directory";
  const sectionLabel = view === "overview"
    ? overviewSection === "summary" ? "Summary" : overviewSection === "trends" ? "Trends" : overviewSection === "scouts" ? "Scout performance" : "Activity & coverage"
    : view === "scouts"
      ? scoutsSection === "accounts" ? "Accounts & capacity" : scoutsSection === "allocation" ? "Lead allocation" : "Scout directory"
      : view === "weekly"
        ? weeklySection === "board" ? "Leaderboard" : "Comments & posts"
        : view === "operations"
          ? operationsSection === "summary" ? "Work summary" : operationsSection === "questions" ? "Scout questions" : operationsSection === "requests" ? "Old requests" : "CRM queue"
          : directorySection === "leads" ? "All leads" : "Veblen exclusions";
  const heroContent = view === "scouts"
    ? {
        eyebrow: "Scout administration",
        title: <>Manage your scout<br /><span>team and queues.</span></>,
        copy: "Create secure scout logins, see assignment capacity by niche, and place individual leads into the right scout’s queue.",
      }
    : view === "weekly"
      ? {
          eyebrow: "Weekly scout results",
          title: <>Recognise the strongest<br /><span>work this week.</span></>,
          copy: "Review submitted comments, compare outcomes, add missing KPIs, and prepare a clean team screenshot.",
        }
    : view === "operations"
      ? {
          eyebrow: "Daily operations",
          title: <>Keep daily work<br /><span>moving forward.</span></>,
          copy: "Review questions, follow-ups, CRM delivery, and operational exceptions in one place.",
        }
      : view === "leads"
        ? {
            eyebrow: "Lead directory",
            title: <>Find every lead,<br /><span>without the clutter.</span></>,
            copy: "Search, filter, review, and export the live lead inventory across every niche.",
          }
        : {
            eyebrow: "Lead operations",
            title: <>Your lead universe,<br /><span>ready to work.</span></>,
            copy: "One private view of scout capacity, pipeline progress, and every lead outcome.",
          };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Callum Leads home">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <span>Callum<span className="brand-accent">Leads</span></span>
        </a>
        <p className="sidebar-label">Workspace</p>
        <nav className="main-nav" aria-label="Workspace views">
          <button className={view === "overview" ? "active" : ""} onClick={() => navigateTo("overview")} aria-current={view === "overview" ? "page" : undefined}><BarChart3 size={17} /> Overview</button>
          <SidebarSectionNav ariaLabel="Overview sections" items={[
            { label: "Summary", icon: <BarChart3 size={15} />, active: view === "overview" && overviewSection === "summary", onClick: () => { setOverviewSection("summary"); navigateTo("overview"); } },
            { label: "Trends", icon: <TrendingUp size={15} />, active: view === "overview" && overviewSection === "trends", onClick: () => { setOverviewSection("trends"); navigateTo("overview"); } },
            { label: "Scout performance", icon: <Users size={15} />, active: view === "overview" && overviewSection === "scouts", onClick: () => { setOverviewSection("scouts"); navigateTo("overview"); } },
            { label: "Activity & coverage", icon: <Activity size={15} />, active: view === "overview" && overviewSection === "activity", onClick: () => { setOverviewSection("activity"); navigateTo("overview"); } },
          ]} />
          <button className={view === "scouts" ? "active" : ""} onClick={() => navigateTo("scouts")} aria-current={view === "scouts" ? "page" : undefined}><Users size={17} /> Scouts</button>
          <SidebarSectionNav ariaLabel="Scout administration sections" items={[
            { label: "Accounts & capacity", icon: <UserCheck size={15} />, active: view === "scouts" && scoutsSection === "accounts", onClick: () => { setScoutsSection("accounts"); navigateTo("scouts"); } },
            { label: "Lead allocation", icon: <Target size={15} />, active: view === "scouts" && scoutsSection === "allocation", onClick: () => { setScoutsSection("allocation"); navigateTo("scouts"); } },
            { label: "Scout directory", icon: <Users size={15} />, active: view === "scouts" && scoutsSection === "directory", onClick: () => { setScoutsSection("directory"); navigateTo("scouts"); } },
          ]} />
          <button className={view === "weekly" ? "active" : ""} onClick={() => navigateTo("weekly")} aria-current={view === "weekly" ? "page" : undefined}><TrendingUp size={17} /> Weekly board</button>
          <SidebarSectionNav ariaLabel="Weekly board sections" items={[
            { label: "Leaderboard", icon: <TrendingUp size={15} />, active: view === "weekly" && weeklySection === "board", onClick: () => { setWeeklySection("board"); navigateTo("weekly"); } },
            { label: "Comments & posts", icon: <Send size={15} />, active: view === "weekly" && weeklySection === "comments", onClick: () => { setWeeklySection("comments"); navigateTo("weekly"); } },
          ]} />
          <button className={view === "operations" ? "active" : ""} onClick={() => navigateTo("operations")} aria-current={view === "operations" ? "page" : undefined}><Activity size={17} /> Daily work</button>
          <SidebarSectionNav ariaLabel="Daily work sections" items={[
            { label: "Work summary", icon: <BarChart3 size={15} />, active: view === "operations" && operationsSection === "summary", onClick: () => { setOperationsSection("summary"); navigateTo("operations"); } },
            { label: "Scout questions", icon: <Users size={15} />, active: view === "operations" && operationsSection === "questions", onClick: () => { setOperationsSection("questions"); navigateTo("operations"); } },
            { label: "Old requests", icon: <Clock3 size={15} />, active: view === "operations" && operationsSection === "requests", onClick: () => { setOperationsSection("requests"); navigateTo("operations"); } },
            { label: "CRM queue", icon: <Database size={15} />, active: view === "operations" && operationsSection === "crm", onClick: () => { setOperationsSection("crm"); navigateTo("operations"); } },
          ]} />
          <button className={view === "leads" ? "active" : ""} onClick={() => { setDirectorySection("leads"); navigateTo("leads"); }} aria-current={view === "leads" ? "page" : undefined}><Database size={17} /> Lead directory</button>
          <SidebarSectionNav ariaLabel="Lead directory sections" items={[
            { label: "All leads", icon: <Database size={15} />, active: view === "leads" && directorySection === "leads", onClick: () => { setDirectorySection("leads"); navigateTo("leads"); } },
            { label: "Veblen exclusions", icon: <ShieldCheck size={15} />, active: view === "leads" && directorySection === "veblen", onClick: () => { setDirectorySection("veblen"); navigateTo("leads"); } },
          ]} />
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-footer"><LockKeyhole size={13} /> Private admin workspace</div>
      </aside>

      <div className="app-body">
        <header className="topbar">
          <div className="topbar-context"><span>{viewLabel}</span><strong>{sectionLabel}</strong></div>
          <div className="topbar-actions">
            <button className="upload-leads-button" onClick={() => setUploadLeadsOpen(true)}>
              <CloudUpload size={16} /> Upload leads
            </button>
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
            <p className="eyebrow"><Database size={15} /> {heroContent.eyebrow}</p>
            <h1>{heroContent.title}</h1>
            <p className="hero-copy">{heroContent.copy}</p>
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
            scoutAssignedLeads={scoutAssignedLeads}
            scoutAssignedLeadsLoading={scoutAssignedLeadsLoading}
            scoutAssignedLeadsError={scoutAssignedLeadsError}
            onScoutAssignedLeadsPageChange={setScoutAssignedLeadsPage}
            onAssignedLeadChanged={handleAssignedLeadChanged}
            section={overviewSection}
          />
        ) : view === "scouts" ? (
          <ScoutsPage
            scouts={filteredScouts}
            scoutSearch={scoutSearch}
            setScoutSearch={setScoutSearch}
            scoutSort={scoutSort}
            setScoutSort={setScoutSort}
            selectedScout={selectedScout}
            setSelectedScout={setSelectedScout}
            activeScout={activeScout}
            scoutActivity={scoutActivity}
            scoutAssignedLeads={scoutAssignedLeads}
            scoutAssignedLeadsLoading={scoutAssignedLeadsLoading}
            scoutAssignedLeadsError={scoutAssignedLeadsError}
            onScoutAssignedLeadsPageChange={setScoutAssignedLeadsPage}
            onAssignedLeadChanged={handleAssignedLeadChanged}
            niches={nicheAssignments}
            nichesLoading={nicheAssignmentsLoading}
            error={scoutAdminError}
            createScout={createScout}
            listUnassignedLeads={listUnassignedLeads}
            assignLeads={assignLeadsToScout}
            assignLeadCount={assignLeadCount}
            setScoutActive={setScoutActive}
            refresh={async () => {
              await Promise.all([refreshOverview(), refreshNicheAssignments()]);
            }}
            section={scoutsSection}
          />
        ) : view === "weekly" ? (
          <WeeklyPerformance section={weeklySection} />
        ) : view === "operations" ? (
          <OperationsCenter
            operations={operations}
            loading={operationsLoading}
            error={operationsError}
            notice={operationsNotice}
            busy={operationsBusy}
            refresh={refreshOperations}
            download={downloadCleanExport}
            sendToCrm={sendWaitingCrmRows}
            closeEscalation={closeEscalation}
            section={operationsSection}
          />
        ) : (
          <LeadDirectory
            stats={stats}
            niches={niches}
            setNiches={setNiches}
            search={search}
            setSearch={setSearch}
            originalEmailFilters={originalEmailFilters}
            setOriginalEmailFilters={setOriginalEmailFilters}
            workEmailFilters={workEmailFilters}
            setWorkEmailFilters={setWorkEmailFilters}
            workEmailValidationFilters={workEmailValidationFilters}
            setWorkEmailValidationFilters={setWorkEmailValidationFilters}
            onExport={downloadFilteredLeads}
            exporting={leadExporting}
            notice={leadNotice}
            viewCount={filteredLeadCount ?? activeNicheCount}
            leads={leads}
            loading={leadsLoading}
            error={leadError}
            onRefresh={loadLeads}
            currentPage={currentPage}
            canGoPrevious={cursorHistory.length > 0}
            canGoNext={hasMore && Boolean(nextCursor)}
            previousPage={previousPage}
            nextPage={nextPage}
            loadVeblenMatches={getVeblenMatches}
            directorySection={directorySection}
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
      {uploadLeadsOpen && (
        <UploadLeadsModal
          close={() => setUploadLeadsOpen(false)}
          upload={uploadHermesLeads}
          confirm={confirmHermesAssignments}
          onAssigned={async () => {
            await Promise.all([refreshOverview(), refreshStats()]);
          }}
        />
      )}
      </div>
    </div>
  );
}

function VeblenExclusionsPage({ load }: {
  load: (args: { search: string | null; page: number; pageSize: number }) => Promise<VeblenMatchesPage>;
}) {
  const [data, setData] = useState<VeblenMatchesPage | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim().length >= 3 ? search.trim() : "");
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await load({ search: debouncedSearch || null, page, pageSize: 25 }));
    } catch (loadError) {
      setError(readError(loadError));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, load, page]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="veblen-page veblen-directory-section">
      <div className="workspace-heading veblen-directory-heading">
        <div>
          <p className="eyebrow">Protected member list</p>
          <h2>Keep Veblen members out of every queue.</h2>
          <p>Review directory coverage and every database lead matched by LinkedIn URL or public email.</p>
        </div>
      </div>
      <section className="veblen-summary-grid" aria-label="Veblen exclusion summary">
        <article><span><Users size={17} /></span><div><strong>{formatNumber(data?.members ?? 0)}</strong><small>directory members</small></div></article>
        <article><span><ExternalLink size={17} /></span><div><strong>{formatNumber(data?.memberLinkedInUrls ?? 0)}</strong><small>LinkedIn identifiers</small></div></article>
        <article><span><Mail size={17} /></span><div><strong>{formatNumber(data?.memberEmails ?? 0)}</strong><small>public emails</small></div></article>
        <article className="is-alert"><span><ShieldCheck size={17} /></span><div><strong>{formatNumber(data?.matchedLeads ?? 0)}</strong><small>database leads excluded</small></div></article>
      </section>

      <section className="panel veblen-matches-panel">
        <div className="workspace-heading veblen-heading">
          <PanelHeading
            eyebrow="Live protection"
            title="Matched leads"
            description="LinkedIn URL and public-email matches are blocked from uploads, assignments, scout queues, and work-email runs"
            icon={<ShieldCheck size={18} />}
          />
          <div className="veblen-controls">
            <label className="search-field compact"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lead or member" />{search && <button onClick={() => setSearch("")} aria-label="Clear Veblen search"><X size={14} /></button>}</label>
            <button className="secondary-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh</button>
          </div>
        </div>

        {data && (
          <div className="veblen-protection-note">
            <ShieldCheck size={16} />
            <span><strong>{formatNumber(data.matchedLeads)} matched leads are protected.</strong> {formatNumber(data.assignedMatches)} retain assignment history but can no longer enter a scout workflow. Updated {formatRelativeTime(data.generatedAt)}.</span>
          </div>
        )}
        {search.trim().length > 0 && search.trim().length < 3 && <p className="veblen-search-hint">Type at least 3 characters to filter matches.</p>}
        {error && <div className="upload-error veblen-error"><AlertTriangle size={16} /><span>{error}</span></div>}
        {loading && !data ? (
          <div className="assigned-leads-state"><RefreshCw size={16} className="spin" /> Loading protected leads…</div>
        ) : data && (
          <>
            <div className="veblen-table-scroll">
              <table className="veblen-table">
                <thead><tr><th>Database lead</th><th>Veblen member</th><th>Matched by</th><th>Assignment history</th></tr></thead>
                <tbody>{data.matches.map((match) => (
                  <tr key={match.leadId}>
                    <td><strong>{match.leadName || "Unnamed lead"}</strong><span>{match.originalEmail || match.workEmail || "No stored email"}</span>{match.leadLinkedInUrl && <a href={match.leadLinkedInUrl} target="_blank" rel="noreferrer">Lead LinkedIn <ExternalLink size={10} /></a>}</td>
                    <td><strong>{match.memberName}</strong><span>{match.memberEmail || "No public email"}</span><div className="veblen-member-links"><a href={match.memberProfileUrl} target="_blank" rel="noreferrer">Veblen profile <ExternalLink size={10} /></a>{match.memberLinkedInUrl && <a href={match.memberLinkedInUrl} target="_blank" rel="noreferrer">LinkedIn <ExternalLink size={10} /></a>}</div></td>
                    <td><span className="veblen-match-pill">{match.matchType}</span></td>
                    <td>{match.assignedTo ? <><strong>{match.assignedTo}</strong><span>{match.assignmentStatus || "assigned"} · history retained</span></> : <><strong>Never assigned</strong><span>Protected before allocation</span></>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {data.matches.length === 0 && <div className="assigned-leads-state">No protected leads match this search.</div>}
            {data.pageCount > 1 && <div className="pagination veblen-pagination"><p>Page {data.page} of {data.pageCount} · {formatNumber(data.total)} matches</p><div><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={data.page === 1 || loading}><ArrowLeft size={15} /> Previous</button><button onClick={() => setPage((value) => Math.min(data.pageCount, value + 1))} disabled={data.page === data.pageCount || loading}>Next <ArrowRight size={15} /></button></div></div>}
          </>
        )}
      </section>
    </div>
  );
}

function ScoutsPage({
  scouts,
  scoutSearch,
  setScoutSearch,
  scoutSort,
  setScoutSort,
  selectedScout,
  setSelectedScout,
  activeScout,
  scoutActivity,
  scoutAssignedLeads,
  scoutAssignedLeadsLoading,
  scoutAssignedLeadsError,
  onScoutAssignedLeadsPageChange,
  onAssignedLeadChanged,
  niches,
  nichesLoading,
  error,
  createScout,
  listUnassignedLeads,
  assignLeads,
  assignLeadCount,
  setScoutActive,
  refresh,
  section,
}: {
  scouts: ScoutMetrics[];
  scoutSearch: string;
  setScoutSearch: (value: string) => void;
  scoutSort: ScoutSort;
  setScoutSort: (value: ScoutSort) => void;
  selectedScout: string | null;
  setSelectedScout: (value: string | null) => void;
  activeScout: ScoutMetrics | null;
  scoutActivity: RecentActivity[];
  scoutAssignedLeads: ScoutAssignedLeadsPage | null;
  scoutAssignedLeadsLoading: boolean;
  scoutAssignedLeadsError: string;
  onScoutAssignedLeadsPageChange: (page: number) => void;
  onAssignedLeadChanged: () => Promise<void>;
  niches: NicheAssignment[];
  nichesLoading: boolean;
  error: string;
  createScout: (args: { username: string }) => Promise<{ username: string; password: string }>;
  listUnassignedLeads: (args: { niche: string; search: string | null; page: number; pageSize: number }) => Promise<UnassignedLeadPage>;
  assignLeads: (args: { operatorId: string; niche: string; leadIds: string[] }) => Promise<{ assigned: number; skipped: number }>;
  assignLeadCount: (args: { operatorId: string; niche: string; count: number }) => Promise<{ requested: number; assigned: number; remaining: number }>;
  setScoutActive: (args: { operatorId: string; active: boolean }) => Promise<{ operatorId: string; username: string; active: boolean }>;
  refresh: () => Promise<void>;
  section: ScoutsSection;
}) {
  const [username, setUsername] = useState("");
  const [createdCredential, setCreatedCredential] = useState<{ username: string; password: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [copied, setCopied] = useState<"username" | "password" | null>(null);
  const [assignmentScout, setAssignmentScout] = useState("");
  const [assignmentNiche, setAssignmentNiche] = useState("");
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [debouncedAssignmentSearch, setDebouncedAssignmentSearch] = useState("");
  const [unassignedPage, setUnassignedPage] = useState<UnassignedLeadPage | null>(null);
  const [unassignedPageNumber, setUnassignedPageNumber] = useState(1);
  const [unassignedLoading, setUnassignedLoading] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [quickAssignCount, setQuickAssignCount] = useState("50");
  const [quickAssigning, setQuickAssigning] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [scoutToggleBusyId, setScoutToggleBusyId] = useState<string | null>(null);

  const activeScouts = scouts.filter((scout) => scout.active && scout.hasAccount);

  useEffect(() => {
    if (!assignmentScout && activeScouts.length > 0) setAssignmentScout(activeScouts[0].operatorId);
    if (assignmentScout && !activeScouts.some((scout) => scout.operatorId === assignmentScout)) {
      setAssignmentScout(activeScouts[0]?.operatorId ?? "");
    }
  }, [activeScouts, assignmentScout]);

  useEffect(() => {
    if (!assignmentNiche && niches.length > 0) setAssignmentNiche(niches[0].name);
  }, [assignmentNiche, niches]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedAssignmentSearch(assignmentSearch.trim().length >= 3 ? assignmentSearch.trim() : "");
      setUnassignedPageNumber(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [assignmentSearch]);

  const loadUnassigned = useCallback(async () => {
    if (!assignmentOpen || !assignmentNiche) {
      setUnassignedPage(null);
      return;
    }
    setUnassignedLoading(true);
    setAssignmentError("");
    try {
      setUnassignedPage(await listUnassignedLeads({
        niche: assignmentNiche,
        search: debouncedAssignmentSearch || null,
        page: unassignedPageNumber,
        pageSize: 25,
      }));
      setSelectedLeadIds([]);
    } catch (loadError) {
      setAssignmentError(readError(loadError));
      setUnassignedPage(null);
    } finally {
      setUnassignedLoading(false);
    }
  }, [assignmentNiche, assignmentOpen, debouncedAssignmentSearch, listUnassignedLeads, unassignedPageNumber]);

  useEffect(() => {
    void loadUnassigned();
  }, [loadUnassigned]);

  async function submitScout(event: FormEvent) {
    event.preventDefault();
    const normalized = username.trim().toLowerCase();
    if (normalized.length < 3) {
      setCreateError("Username must be at least 3 characters.");
      return;
    }
    setCreating(true);
    setCreateError("");
    setCreatedCredential(null);
    try {
      const result = await createScout({ username: normalized });
      setCreatedCredential(result);
      setUsername("");
      await refresh();
      setAssignmentScout(result.username);
    } catch (submitError) {
      setCreateError(readError(submitError));
    } finally {
      setCreating(false);
    }
  }

  async function copyCredential(kind: "username" | "password", value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1_500);
  }

  function toggleLead(leadId: string) {
    setSelectedLeadIds((current) => current.includes(leadId)
      ? current.filter((id) => id !== leadId)
      : [...current, leadId]);
  }

  async function assignSelected() {
    if (!assignmentScout || !assignmentNiche || selectedLeadIds.length === 0) return;
    setAssigning(true);
    setAssignmentError("");
    setAssignmentNotice("");
    try {
      const result = await assignLeads({
        operatorId: assignmentScout,
        niche: assignmentNiche,
        leadIds: selectedLeadIds,
      });
      setAssignmentNotice(
        `${formatNumber(result.assigned)} lead${result.assigned === 1 ? "" : "s"} assigned to ${assignmentScout}${result.skipped ? `; ${result.skipped} were already assigned.` : "."}`,
      );
      setSelectedLeadIds([]);
      await Promise.all([loadUnassigned(), refresh()]);
    } catch (assignError) {
      setAssignmentError(readError(assignError));
    } finally {
      setAssigning(false);
    }
  }

  async function assignByCount() {
    const count = Number(quickAssignCount);
    if (!assignmentScout || !assignmentNiche || !Number.isSafeInteger(count) || count < 1) {
      setAssignmentError("Choose an active scout, a niche, and a lead count of at least 1.");
      return;
    }
    setQuickAssigning(true);
    setAssignmentError("");
    setAssignmentNotice("");
    try {
      const result = await assignLeadCount({
        operatorId: assignmentScout,
        niche: assignmentNiche,
        count,
      });
      setAssignmentNotice(
        `${formatNumber(result.assigned)} of ${formatNumber(result.requested)} requested lead${result.requested === 1 ? "" : "s"} assigned to ${assignmentScout}. ${formatNumber(result.remaining)} remain open in ${assignmentNiche}.`,
      );
      setSelectedLeadIds([]);
      await Promise.all([loadUnassigned(), refresh()]);
    } catch (assignError) {
      setAssignmentError(readError(assignError));
    } finally {
      setQuickAssigning(false);
    }
  }

  async function toggleScout(scout: ScoutMetrics) {
    setScoutToggleBusyId(scout.operatorId);
    setAssignmentError("");
    try {
      const result = await setScoutActive({ operatorId: scout.operatorId, active: !scout.active });
      setAssignmentNotice(`${result.username} is now ${result.active ? "enabled" : "disabled"}. ${result.active ? "They can be included in future uploads." : "They will be excluded from lead uploads."}`);
      await refresh();
    } catch (toggleError) {
      setAssignmentError(readError(toggleError));
    } finally {
      setScoutToggleBusyId(null);
    }
  }

  return (
      <div className="scouts-workspace">
      {error && <Notice message={error} onRetry={refresh} />}
      {section === "accounts" && <>
      <section className="scout-admin-grid">
        <article className="panel create-scout-panel">
          <PanelHeading eyebrow="New account" title="Create a scout" description="Generate a login for a new team member" icon={<UserCheck size={18} />} />
          <form className="create-scout-form" onSubmit={submitScout}>
            <label>
              Username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                minLength={3}
                maxLength={40}
                pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,39}"
                placeholder="e.g. scout.jane"
                autoComplete="off"
                required
              />
            </label>
            <p>Minimum 3 characters. Letters, numbers, dots, underscores, and hyphens are allowed.</p>
            {createError && <p className="form-error">{createError}</p>}
            <button className="primary-button" type="submit" disabled={creating || username.trim().length < 3}>
              {creating ? <RefreshCw size={15} className="spin" /> : <UserCheck size={15} />}
              {creating ? "Creating scout…" : "Create scout and password"}
            </button>
          </form>
          {createdCredential && (
            <div className="credential-card">
              <div><CheckCircle2 size={17} /><strong>Scout created</strong></div>
              <p>Copy this password now. For security, the dashboard cannot recover it after this card is closed or the page is refreshed.</p>
              <label><span>Username</span><code>{createdCredential.username}</code><button type="button" onClick={() => void copyCredential("username", createdCredential.username)}>{copied === "username" ? <Check size={14} /> : <Copy size={14} />}</button></label>
              <label><span>Password</span><code>{createdCredential.password}</code><button type="button" onClick={() => void copyCredential("password", createdCredential.password)}>{copied === "password" ? <Check size={14} /> : <Copy size={14} />}</button></label>
            </div>
          )}
        </article>

        <article className="panel niche-capacity-panel">
          <PanelHeading eyebrow="Lead capacity" title="Assigned vs unassigned by niche" description="Every niche, with live assignment coverage" icon={<Database size={18} />} />
          {nichesLoading && niches.length === 0 ? (
            <div className="compact-loading"><RefreshCw size={16} className="spin" /> Loading niche counts…</div>
          ) : (
            <div className="niche-capacity-table-scroll">
              <table className="niche-capacity-table">
                <thead><tr><th>Niche</th><th>Total</th><th>Assigned</th><th>Veblen excluded</th><th>Available</th></tr></thead>
                <tbody>{niches.map((niche) => <tr key={niche.name}><td>{niche.name}</td><td>{formatNumber(niche.total)}</td><td>{formatNumber(niche.assigned)}</td><td><span className="veblen-count">{formatNumber(niche.excluded)}</span></td><td><strong>{formatNumber(niche.unassigned)}</strong></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </article>
      </section>
      </>}

      {section === "allocation" && <>
      <section className={`panel manual-assignment-panel ${assignmentOpen ? "is-open" : "is-collapsed"}`}>
        <div className="manual-assignment-head">
          <div className="manual-assignment-title"><PanelHeading eyebrow="Manual allocation" title="Assign leads to a scout" description="Choose a niche, assign a quantity, or select individual leads" icon={<Target size={18} />} /><button className="scout-directory-toggle manual-assignment-toggle" type="button" onClick={() => setAssignmentOpen((open) => !open)} aria-expanded={assignmentOpen}><ChevronDown size={16} className={assignmentOpen ? "rotate-180" : ""} />{assignmentOpen ? "Collapse" : "Expand"}</button></div>
          {assignmentOpen && <button className="secondary-button" onClick={() => void loadUnassigned()} disabled={unassignedLoading}><RefreshCw size={14} className={unassignedLoading ? "spin" : ""} /> Refresh</button>}
        </div>
        {assignmentOpen && <>
        <div className="assignment-filters">
          <label>Scout<select value={assignmentScout} onChange={(event) => setAssignmentScout(event.target.value)}><option value="">Select scout</option>{activeScouts.map((scout) => <option key={scout.operatorId} value={scout.operatorId}>{scout.username}</option>)}</select></label>
          <label>Niche<select value={assignmentNiche} onChange={(event) => { setAssignmentNiche(event.target.value); setUnassignedPageNumber(1); }}><option value="">Select niche</option>{niches.map((niche) => <option key={niche.name} value={niche.name}>{niche.name} ({formatNumber(niche.unassigned)} open)</option>)}</select></label>
          <label>Search leads<input value={assignmentSearch} onChange={(event) => setAssignmentSearch(event.target.value)} placeholder="Type at least 3 characters" /></label>
        </div>
        <div className="quick-assignment">
          <div><strong>Quick assign by quantity</strong><span>Take the next available leads from the selected niche automatically.</span></div>
          <label>Number of leads<input type="number" min="1" max="100000" step="1" value={quickAssignCount} onChange={(event) => setQuickAssignCount(event.target.value)} /></label>
          <button className="primary-button" type="button" onClick={() => void assignByCount()} disabled={quickAssigning || !assignmentScout || !assignmentNiche || Number(quickAssignCount) < 1}>{quickAssigning ? <RefreshCw size={14} className="spin" /> : <Target size={14} />}{quickAssigning ? "Assigning…" : "Assign quantity"}</button>
        </div>
        {assignmentNotice && <p className="assignment-success"><CheckCircle2 size={15} />{assignmentNotice}</p>}
        {assignmentError && <p className="form-error assignment-message">{assignmentError}</p>}
        {unassignedLoading ? <div className="compact-loading assignment-loading"><RefreshCw size={17} className="spin" /> Loading unassigned leads…</div> : unassignedPage && (
          <>
            <div className="assignment-selection-bar">
              <span>{formatNumber(unassignedPage.total)} unassigned leads found · {selectedLeadIds.length} selected</span>
              <div>
                <button className="secondary-button" type="button" onClick={() => setSelectedLeadIds(unassignedPage.leads.map((lead) => lead.id))} disabled={unassignedPage.leads.length === 0}>Select page</button>
                <button className="primary-button" type="button" onClick={() => void assignSelected()} disabled={assigning || !assignmentScout || selectedLeadIds.length === 0}>{assigning ? <RefreshCw size={14} className="spin" /> : <UserCheck size={14} />}{assigning ? "Assigning…" : `Assign ${selectedLeadIds.length || "selected"}`}</button>
              </div>
            </div>
            <div className="manual-leads-table-scroll">
              <table className="manual-leads-table">
                <thead><tr><th aria-label="Select" /><th>Lead</th><th>Company</th><th>Profile</th></tr></thead>
                <tbody>{unassignedPage.leads.map((lead) => <tr key={lead.id} className={selectedLeadIds.includes(lead.id) ? "selected" : ""} onClick={() => toggleLead(lead.id)}><td><input type="checkbox" checked={selectedLeadIds.includes(lead.id)} onChange={() => toggleLead(lead.id)} onClick={(event) => event.stopPropagation()} aria-label={`Select ${lead.fullName || "lead"}`} /></td><td><strong>{lead.fullName || "Unnamed lead"}</strong><span>{lead.currentTitle || "No title"}</span></td><td>{lead.companyName || "—"}</td><td><a href={lead.profileUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Open <ExternalLink size={11} /></a></td></tr>)}</tbody>
              </table>
            </div>
            {unassignedPage.leads.length === 0 && <div className="assigned-leads-state">No unassigned leads match this niche and search.</div>}
            {unassignedPage.pageCount > 1 && <div className="pagination"><p>Page {unassignedPage.page} of {unassignedPage.pageCount}</p><div><button onClick={() => setUnassignedPageNumber((page) => Math.max(1, page - 1))} disabled={unassignedPage.page === 1}><ArrowLeft size={15} /> Previous</button><button onClick={() => setUnassignedPageNumber((page) => Math.min(unassignedPage.pageCount, page + 1))} disabled={unassignedPage.page === unassignedPage.pageCount}>Next <ArrowRight size={15} /></button></div></div>}
          </>
        )}
        </>}
      </section>
      </>}

      {section === "directory" && <>
      <section className={`panel scout-panel scout-directory-panel ${directoryOpen ? "is-open" : "is-collapsed"}`}>
        <div className="scout-panel-head">
          <div className="scout-directory-title"><PanelHeading eyebrow="Scout directory" title="Accounts and performance" description="Open a scout to review their full assigned queue" icon={<Users size={18} />} /><button className="scout-directory-toggle" type="button" onClick={() => setDirectoryOpen((open) => !open)} aria-expanded={directoryOpen}><ChevronDown size={16} className={directoryOpen ? "rotate-180" : ""} />{directoryOpen ? "Collapse" : "Expand"}</button></div>
          {directoryOpen && <div className="scout-controls"><label className="search-field compact"><Search size={16} /><input value={scoutSearch} onChange={(event) => setScoutSearch(event.target.value)} placeholder="Find a scout" />{scoutSearch && <button onClick={() => setScoutSearch("")} aria-label="Clear scout search"><X size={14} /></button>}</label><select value={scoutSort} onChange={(event) => setScoutSort(event.target.value as ScoutSort)} aria-label="Sort scouts"><option value="activity">Most activity</option><option value="emails">Most emails</option><option value="accepted">Most accepted</option><option value="assigned">Most assigned</option><option value="name">Name</option></select></div>}
        </div>
        {directoryOpen && <><ScoutTable scouts={scouts} selectedScout={selectedScout} setSelectedScout={setSelectedScout} onToggleActive={(scout) => void toggleScout(scout)} togglingScoutId={scoutToggleBusyId} onAssignedLeadChanged={onAssignedLeadChanged} />{activeScout && <ScoutDetail scout={activeScout} activity={scoutActivity} assignedLeads={scoutAssignedLeads} assignedLeadsLoading={scoutAssignedLeadsLoading} assignedLeadsError={scoutAssignedLeadsError} onAssignedLeadsPageChange={onScoutAssignedLeadsPageChange} onAssignedLeadChanged={onAssignedLeadChanged} close={() => setSelectedScout(null)} />}</>}
      </section>
      </>}
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
  scoutAssignedLeads,
  scoutAssignedLeadsLoading,
  scoutAssignedLeadsError,
  onScoutAssignedLeadsPageChange,
  onAssignedLeadChanged,
  section,
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
  scoutAssignedLeads: ScoutAssignedLeadsPage | null;
  scoutAssignedLeadsLoading: boolean;
  scoutAssignedLeadsError: string;
  onScoutAssignedLeadsPageChange: (page: number) => void;
  onAssignedLeadChanged: () => Promise<void>;
  section: OverviewSection;
}) {
  const [scoutPage, setScoutPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [postActivityPage, setPostActivityPage] = useState(1);
  const scoutSnapshotRef = useRef<HTMLDivElement | null>(null);

  const scoutPageCount = Math.max(1, Math.ceil(scouts.length / SCOUT_PAGE_SIZE));
  const visibleScoutPage = Math.min(scoutPage, scoutPageCount);
  const scoutPageStart = (visibleScoutPage - 1) * SCOUT_PAGE_SIZE;
  const visibleScouts = scouts.slice(scoutPageStart, scoutPageStart + SCOUT_PAGE_SIZE);
  const activityPageCount = Math.max(1, Math.ceil(scoutActivity.length / ACTIVITY_PAGE_SIZE));
  const visibleActivityPage = Math.min(activityPage, activityPageCount);
  const activityPageStart = (visibleActivityPage - 1) * ACTIVITY_PAGE_SIZE;
  const postActivityPageCount = Math.max(1, Math.ceil(scoutPosts.length / POST_ACTIVITY_PAGE_SIZE));
  const visiblePostActivityPage = Math.min(postActivityPage, postActivityPageCount);
  const postActivityPageStart = (visiblePostActivityPage - 1) * POST_ACTIVITY_PAGE_SIZE;

  useEffect(() => {
    setScoutPage(1);
  }, [scoutSearch, scoutSort]);

  useEffect(() => {
    setActivityPage(1);
    setPostActivityPage(1);
  }, [selectedScout, analytics?.range]);

  useEffect(() => {
    if (scoutPage <= scoutPageCount) return;
    setScoutPage(scoutPageCount);
  }, [scoutPage, scoutPageCount]);

  useEffect(() => {
    if (activityPage <= activityPageCount) return;
    setActivityPage(activityPageCount);
  }, [activityPage, activityPageCount]);

  useEffect(() => {
    if (postActivityPage <= postActivityPageCount) return;
    setPostActivityPage(postActivityPageCount);
  }, [postActivityPage, postActivityPageCount]);

  useEffect(() => {
    if (!selectedScout || section !== "scouts") return;
    const frame = window.requestAnimationFrame(() => {
      scoutSnapshotRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [section, selectedScout]);

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

      {section === "summary" && <>
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
          label="Original emails"
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
      </>}

      {section === "trends" && <>
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
            description="From engaged profile to captured LinkedIn account email"
            icon={<BarChart3 size={18} />}
          />
          <Funnel summary={summary} />
        </article>
      </section>
      <section className="panel daily-email-panel">
        <DailyEmailReport
          rows={analytics.dailyScoutEmails}
          scouts={analytics.scouts}
          range={analytics.range}
        />
      </section>
      </>}

      {section === "scouts" && <>
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
        <ScoutTable scouts={visibleScouts} selectedScout={selectedScout} setSelectedScout={setSelectedScout} />
        {scouts.length > 0 && (
          <div className="pagination scout-pagination" aria-label="Scout pagination">
            <p>
              Showing {scoutPageStart + 1}–{Math.min(scoutPageStart + SCOUT_PAGE_SIZE, scouts.length)} of {scouts.length} scouts · Page {visibleScoutPage} of {scoutPageCount} · 5 per page
            </p>
            <div>
              <button
                onClick={() => setScoutPage((page) => Math.max(1, page - 1))}
                disabled={visibleScoutPage === 1}
                aria-label="Previous scout page"
              >
                <ArrowLeft size={16} /> Previous
              </button>
              <button
                onClick={() => setScoutPage((page) => Math.min(scoutPageCount, page + 1))}
                disabled={visibleScoutPage === scoutPageCount}
                aria-label="Next scout page"
              >
                Next <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}
        {activeScout && (
          <div className="scout-snapshot-anchor" ref={scoutSnapshotRef}>
            <ScoutDetail
              scout={activeScout}
              activity={scoutActivity}
              assignedLeads={scoutAssignedLeads}
              assignedLeadsLoading={scoutAssignedLeadsLoading}
              assignedLeadsError={scoutAssignedLeadsError}
              onAssignedLeadsPageChange={onScoutAssignedLeadsPageChange}
              onAssignedLeadChanged={onAssignedLeadChanged}
              close={() => setSelectedScout(null)}
            />
          </div>
        )}
        {analytics.scoutsTruncated && <p className="table-note">Only the first 500 scout accounts are included.</p>}
      </section>
      </>}

      {section === "activity" && <>
      <section className="activity-inventory-grid">
        <article className="panel activity-panel">
          <PanelHeading
            eyebrow="Live history"
            title={selectedScout ? `${activeScout?.username ?? selectedScout} activity` : "Recent team activity"}
            description="Latest recorded lead milestones"
            icon={<Activity size={18} />}
          />
          <ActivityFeed items={scoutActivity.slice(activityPageStart, activityPageStart + ACTIVITY_PAGE_SIZE)} />
          {scoutActivity.length > ACTIVITY_PAGE_SIZE && (
            <div className="pagination history-pagination" aria-label="Recent team activity pagination">
              <p>
                Showing {activityPageStart + 1}–{Math.min(activityPageStart + ACTIVITY_PAGE_SIZE, scoutActivity.length)} of {scoutActivity.length} activities · Page {visibleActivityPage} of {activityPageCount}
              </p>
              <div>
                <button
                  onClick={() => setActivityPage((page) => Math.max(1, page - 1))}
                  disabled={visibleActivityPage === 1}
                  aria-label="Previous activity page"
                >
                  <ArrowLeft size={16} /> Previous
                </button>
                <button
                  onClick={() => setActivityPage((page) => Math.min(activityPageCount, page + 1))}
                  disabled={visibleActivityPage === activityPageCount}
                  aria-label="Next activity page"
                >
                  Next <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}
          <div className="post-history-heading">
            <strong>Saved LinkedIn posts & comments</strong>
            <span>{scoutPosts.length} total in this period</span>
          </div>
          <PostActivityFeed items={scoutPosts.slice(postActivityPageStart, postActivityPageStart + POST_ACTIVITY_PAGE_SIZE)} />
          {scoutPosts.length > POST_ACTIVITY_PAGE_SIZE && (
            <div className="pagination history-pagination" aria-label="Saved LinkedIn posts pagination">
              <p>
                Showing {postActivityPageStart + 1}–{Math.min(postActivityPageStart + POST_ACTIVITY_PAGE_SIZE, scoutPosts.length)} of {scoutPosts.length} posts · Page {visiblePostActivityPage} of {postActivityPageCount}
              </p>
              <div>
                <button
                  onClick={() => setPostActivityPage((page) => Math.max(1, page - 1))}
                  disabled={visiblePostActivityPage === 1}
                  aria-label="Previous saved posts page"
                >
                  <ArrowLeft size={16} /> Previous
                </button>
                <button
                  onClick={() => setPostActivityPage((page) => Math.min(postActivityPageCount, page + 1))}
                  disabled={visiblePostActivityPage === postActivityPageCount}
                  aria-label="Next saved posts page"
                >
                  Next <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}
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
      </>}
    </div>
  );
}

function OperationsCenter({
  operations,
  loading,
  error,
  notice,
  busy,
  refresh,
  download,
  sendToCrm,
  closeEscalation,
  section,
}: {
  operations: Operations | null;
  loading: boolean;
  error: string;
  notice: string;
  busy: boolean;
  refresh: () => Promise<void>;
  download: () => Promise<void>;
  sendToCrm: () => Promise<void>;
  closeEscalation: (id: string) => Promise<void>;
  section: OperationsSection;
}) {
  if (!operations && loading) {
    return <div className="overview-loading"><RefreshCw size={22} className="spin" /> Loading today’s work…</div>;
  }
  if (!operations) return <Notice message={error || "Daily work could not be loaded."} onRetry={refresh} />;
  const summary = operations.summary;
  const waitingForCrm = summary.crmPending + summary.crmFailed;

  return (
    <div className={`operations-stack ${loading ? "is-refreshing" : ""}`}>
      <div className="operations-toolbar">
        <div>
          <p className="eyebrow">Team work</p>
          <h2>Things that need attention</h2>
          <span>Simple checks for scouts and managers.</span>
        </div>
        <div>
          <button className="secondary-button" onClick={() => void refresh()} disabled={busy || loading}>
            <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button className="secondary-button" onClick={() => void download()} disabled={busy}>
            <Download size={15} /> Download clean CSV
          </button>
          <button className="primary-button" onClick={() => void sendToCrm()} disabled={busy || waitingForCrm === 0}>
            <Send size={15} /> Send waiting CRM rows
          </button>
        </div>
      </div>
      {error && <Notice message={error} onRetry={refresh} />}
      {notice && <p className="operations-notice"><CheckCircle2 size={15} /> {notice}</p>}

      {section === "summary" && <section className="operations-summary" aria-label="Work needing attention">
        <article><Clock3 size={18} /><span>Follow-ups due</span><strong>{formatNumber(summary.followupsDue)}</strong><small>{summary.followupsPending} still open</small></article>
        <article><Target size={18} /><span>Old requests</span><strong>{formatNumber(summary.oldRequests)}</strong><small>30 days or older</small></article>
        <article><CheckCircle2 size={18} /><span>Checklist</span><strong>{summary.checklistDone} / {summary.checklistTotal}</strong><small>Finished today</small></article>
        <article><Users size={18} /><span>Leads to check</span><strong>{formatNumber(summary.leadsToCheck)}</strong><small>Role and recent post</small></article>
        <article><Mail size={18} /><span>CRM waiting</span><strong>{formatNumber(waitingForCrm)}</strong><small>{summary.crmSent} already sent</small></article>
        <article><ShieldCheck size={18} /><span>Scout questions</span><strong>{formatNumber(summary.openEscalations)}</strong><small>Waiting for the team</small></article>
      </section>}

      {section !== "summary" && <section className="operations-grid">
        {section === "questions" && <>
        <article className="panel operations-panel">
          <PanelHeading eyebrow="Scout questions" title="Needs an answer" description="Questions scouts sent from the extension" icon={<Users size={18} />} />
          <div className="operations-list">
            {operations.escalations.length === 0 ? (
              <p className="operations-empty">No open questions.</p>
            ) : operations.escalations.map((item) => (
              <article key={item.id}>
                <div><strong>{item.subject}</strong><span>{item.operatorId} · {formatRelativeTime(item.createdAt)}</span></div>
                <p>{item.message}</p>
                {item.leadName && <small>Lead: {item.leadName}</small>}
                <button className="secondary-button" onClick={() => void closeEscalation(item.id)} disabled={busy}>Mark answered</button>
              </article>
            ))}
          </div>
        </article>
        </>}

        {section === "requests" && <>
        <article className="panel operations-panel">
          <PanelHeading eyebrow="30-day check" title="Old connection requests" description="Scouts withdraw these by hand on LinkedIn" icon={<Clock3 size={18} />} />
          <div className="operations-list compact-rows">
            {operations.oldRequests.length === 0 ? (
              <p className="operations-empty">No old requests.</p>
            ) : operations.oldRequests.map((item) => (
              <article key={`${item.operatorId}-${item.profileUrl}`}>
                <div><strong>{item.leadName || "Unnamed lead"}</strong><span>{item.operatorId} · {item.ageDays} days old</span></div>
                <a href={item.profileUrl} target="_blank" rel="noreferrer">Open profile <ExternalLink size={12} /></a>
              </article>
            ))}
          </div>
        </article>
        </>}

        {section === "crm" && <>
        <article className="panel operations-panel operations-wide">
          <PanelHeading eyebrow="CRM queue" title="Clean lead delivery" description="Only valid emails are queued; bad values never leave the app" icon={<Database size={18} />} />
          <div className="operations-list crm-rows">
            {operations.crmRows.length === 0 ? (
              <p className="operations-empty">No CRM records are waiting.</p>
            ) : operations.crmRows.map((item) => (
              <article key={item.id}>
                <div><strong>{item.leadName || item.email}</strong><span>{item.operatorId} · {item.status === "failed" ? "Needs attention" : "Waiting"}</span></div>
                <p>{item.email}</p>
                {item.lastError && <small>{item.lastError}</small>}
              </article>
            ))}
          </div>
        </article>
        </>}
      </section>
      }
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
        <span className="engaged">Engaged</span><span className="requests">Requests</span><span className="accepted">Accepted</span><span className="emails">Original emails</span>
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
    { label: "Original emails", value: summary.emailsExtracted, tone: "#279c73" },
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
        <div><strong>{formatPercent(summary.emailYield)}</strong><span>Original email yield</span></div>
      </div>
    </div>
  );
}

function ScoutTable({ scouts, selectedScout, setSelectedScout, onToggleActive, togglingScoutId, onAssignedLeadChanged }: { scouts: ScoutMetrics[]; selectedScout: string | null; setSelectedScout: (value: string | null) => void; onToggleActive?: (scout: ScoutMetrics) => void; togglingScoutId?: string | null; onAssignedLeadChanged?: () => Promise<void> }) {
  const bulkUnassignLead = useAction(api.adminScouts.bulkUnassignLeads);
  const [bulkScout, setBulkScout] = useState<ScoutMetrics | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkResult, setBulkResult] = useState<{ requested: number; returnedToPool: number; protectedCount: number } | null>(null);

  async function confirmBulkUnassign() {
    if (!bulkScout || !onAssignedLeadChanged) return;
    setBulkBusy(true);
    setBulkError("");
    try {
      const result = await bulkUnassignLead({ operatorId: bulkScout.operatorId });
      setBulkResult(result);
      await onAssignedLeadChanged();
    } catch (bulkFailure) {
      setBulkError(readError(bulkFailure));
    } finally {
      setBulkBusy(false);
    }
  }

  if (scouts.length === 0) return <div className="empty-state compact-empty"><Users size={23} /><h3>No scouts found</h3><p>Try clearing the scout search.</p></div>;
  return (
    <div className="scout-table-scroll">
      {bulkResult && <p className="bulk-unassign-success"><CheckCircle2 size={14} />{formatNumber(bulkResult.returnedToPool)} untouched lead{bulkResult.returnedToPool === 1 ? "" : "s"} returned to the pool; {formatNumber(bulkResult.protectedCount)} protected lead{bulkResult.protectedCount === 1 ? " stays" : "s stay"} assigned.</p>}
      <table className="scout-table">
        <thead><tr><th>Scout</th><th>Assigned</th><th>Fresh</th><th>Engaged</th><th>Requests</th><th>Pending</th><th>Accepted</th><th>Original emails</th><th>Failed</th><th>Last active</th>{onToggleActive && <th>Access</th>}{onAssignedLeadChanged && <th>Pool</th>}</tr></thead>
        <tbody>
          {scouts.map((scout) => (
            <tr key={scout.operatorId} className={selectedScout === scout.operatorId ? "selected" : ""} onClick={() => setSelectedScout(selectedScout === scout.operatorId ? null : scout.operatorId)}>
              <td><div className="scout-cell"><span>{initials(scout.username)}</span><div><strong>{scout.username}</strong><small className={scout.active ? "status-active" : "status-inactive"}>{scout.active ? "Active" : scout.hasAccount ? "Disabled" : "Unlinked"}</small></div></div></td>
              <td>{formatNumber(scout.assigned)}</td><td>{formatNumber(scout.fresh)}</td><td><strong>{formatNumber(scout.engaged)}</strong></td><td>{formatNumber(scout.requests)}</td><td>{formatNumber(scout.pending)}</td><td>{formatNumber(scout.accepted)}</td><td><span className="email-count"><Mail size={13} />{formatNumber(scout.emails)}</span></td><td><span className={scout.failed ? "failed-count" : ""}>{formatNumber(scout.failed)}</span></td><td><span className="last-active">{scout.lastActive ? formatRelativeTime(scout.lastActive) : "No activity"}</span></td>
              {onToggleActive && <td><button className={`scout-access-toggle ${scout.active ? "is-enabled" : "is-disabled"}`} type="button" disabled={togglingScoutId === scout.operatorId} onClick={(event) => { event.stopPropagation(); onToggleActive(scout); }}>{togglingScoutId === scout.operatorId ? <RefreshCw size={12} className="spin" /> : scout.active ? "Disable" : "Enable"}</button></td>}
              {onAssignedLeadChanged && <td><button className="bulk-unassign-button" type="button" disabled={scout.assigned < 1 || bulkBusy} title="Return every untouched lead to the pool; protected leads stay assigned." onClick={(event) => { event.stopPropagation(); setBulkError(""); setBulkResult(null); setBulkScout(scout); }}>{scout.assigned > 0 ? <><UserMinus size={12} />Return untouched</> : "No leads"}</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {bulkScout && <BulkUnassignModal scout={bulkScout} busy={bulkBusy} error={bulkError} result={bulkResult} close={() => { if (!bulkBusy) { setBulkScout(null); setBulkError(""); } }} confirm={() => void confirmBulkUnassign()} />}
    </div>
  );
}

function DailyEmailReport({ rows, scouts, range }: { rows: DailyScoutEmail[]; scouts: ScoutMetrics[]; range: Range }) {
  const today = dubaiDateKey();
  const days = useMemo(() => dailyReportDays(range, rows, today), [range, rows, today]);
  const [selectedDay, setSelectedDay] = useState(today);

  useEffect(() => {
    if (!days.includes(selectedDay)) setSelectedDay(days.at(-1) ?? today);
  }, [days, selectedDay, today]);

  const totalsByDay = useMemo(() => {
    const totals = new Map<string, { original: number; work: number; total: number }>();
    for (const row of rows) {
      const current = totals.get(row.day) ?? { original: 0, work: 0, total: 0 };
      current.original += row.originalEmails;
      current.work += row.workEmails;
      current.total += row.totalEmails;
      totals.set(row.day, current);
    }
    return totals;
  }, [rows]);
  const selectedTotals = totalsByDay.get(selectedDay) ?? { original: 0, work: 0, total: 0 };
  const selectedByScout = new Map(rows.filter((row) => row.day === selectedDay).map((row) => [row.operatorId, row]));
  const knownScoutIds = new Set(scouts.map((scout) => scout.operatorId));
  const breakdown = [
    ...scouts.map((scout) => selectedByScout.get(scout.operatorId) ?? {
      day: selectedDay,
      operatorId: scout.operatorId,
      username: scout.username,
      originalEmails: 0,
      workEmails: 0,
      totalEmails: 0,
    }),
    ...[...selectedByScout.values()].filter((row) => !knownScoutIds.has(row.operatorId)),
  ].sort((left, right) => right.totalEmails - left.totalEmails || left.username.localeCompare(right.username));

  return (
    <>
      <div className="daily-email-head">
        <PanelHeading
          eyebrow="Collection audit"
          title="Daily email collection"
          description="Dubai day · every scout, with original and work emails separated"
          icon={<Mail size={18} />}
        />
        <label>
          <span>View day</span>
          <select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}>
            {[...days].reverse().map((day) => <option key={day} value={day}>{formatReportDay(day, day === today)}</option>)}
          </select>
        </label>
      </div>

      <div className="daily-email-selection-note"><Activity size={14} /> Showing the selected day only. Use <strong>View day</strong> to switch dates; the full history is not rendered until you choose it.</div>

      <div className="daily-email-summary">
        <div><span>Total collected</span><strong>{formatNumber(selectedTotals.total)}</strong></div>
        <div><span>Original LinkedIn</span><strong>{formatNumber(selectedTotals.original)}</strong></div>
        <div><span>Work emails</span><strong>{formatNumber(selectedTotals.work)}</strong></div>
        <p>{selectedDay === today ? "Today" : formatReportDay(selectedDay, false)} · scouts with zero collections are included below.</p>
      </div>

      <div className="daily-email-table-scroll">
        <table className="daily-email-table">
          <thead><tr><th>Scout</th><th>Original LinkedIn</th><th>Work email</th><th>Total</th></tr></thead>
          <tbody>
            {breakdown.map((row) => (
              <tr key={row.operatorId}>
                <td><div className="daily-email-scout"><span>{initials(row.username)}</span><div><strong>{row.username}</strong><small>{row.operatorId === "unassigned" ? "Not assigned to a scout" : row.operatorId}</small></div></div></td>
                <td>{formatNumber(row.originalEmails)}</td>
                <td>{formatNumber(row.workEmails)}</td>
                <td><span className={row.totalEmails ? "daily-email-total has-email" : "daily-email-total"}><Mail size={12} />{formatNumber(row.totalEmails)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="daily-email-note"><strong>What is counted:</strong> Original means the email saved from LinkedIn contact info by a scout. Work means a Mailmeteor result matched to that scout’s assigned lead. One lead can add two addresses when both are found.</p>
    </>
  );
}

function ScoutDetail({
  scout,
  activity,
  assignedLeads,
  assignedLeadsLoading,
  assignedLeadsError,
  onAssignedLeadsPageChange,
  onAssignedLeadChanged,
  close,
}: {
  scout: ScoutMetrics;
  activity: RecentActivity[];
  assignedLeads: ScoutAssignedLeadsPage | null;
  assignedLeadsLoading: boolean;
  assignedLeadsError: string;
  onAssignedLeadsPageChange: (page: number) => void;
  onAssignedLeadChanged: () => Promise<void>;
  close: () => void;
}) {
  return (
    <div className="scout-detail">
      <div className="scout-detail-head"><div><p className="eyebrow">Scout snapshot</p><h3>{scout.username}</h3><span>{scout.operatorId}</span></div><button onClick={close} aria-label="Close scout detail"><X size={17} /></button></div>
      <div className="scout-detail-grid">
        <div><small>Recorded actions</small><strong>{formatNumber(scout.activityCount)}</strong></div>
        <div><small>Acceptance</small><strong>{formatPercent(scout.acceptanceRate)}</strong></div>
        <div><small>Original email yield</small><strong>{formatPercent(scout.emailYield)}</strong></div>
        <div><small>Skipped</small><strong>{formatNumber(scout.skipped)}</strong></div>
      </div>
      <div className="scout-progress">
        <ProgressBar label="Assigned leads engaged" value={scout.engaged} total={scout.assigned} />
        <ProgressBar label="Accepted leads with email" value={scout.emails} total={scout.accepted} />
      </div>
      <p className="scout-detail-note">{activity.length ? `${activity.length} recent events are available below.` : "No recent events in this period."}</p>
      <AssignedLeadList
        page={assignedLeads}
        loading={assignedLeadsLoading}
        error={assignedLeadsError}
        onPageChange={onAssignedLeadsPageChange}
        operatorId={scout.operatorId}
        scoutName={scout.username}
        onAssignedLeadChanged={onAssignedLeadChanged}
      />
    </div>
  );
}

function AssignedLeadList({
  page,
  loading,
  error,
  onPageChange,
  operatorId,
  scoutName,
  onAssignedLeadChanged,
}: {
  page: ScoutAssignedLeadsPage | null;
  loading: boolean;
  error: string;
  onPageChange: (page: number) => void;
  operatorId: string;
  scoutName: string;
  onAssignedLeadChanged: () => Promise<void>;
}) {
  const unassignLead = useAction(api.adminScouts.unassignLead);
  const [leadToUnassign, setLeadToUnassign] = useState<ScoutAssignedLead | null>(null);
  const [unassigning, setUnassigning] = useState(false);
  const [unassignError, setUnassignError] = useState("");
  const [unassignNotice, setUnassignNotice] = useState("");

  useEffect(() => {
    setLeadToUnassign(null);
    setUnassignError("");
    setUnassignNotice("");
  }, [operatorId]);

  async function confirmUnassign() {
    if (!leadToUnassign || !leadToUnassign.canUnassign) return;
    setUnassigning(true);
    setUnassignError("");
    try {
      const result = await unassignLead({ operatorId, leadId: leadToUnassign.id });
      if (!result.returnedToPool) throw new Error("The lead was not returned to the pool.");
      const leadName = leadToUnassign.fullName || "The lead";
      setLeadToUnassign(null);
      setUnassignNotice(`${leadName} is now available in the unassigned pool.`);
      await onAssignedLeadChanged();
    } catch (unassignFailure) {
      setUnassignError(readError(unassignFailure));
    } finally {
      setUnassigning(false);
    }
  }

  return (
    <section className="assigned-leads-section" aria-label="Assigned leads">
      <div className="assigned-leads-heading">
        <div>
          <p className="eyebrow">Assigned leads</p>
          <strong>Every lead in this scout’s queue</strong>
        </div>
        {page && <span>{formatNumber(page.total)} total · page {page.page} of {page.pageCount}</span>}
      </div>
      {unassignNotice && <p className="assigned-leads-success"><CheckCircle2 size={14} />{unassignNotice}</p>}
      {loading && <div className="assigned-leads-state"><RefreshCw size={16} className="spin" /> Loading assigned leads…</div>}
      {!loading && error && <div className="assigned-leads-state error">{error}</div>}
      {!loading && !error && page && page.leads.length === 0 && <div className="assigned-leads-state">No assigned leads found.</div>}
      {!loading && !error && page && page.leads.length > 0 && (
        <>
          <div className="assigned-leads-table-scroll">
            <table className="assigned-leads-table">
              <thead><tr><th>Lead</th><th>Status</th><th>Email</th><th>Assigned</th><th>Profile</th><th>Pool action</th></tr></thead>
              <tbody>
                {page.leads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <div className="assigned-lead-name">
                        <strong>{lead.fullName || "Unnamed lead"}</strong>
                        <span>{[lead.currentTitle, lead.companyName].filter(Boolean).join(" · ") || "No title or company recorded"}</span>
                      </div>
                    </td>
                    <td><span className={`lead-status status-${lead.status}`}>{leadStatusLabel(lead.status)}</span></td>
                    <td>{lead.originalEmail || lead.workEmail ? <span className="assigned-lead-email"><Mail size={12} /><span>{lead.originalEmail || lead.workEmail}<small>{lead.originalEmail ? "Original email" : "Work email"}</small></span></span> : <span className="muted-value">Not collected</span>}</td>
                    <td><span className="assigned-lead-date">{formatShortDate(lead.assignedAt)}</span></td>
                    <td><a className="activity-link" href={lead.profileUrl} target="_blank" rel="noreferrer">Open <ExternalLink size={11} /></a></td>
                    <td>{lead.canUnassign ? <button className="unassign-lead-button" type="button" onClick={() => { setUnassignError(""); setLeadToUnassign(lead); }}><UserMinus size={12} />Unassign</button> : <span className="protected-lead-label" title={lead.unassignBlockedReason || "This lead has protected work or contact data."}><ShieldCheck size={12} />Protected</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page.pageCount > 1 && (
            <div className="pagination history-pagination assigned-leads-pagination" aria-label="Assigned leads pagination">
              <p>Showing {(page.page - 1) * page.pageSize + 1}–{Math.min(page.page * page.pageSize, page.total)} of {formatNumber(page.total)}</p>
              <div>
                <button onClick={() => onPageChange(Math.max(1, page.page - 1))} disabled={page.page === 1} aria-label="Previous assigned leads page"><ArrowLeft size={15} /> Previous</button>
                <button onClick={() => onPageChange(Math.min(page.pageCount, page.page + 1))} disabled={page.page === page.pageCount} aria-label="Next assigned leads page">Next <ArrowRight size={15} /></button>
              </div>
            </div>
          )}
        </>
      )}
      {leadToUnassign && <UnassignLeadModal lead={leadToUnassign} scoutName={scoutName} busy={unassigning} error={unassignError} close={() => { if (!unassigning) { setLeadToUnassign(null); setUnassignError(""); } }} confirm={() => void confirmUnassign()} />}
    </section>
  );
}

function UnassignLeadModal({ lead, scoutName, busy, error, close, confirm }: {
  lead: ScoutAssignedLead;
  scoutName: string;
  busy: boolean;
  error: string;
  close: () => void;
  confirm: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, close]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <section className="modal unassign-lead-modal" role="dialog" aria-modal="true" aria-labelledby="unassign-lead-title">
        <button className="modal-close" type="button" onClick={close} disabled={busy} aria-label="Close unassign warning"><X size={18} /></button>
        <div className="unassign-warning-icon"><AlertTriangle size={22} /></div>
        <p className="eyebrow">Admin action</p>
        <h2 id="unassign-lead-title">Return this lead to the pool?</h2>
        <p><strong>{lead.fullName || "This lead"}</strong> will be removed from {scoutName}’s queue and become available for assignment to another scout.</p>
        <div className="unassign-process-card">
          <strong>What happens next</strong>
          <ol>
            <li>The current scout assignment is removed.</li>
            <li>The lead stays in the database and keeps its existing niche.</li>
            <li>It appears in the unassigned pool and can be assigned later.</li>
          </ol>
        </div>
        <div className="unassign-safety-note"><ShieldCheck size={18} /><div><strong>Only untouched leads can move</strong><span>The server checks again that there is no original or work email, contact activity, profile work, qualification, note, email search, error, follow-up, or CRM work. If anything was recorded after this modal opened, the action will be refused.</span></div></div>
        <p className="unassign-delete-note">This does not delete the lead or its niche data.</p>
        {error && <p className="unassign-modal-error"><AlertTriangle size={14} />{error}</p>}
        <div className="unassign-modal-actions"><button className="secondary-button" type="button" onClick={close} disabled={busy}>Keep assigned</button><button className="confirm-unassign-button" type="button" onClick={confirm} disabled={busy} autoFocus>{busy ? <RefreshCw size={14} className="spin" /> : <UserMinus size={14} />}{busy ? "Returning to pool…" : "Return to pool"}</button></div>
      </section>
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

function LeadDirectory({ stats, niches, setNiches, search, setSearch, originalEmailFilters, setOriginalEmailFilters, workEmailFilters, setWorkEmailFilters, workEmailValidationFilters, setWorkEmailValidationFilters, onExport, exporting, notice, viewCount, leads, loading, error, onRefresh, currentPage, canGoPrevious, canGoNext, previousPage, nextPage, loadVeblenMatches, directorySection }: {
  stats: Stats | null;
  niches: string[];
  setNiches: (value: string[]) => void;
  search: string;
  setSearch: (value: string) => void;
  originalEmailFilters: EmailAvailability[];
  setOriginalEmailFilters: (value: EmailAvailability[]) => void;
  workEmailFilters: EmailAvailability[];
  setWorkEmailFilters: (value: EmailAvailability[]) => void;
  workEmailValidationFilters: EmailValidation[];
  setWorkEmailValidationFilters: (value: EmailValidation[]) => void;
  onExport: () => Promise<void>;
  exporting: boolean;
  notice: string;
  viewCount: number;
  leads: Lead[];
  loading: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  currentPage: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  previousPage: () => void;
  nextPage: () => void;
  loadVeblenMatches: (args: { search: string | null; page: number; pageSize: number }) => Promise<VeblenMatchesPage>;
  directorySection: DirectorySection;
}) {
  const directoryTitle = niches.length === 0
    ? "All leads"
    : niches.length === 1
      ? niches[0]
      : `${niches.length} niches selected`;

  if (directorySection === "veblen") return <VeblenExclusionsPage load={loadVeblenMatches} />;

  return (
    <section className="workspace">
      <div className="workspace-heading"><div><p className="eyebrow">Lead directory</p><h2>{directoryTitle}</h2><p>{formatNumber(viewCount)} profiles in this view</p></div><div className="workspace-actions"><button className="secondary-button" onClick={() => void onExport()} disabled={loading || exporting}><Download size={16} className={exporting ? "spin" : ""} />{exporting ? "Exporting…" : "Export CSV"}</button><button className="secondary-button" onClick={() => void onRefresh()} disabled={loading || exporting}><RefreshCw size={16} className={loading ? "spin" : ""} />Refresh</button></div></div>
      <div className="filters">
        <label className="search-field"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, company, email, or lead note…" />{search && <button onClick={() => setSearch("")} aria-label="Clear search"><X size={16} /></button>}</label>
        <MultiSelect label="Niches" allLabel="All niches" options={stats?.niches.map((item) => ({ value: item.name, label: item.name, count: item.count })) ?? []} selected={niches} onChange={setNiches} />
        <MultiSelect label="Original email availability" allLabel="All original emails" options={[{ value: "present" as const, label: "Has original email" }, { value: "missing" as const, label: "Missing original email" }]} selected={originalEmailFilters} onChange={setOriginalEmailFilters} allWhenAllSelected />
        <MultiSelect label="Work email availability" allLabel="All work emails" options={[{ value: "present" as const, label: "Has work email" }, { value: "missing" as const, label: "Missing work email" }]} selected={workEmailFilters} onChange={setWorkEmailFilters} allWhenAllSelected />
        <MultiSelect label="Work email validation" allLabel="All validation states" options={[{ value: "validated" as const, label: "Validated" }, { value: "not_validated" as const, label: "Not validated" }]} selected={workEmailValidationFilters} onChange={setWorkEmailValidationFilters} allWhenAllSelected />
      </div>
      {notice && <div className="directory-notice directory-success">{notice}</div>}
      {error ? <div className="directory-notice"><Notice message={error} onRetry={onRefresh} /></div> : <LeadTable leads={leads} loading={loading} />}
      {!error && <div className="pagination"><p>Page {currentPage} · Up to 50 leads per page</p><div><button onClick={previousPage} disabled={!canGoPrevious || loading}><ArrowLeft size={16} /> Previous</button><button onClick={nextPage} disabled={!canGoNext || loading}>Next <ArrowRight size={16} /></button></div></div>}
    </section>
  );
}

function MultiSelect<T extends string>({ label, allLabel, options, selected, onChange, allWhenAllSelected = false }: {
  label: string;
  allLabel: string;
  options: Array<{ value: T; label: string; count?: number }>;
  selected: T[];
  onChange: (value: T[]) => void;
  allWhenAllSelected?: boolean;
}) {
  const selectedLabels = options.filter((option) => selected.includes(option.value)).map((option) => option.label);
  const isAllSelected = selected.length === 0 || (allWhenAllSelected && options.length > 0 && selected.length === options.length);
  const summary = isAllSelected
    ? allLabel
    : selected.length === 1
      ? selectedLabels[0]
      : `${selected.length} selected`;

  const toggle = (value: T) => {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  return (
    <details className="multi-select">
      <summary aria-label={label}><span>{summary}</span><ChevronDown size={16} /></summary>
      <div className="multi-select-menu" role="group" aria-label={label}>
        {options.map((option) => (
          <label className="multi-select-option" key={option.value}>
            <input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />
            <span>{option.label}</span>
            {option.count !== undefined && <small>{formatNumber(option.count)}</small>}
          </label>
        ))}
        {selected.length > 0 && <button className="multi-select-clear" type="button" onClick={() => onChange([])}>Clear selection</button>}
      </div>
    </details>
  );
}

function LeadTable({ leads, loading }: { leads: Lead[]; loading: boolean }) {
  if (loading) return <div className="table-loading"><RefreshCw className="spin" size={22} />Loading leads from CockroachDB…</div>;
  if (leads.length === 0) return <div className="empty-state"><Search size={24} /><h3>No leads found</h3><p>Try another niche or a broader search phrase.</p></div>;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Lead</th><th>Company</th><th>Original email</th><th>Work email</th><th>Lead note</th><th>Location</th><th>Industry</th><th>Size</th><th><span className="sr-only">Profile</span></th></tr></thead>
        <tbody>{leads.map((lead) => (
          <tr key={lead.id}>
            <td><div className="lead-cell"><span className="avatar">{initials(lead.fullName)}</span><div><strong>{lead.fullName || "Unnamed lead"}</strong><span>{lead.currentTitle || "Title unavailable"}</span></div></div></td>
            <td><strong className="company-name">{lead.companyName || "—"}</strong><span className="subtle">{lead.domain || lead.companySize || ""}</span></td>
            <td><span className="lead-email">{lead.originalEmail || (lead.originalEmailStatus === "not_found" ? "No email available" : "—")}</span><span className="subtle">{originalEmailMeta(lead)}</span></td>
            <td><span className="lead-email">{lead.workEmail || "—"}</span><span className="subtle">{lead.workEmail ? lead.workEmailValidation || "Not validated" : lead.workEmailStatus.replaceAll("_", " ")}</span></td>
            <td><span className="lead-note-cell">{lead.leadNote || "—"}</span>{lead.leadNoteUpdatedAt && <span className="subtle">Updated {formatRelativeTime(lead.leadNoteUpdatedAt)}</span>}</td>
            <td><span className="location"><MapPin size={14} />{lead.geographicRegion || lead.companyLocation || "—"}</span></td>
            <td><span className="industry-pill">{lead.companyIndustry || "Uncategorized"}</span></td>
            <td>{lead.employeeCount ? formatNumber(lead.employeeCount) : lead.companySize || "—"}</td>
            <td>{lead.linkedinUrl ? <a className="profile-link" href={lead.linkedinUrl} target="_blank" rel="noreferrer" title="Open LinkedIn profile"><ExternalLink size={16} /></a> : "—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function BulkUnassignModal({ scout, busy, error, result, close, confirm }: { scout: ScoutMetrics; busy: boolean; error: string; result: { requested: number; returnedToPool: number; protectedCount: number } | null; close: () => void; confirm: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, close]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <section className="modal bulk-unassign-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-unassign-title">
        <button className="modal-close" type="button" onClick={close} disabled={busy} aria-label="Close bulk unassign warning"><X size={18} /></button>
        <div className="unassign-warning-icon"><AlertTriangle size={22} /></div>
        <p className="eyebrow">Bulk admin action</p>
        <h2 id="bulk-unassign-title">Return untouched leads for {scout.username}?</h2>
        {!result ? <>
          <p>The dashboard will review all <strong>{formatNumber(scout.assigned)} assigned leads</strong> for this scout and return only leads that have not been worked on.</p>
          <div className="unassign-process-card"><strong>Protected automatically</strong><ol><li>Leads with an original or work email stay assigned.</li><li>Leads with contact, profile, engagement, qualification, note, email-search, follow-up, CRM, or error history stay assigned.</li><li>Only untouched leads are removed from this scout and added back to the pool.</li></ol></div>
          <div className="unassign-safety-note"><ShieldCheck size={18} /><div><strong>Safe to run for the whole queue</strong><span>This check runs again inside one transaction. If anything changes before confirmation, that lead is protected and skipped.</span></div></div>
          <p className="unassign-delete-note">No lead or niche data is deleted. The result will show how many returned and how many stayed protected.</p>
          {error && <p className="unassign-modal-error"><AlertTriangle size={14} />{error}</p>}
          <div className="unassign-modal-actions"><button className="secondary-button" type="button" onClick={close} disabled={busy}>Cancel</button><button className="confirm-unassign-button" type="button" onClick={confirm} disabled={busy} autoFocus>{busy ? <RefreshCw size={14} className="spin" /> : <UserMinus size={14} />}{busy ? "Returning untouched leads…" : "Return untouched leads"}</button></div>
        </> : <>
          <p>The bulk action is complete. Protected leads remain assigned to {scout.username}.</p>
          <div className="bulk-unassign-result"><div><strong>{formatNumber(result.returnedToPool)}</strong><span>returned to pool</span></div><div><strong>{formatNumber(result.protectedCount)}</strong><span>protected and kept</span></div></div>
          <div className="unassign-modal-actions"><button className="primary-button" type="button" onClick={close}>Done</button></div>
        </>}
      </section>
    </div>
  );
}

function originalEmailMeta(lead: Lead) {
  if (lead.originalEmail) return "LinkedIn account";
  if (lead.originalEmailStatus === "not_found") {
    return lead.originalEmailCheckedAt
      ? `Checked ${formatRelativeTime(lead.originalEmailCheckedAt)}`
      : "Checked on LinkedIn";
  }
  return "Not checked";
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

function UploadLeadsModal({ close, upload, confirm, onAssigned }: {
  close: () => void;
  upload: (args: { fileName: string; csvText: string }) => Promise<HermesUploadResult>;
  confirm: (args: { leadIds: string[]; scoutIds: string[] }) => Promise<HermesAssignmentResult>;
  onAssigned: () => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<HermesUploadResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedScoutIds, setSelectedScoutIds] = useState<string[]>([]);
  const [assignment, setAssignment] = useState<HermesAssignmentResult | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedScoutSet = useMemo(() => new Set(selectedScoutIds), [selectedScoutIds]);
  const eligibleLeads = useMemo(
    () => result?.leads.filter((lead) => !lead.excludedAsVeblenMember) ?? [],
    [result?.leads],
  );
  const excludedLeadCount = (result?.leads.length ?? 0) - eligibleLeads.length;
  const selectedCount = selectedIds.length;
  const selectedScoutCount = selectedScoutIds.length;
  const selectedScouts = useMemo(
    () => result?.scouts.filter((scout) => selectedScoutSet.has(scout.operatorId)) ?? [],
    [result?.scouts, selectedScoutSet],
  );
  const allocations = useMemo(() => {
    const selectedAllocations = new Map(
      calculateHermesAllocations(selectedIds, selectedScouts)
        .map((scout) => [scout.operatorId, scout.count]),
    );
    return result?.scouts.map((scout) => ({
      ...scout,
      count: selectedAllocations.get(scout.operatorId) ?? 0,
    })) ?? [];
  }, [result?.scouts, selectedIds, selectedScouts]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setAssignment(null);
    setResult(null);
    setSelectedIds([]);
    setSelectedScoutIds([]);
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please choose a .csv file.");
      return;
    }
    if (file.size > 5_000_000) {
      setError("CSV files must be 5 MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const nextResult = await upload({ fileName: file.name, csvText: await file.text() });
      setResult(nextResult);
      setSelectedIds(nextResult.leads.filter((lead) => !lead.excludedAsVeblenMember).map((lead) => lead.id));
      setSelectedScoutIds(nextResult.scouts.map((scout) => scout.operatorId));
    } catch (uploadError) {
      setError(readError(uploadError));
    } finally {
      setUploading(false);
    }
  }

  function toggleLead(leadId: string) {
    if (result?.leads.find((lead) => lead.id === leadId)?.excludedAsVeblenMember) return;
    setSelectedIds((current) => current.includes(leadId)
      ? current.filter((id) => id !== leadId)
      : [...current, leadId]);
  }

  function toggleAll() {
    if (!result) return;
    setSelectedIds(selectedCount === eligibleLeads.length ? [] : eligibleLeads.map((lead) => lead.id));
  }

  function toggleAllScouts() {
    if (!result) return;
    setSelectedScoutIds(selectedScoutCount === result.scouts.length ? [] : result.scouts.map((scout) => scout.operatorId));
  }

  function toggleScout(operatorId: string) {
    setSelectedScoutIds((current) => current.includes(operatorId)
      ? current.filter((id) => id !== operatorId)
      : [...current, operatorId]);
  }

  async function confirmSelection() {
    if (selectedCount === 0) return;
    if (selectedScoutCount === 0) {
      setError("Select at least one scout before confirming the allocation.");
      return;
    }
    setError("");
    setConfirming(true);
    try {
      const nextAssignment = await confirm({ leadIds: selectedIds, scoutIds: selectedScoutIds });
      setAssignment(nextAssignment);
      await onAssigned();
    } catch (confirmError) {
      setError(readError(confirmError));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <div className="modal upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-leads-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={close} aria-label="Close upload leads"><X size={18} /></button>
        <div className="upload-modal-heading">
          <div className="upload-modal-icon"><CloudUpload size={20} /></div>
          <div><p className="eyebrow">Hermes intake</p><h2 id="upload-leads-title">Upload leads</h2></div>
        </div>
        <p className="upload-modal-copy">Drop a CSV to add leads to the <strong>Hermes</strong> niche. Nothing is assigned until you review the selection and confirm the allocation.</p>

        {!result && (
          <>
            <div
              className={`upload-dropzone ${dragging ? "is-dragging" : ""} ${uploading ? "is-uploading" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInput.current?.click();
                }
              }}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
              onDrop={(event) => { event.preventDefault(); setDragging(false); void handleFile(event.dataTransfer.files[0]); }}
            >
              <input ref={fileInput} className="upload-file-input" type="file" accept=".csv,text/csv" onChange={(event) => { void handleFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              <span className="upload-drop-icon">{uploading ? <RefreshCw size={21} className="spin" /> : <CloudUpload size={21} />}</span>
              <strong>{uploading ? "Reading and validating…" : "Drop your Hermes CSV here"}</strong>
              <span>{uploading ? "The file is being mapped to the lead database." : "or click to browse · CSV only · max 5 MB"}</span>
            </div>
            <div className="upload-format-note"><FileCheck2 size={15} /><span>Required: linkedin_url, first_name, last_name, headline, location, date_found. Other columns may be blank.</span></div>
          </>
        )}

        {result && !assignment && (
          <>
            <div className="upload-file-summary"><FileCheck2 size={17} /><div><strong>{fileName}</strong><span>{eligibleLeads.length} eligible Hermes leads · {excludedLeadCount} Veblen member{excludedLeadCount === 1 ? "" : "s"} excluded · {result.totalRows - result.uniqueRows} duplicate rows merged</span></div><button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}>Replace</button></div>
            <input ref={fileInput} className="upload-file-input" type="file" accept=".csv,text/csv" onChange={(event) => { void handleFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            <div className="upload-review-toolbar"><div><strong>Review leads before allocation</strong><span>{selectedCount} of {eligibleLeads.length} eligible selected · {excludedLeadCount} protected</span></div><button type="button" className="secondary-button" onClick={toggleAll} disabled={eligibleLeads.length === 0}>{selectedCount === eligibleLeads.length ? "Uncheck all" : "Check all eligible"}</button></div>
            <div className="upload-lead-list">
              {result.leads.map((lead) => (
                <label className={`upload-lead-row ${selectedSet.has(lead.id) ? "is-selected" : ""} ${lead.excludedAsVeblenMember ? "is-excluded" : ""}`} key={lead.id}>
                  <input type="checkbox" checked={selectedSet.has(lead.id)} onChange={() => toggleLead(lead.id)} disabled={lead.excludedAsVeblenMember} />
                  <span className="upload-lead-check"><Check size={13} /></span>
                  <span className="upload-lead-info"><strong>{lead.firstName} {lead.lastName}{lead.excludedAsVeblenMember && <em>Veblen member · excluded</em>}</strong><small>{lead.headline}</small><small>{lead.location} · Found {lead.dateFound}</small></span>
                  <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Open <ExternalLink size={11} /></a>
                </label>
              ))}
            </div>
            <div className="upload-allocation">
              <div className="upload-review-toolbar allocation-heading">
                <div><strong>Automatic scout allocation</strong><span>Round-robin across {selectedScoutCount} of {result.scouts.length} active scouts</span></div>
                <div className="allocation-heading-actions"><span className="allocation-total">{selectedCount} total</span><button type="button" className="secondary-button" onClick={toggleAllScouts}>{selectedScoutCount === result.scouts.length ? "Uncheck all" : "Check all"}</button></div>
              </div>
              <div className="allocation-grid">
                {allocations.map((scout) => (
                  <label className={`allocation-scout ${selectedScoutSet.has(scout.operatorId) ? "is-selected" : ""}`} key={scout.operatorId}>
                    <span className="allocation-scout-name"><input type="checkbox" checked={selectedScoutSet.has(scout.operatorId)} onChange={() => toggleScout(scout.operatorId)} /><span>{scout.username}</span></span>
                    <input type="number" value={scout.count} disabled readOnly aria-label={`${scout.username} leads to assign`} />
                  </label>
                ))}
              </div>
              {selectedScoutCount === 0 && <p className="allocation-empty-note">Check at least one scout to distribute the selected leads.</p>}
            </div>
          </>
        )}

        {assignment && (
          <div className="upload-assignment-success"><span><Check size={19} /></span><div><strong>{assignment.assignedCount} leads assigned across {assignment.allocations.filter((item) => item.count > 0).length} scouts.</strong><p>{assignment.skippedCount ? `${assignment.skippedCount} lead${assignment.skippedCount === 1 ? " was" : "s were"} skipped because it was already assigned, unavailable, or protected as a Veblen member.` : "The Hermes upload is now ready in the scouts' queues."}</p></div></div>
        )}

        {error && <div className="upload-error"><AlertTriangle size={16} /><span>{error}</span></div>}
        <div className="upload-modal-actions">
          {assignment ? <button type="button" className="primary-button" onClick={close}>Done</button> : <><button type="button" className="secondary-button" onClick={close}>Cancel</button>{result && <button type="button" className="primary-button upload-confirm-button" onClick={() => void confirmSelection()} disabled={confirming || selectedCount === 0 || selectedScoutCount === 0}>{confirming ? <RefreshCw size={15} className="spin" /> : <Check size={15} />}{confirming ? "Assigning…" : `Confirm and assign ${selectedCount} leads`}</button>}</>}
        </div>
      </div>
    </div>
  );
}

function calculateHermesAllocations(leadIds: string[], scouts: HermesUploadScout[]) {
  return scouts.map((scout, index) => ({
    ...scout,
    count: leadIds.reduce((total, _leadId, leadIndex) => total + (leadIndex % scouts.length === index ? 1 : 0), 0),
  }));
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

function leadStatusLabel(status: string) {
  const labels: Record<string, string> = {
    assigned: "Fresh",
    viewed: "Viewed",
    engaged: "Engaged",
    connected: "Connected",
    connection_requested: "Request sent",
    accepted: "Accepted",
    email_collected: "Email collected",
    skipped: "Skipped",
    failed: "Failed",
    withdrawn: "Withdrawn",
  };
  return labels[status] ?? status.replaceAll("_", " ");
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

function dubaiDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dailyReportDays(range: Range, rows: DailyScoutEmail[], today: string) {
  const todayDate = new Date(`${today}T00:00:00Z`);
  const requestedDays = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : null;
  const earliestStoredDay = rows
    .map((row) => row.day)
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today)
    .sort()[0];
  const dayCount = requestedDays ?? Math.max(
    1,
    earliestStoredDay
      ? Math.floor((todayDate.getTime() - new Date(`${earliestStoredDay}T00:00:00Z`).getTime()) / 86_400_000) + 1
      : 1,
  );
  return Array.from({ length: dayCount }, (_value, index) => {
    const date = new Date(todayDate);
    date.setUTCDate(date.getUTCDate() - (dayCount - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

function formatReportDay(value: string, isToday: boolean) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  const formatted = new Intl.DateTimeFormat("en", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(date);
  return isToday ? `Today · ${formatted}` : formatted;
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
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
