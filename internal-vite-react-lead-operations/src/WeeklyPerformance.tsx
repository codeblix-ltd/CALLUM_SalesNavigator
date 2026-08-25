import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useAction, useMutation } from "convex/react";
import type { Id } from "../convex/_generated/dataModel";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Image,
  Mail,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trophy,
  UserCheck,
  X,
} from "lucide-react";
import { api } from "../convex/_generated/api";

type ExtraKpi = { label: string; value: number };

type WeeklyScout = {
  rank: number;
  username: string;
  operatorId: string;
  active: boolean;
  workedLeads: number;
  comments: number;
  likes: number;
  requests: number;
  accepted: number;
  trackedEmails: number;
  additionalEmails: number;
  totalEmails: number;
  managerPoints: number;
  extraKpis: ExtraKpi[];
  note: string | null;
  evidenceUrl: string | null;
  evidenceFileName: string | null;
  lastActive: string | null;
  score: number;
};

type WeeklyComment = {
  id: string;
  operatorId: string;
  username: string;
  leadName: string | null;
  commentText: string;
  postUrl: string;
  at: string;
};

type WeeklyBoard = {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  generatedAt: string;
  scoreFormula: string;
  scouts: WeeklyScout[];
  comments: WeeklyComment[];
};

type KpiDraft = { label: string; value: string };

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

export function WeeklyPerformance({ section }: { section: "board" | "comments" }) {
  const getWeeklyPerformance = useAction(api.adminAnalytics.getWeeklyPerformance);
  const generateEvidenceUploadUrl = useMutation(api.weeklyPerformance.generateEvidenceUploadUrl);
  const saveReview = useMutation(api.weeklyPerformance.saveReview);
  const removeEvidence = useMutation(api.weeklyPerformance.removeEvidence);
  const [weekStart, setWeekStart] = useState(currentWeekStart());
  const [board, setBoard] = useState<WeeklyBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commentScout, setCommentScout] = useState("all");
  const [editing, setEditing] = useState<WeeklyScout | null>(null);
  const [additionalEmails, setAdditionalEmails] = useState("0");
  const [managerPoints, setManagerPoints] = useState("0");
  const [extraKpis, setExtraKpis] = useState<KpiDraft[]>([]);
  const [note, setNote] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [scoringOpen, setScoringOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setBoard(await getWeeklyPerformance({ weekStart }));
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }, [getWeeklyPerformance, weekStart]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleComments = useMemo(
    () => board?.comments.filter((comment) => commentScout === "all" || comment.operatorId === commentScout) ?? [],
    [board, commentScout],
  );
  const leaders = board?.scouts.slice(0, 3) ?? [];
  const topScout = leaders[0];

  function moveWeek(days: number) {
    setWeekStart(shiftDate(weekStart, days));
    setCommentScout("all");
  }

  function openEditor(scout: WeeklyScout) {
    setEditing(scout);
    setAdditionalEmails(String(scout.additionalEmails));
    setManagerPoints(String(scout.managerPoints));
    setExtraKpis(scout.extraKpis.map((item) => ({ label: item.label, value: String(item.value) })));
    setNote(scout.note ?? "");
    setEvidenceFile(null);
    setEditorError("");
  }

  function updateEvidenceFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return setEvidenceFile(null);
    if (!file.type.startsWith("image/")) {
      setEditorError("Evidence must be a PNG, JPG, or other image file.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      setEditorError("Evidence images must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }
    setEditorError("");
    setEvidenceFile(file);
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setEditorBusy(true);
    setEditorError("");
    try {
      const parsedEmails = wholeNumber(additionalEmails, 0, 100_000, "Additional emails");
      const parsedPoints = wholeNumber(managerPoints, -100, 100, "Manager points");
      const parsedKpis = extraKpis
        .filter((item) => item.label.trim())
        .map((item) => ({
          label: item.label.trim(),
          value: wholeNumber(item.value, 0, 1_000_000, item.label.trim() || "KPI"),
        }));
      let evidenceStorageId: Id<"_storage"> | undefined;
      if (evidenceFile) {
        const uploadUrl = await generateEvidenceUploadUrl({});
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": evidenceFile.type },
          body: evidenceFile,
        });
        if (!response.ok) throw new Error("The evidence image could not be uploaded.");
        const upload = await response.json() as { storageId: Id<"_storage"> };
        evidenceStorageId = upload.storageId;
      }
      await saveReview({
        weekStart,
        operatorId: editing.operatorId,
        additionalEmails: parsedEmails,
        managerPoints: parsedPoints,
        extraKpis: parsedKpis,
        note: note.trim() || undefined,
        evidenceStorageId,
        evidenceFileName: evidenceFile?.name,
      });
      await refresh();
      setEditing(null);
    } catch (caught) {
      setEditorError(readError(caught));
    } finally {
      setEditorBusy(false);
    }
  }

  async function deleteEvidence() {
    if (!editing?.evidenceUrl) return;
    setEditorBusy(true);
    setEditorError("");
    try {
      await removeEvidence({ weekStart, operatorId: editing.operatorId });
      await refresh();
      setEditing((current) => current ? { ...current, evidenceUrl: null, evidenceFileName: null } : null);
    } catch (caught) {
      setEditorError(readError(caught));
    } finally {
      setEditorBusy(false);
    }
  }

  if (!board && loading) {
    return <div className="overview-loading"><RefreshCw size={22} className="spin" /> Building the weekly board…</div>;
  }

  return (
    <div className="weekly-workspace">
      <section className="weekly-toolbar weekly-live-controls">
        <div className="week-picker">
          <button onClick={() => moveWeek(-7)} aria-label="Previous week"><ChevronLeft size={16} /></button>
          <label>
            Week starting
            <input type="date" value={weekStart} onChange={(event) => setWeekStart(mondayFor(event.target.value))} />
          </label>
          <button onClick={() => moveWeek(7)} aria-label="Next week"><ChevronRight size={16} /></button>
          <button className="secondary-button this-week-button" onClick={() => setWeekStart(currentWeekStart())}>This week</button>
        </div>
        <div>
          <button className="secondary-button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button className="secondary-button" onClick={() => setScoringOpen(true)}>
            <CircleHelp size={15} /> How scoring works
          </button>
        </div>
      </section>

      {error && <div className="weekly-error"><strong>Weekly results could not be loaded.</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {board && (
        <>
          {section === "board" && <section className="weekly-share-card">
            <div className="weekly-share-intro">
              <div>
                <p>Callum Scout · Weekly performance</p>
                <h2>{board.weekLabel}</h2>
                <span>Verified LinkedIn activity plus manager-added results</span>
              </div>
              <div className="weekly-winner">
                <Trophy size={22} />
                <span>{topScout && topScout.score > 0 ? "Top scout" : "Weekly board"}</span>
                <strong>{topScout && topScout.score > 0 ? topScout.username : "Results pending"}</strong>
              </div>
            </div>

            <div className="weekly-podium">
              {leaders.map((scout) => (
                <article key={scout.operatorId} className={`weekly-podium-card rank-${scout.rank}`}>
                  <span className="weekly-rank">#{scout.rank}</span>
                  <div className="weekly-avatar">{initials(scout.username)}</div>
                  <div>
                    <h3>{scout.username}</h3>
                    <p>{scout.score} points</p>
                  </div>
                  <dl>
                    <div><dt>Comments</dt><dd>{scout.comments}</dd></div>
                    <div><dt>Accepted</dt><dd>{scout.accepted}</dd></div>
                    <div><dt>Emails</dt><dd>{scout.totalEmails}</dd></div>
                  </dl>
                  {scout.extraKpis.length > 0 && <p className="weekly-extra-summary">{scout.extraKpis.map((item) => `${item.label}: ${item.value}`).join(" · ")}</p>}
                  {scout.evidenceUrl && <img src={scout.evidenceUrl} alt={`${scout.username} result evidence`} />}
                </article>
              ))}
            </div>

            <div className="weekly-ranking-scroll">
              <table className="weekly-ranking">
                <thead><tr><th>Rank</th><th>Scout</th><th>Worked</th><th>Comments</th><th>Likes</th><th>Requests</th><th>Accepted</th><th>Emails</th><th>Other KPIs</th><th>Score</th><th className="weekly-live-controls">Edit</th></tr></thead>
                <tbody>
                  {board.scouts.map((scout) => (
                    <tr key={scout.operatorId}>
                      <td><span className={`rank-badge rank-${Math.min(scout.rank, 4)}`}>{scout.rank}</span></td>
                      <td><div className="weekly-scout-name"><strong>{scout.username}</strong><small>{scout.active ? "Active" : "Disabled"}</small></div></td>
                      <td>{scout.workedLeads}</td>
                      <td><strong>{scout.comments}</strong></td>
                      <td>{scout.likes}</td>
                      <td>{scout.requests}</td>
                      <td>{scout.accepted}</td>
                      <td><span className="weekly-email-value"><Mail size={12} />{scout.totalEmails}{scout.additionalEmails > 0 && <small>+{scout.additionalEmails} added</small>}</span></td>
                      <td>{scout.extraKpis.length ? <span className="weekly-kpi-list">{scout.extraKpis.map((item) => <small key={`${item.label}-${item.value}`}>{item.label}: <b>{item.value}</b></small>)}</span> : <span className="weekly-muted">None</span>}</td>
                      <td><strong className="weekly-score">{scout.score}</strong></td>
                      <td className="weekly-live-controls"><button className="weekly-edit-button" onClick={() => openEditor(scout)}><Pencil size={12} /> Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="weekly-score-note"><CheckCircle2 size={13} /><span>Score: {board.scoreFormula}. Other KPI counts are included at 1 point each. Manager points should only represent results supported by notes or evidence.</span></div>
          </section>}

          {section === "comments" && <section className="panel weekly-comments-panel weekly-live-controls">
            <div className="weekly-comments-head">
              <div><p>Comment tracking</p><h2>Submitted LinkedIn comments</h2><span>Open the exact post from the dashboard</span></div>
              <select value={commentScout} onChange={(event) => setCommentScout(event.target.value)}>
                <option value="all">All scouts ({board.comments.length})</option>
                {board.scouts.map((scout) => <option key={scout.operatorId} value={scout.operatorId}>{scout.username} ({scout.comments})</option>)}
              </select>
            </div>
            <div className="weekly-comment-list">
              {visibleComments.length === 0 ? <p className="weekly-comments-empty">No submitted comments were recorded for this selection.</p> : visibleComments.map((comment) => (
                <article key={comment.id}>
                  <span className="weekly-comment-icon"><MessageSquareText size={15} /></span>
                  <div><strong>{comment.username} <small>on {comment.leadName || "an unnamed lead"}</small></strong><p>“{comment.commentText}”</p><time dateTime={comment.at}>{formatDateTime(comment.at)}</time></div>
                  <a href={comment.postUrl} target="_blank" rel="noreferrer">Open post <ExternalLink size={11} /></a>
                </article>
              ))}
            </div>
          </section>}
        </>
      )}

      {editing && (
        <div className="modal-backdrop weekly-live-controls" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !editorBusy) setEditing(null); }}>
          <form className="modal weekly-editor" onSubmit={submitReview}>
            <button type="button" className="modal-close" onClick={() => setEditing(null)} disabled={editorBusy} aria-label="Close"><X size={16} /></button>
            <p className="eyebrow">Manager edit · {board?.weekLabel}</p>
            <h2>{editing.username}</h2>
            <p>Add results the extension cannot see. The automatic LinkedIn figures remain read-only.</p>
            <div className="weekly-auto-strip">
              <span><MessageSquareText size={13} /> {editing.comments} comments</span>
              <span><Send size={13} /> {editing.requests} requests</span>
              <span><UserCheck size={13} /> {editing.accepted} accepted</span>
              <span><Mail size={13} /> {editing.trackedEmails} tracked emails</span>
            </div>
            <div className="weekly-editor-grid">
              <label>Additional emails<input type="number" min="0" max="100000" step="1" value={additionalEmails} onChange={(event) => setAdditionalEmails(event.target.value)} /></label>
              <label>Manager points<input type="number" min="-100" max="100" step="1" value={managerPoints} onChange={(event) => setManagerPoints(event.target.value)} /></label>
            </div>
            <div className="weekly-kpi-editor">
              <div><strong>Other KPIs · 1 point per result</strong><button type="button" onClick={() => setExtraKpis((items) => items.length >= 6 ? items : [...items, { label: "", value: "0" }])} disabled={extraKpis.length >= 6}><Plus size={13} /> Add KPI</button></div>
              {extraKpis.length === 0 && <p>No extra KPIs added yet.</p>}
              {extraKpis.map((item, index) => (
                <div className="weekly-kpi-row" key={index}>
                  <input aria-label={`KPI ${index + 1} name`} placeholder="e.g. Replies" value={item.label} maxLength={40} onChange={(event) => setExtraKpis((items) => items.map((current, itemIndex) => itemIndex === index ? { ...current, label: event.target.value } : current))} />
                  <input aria-label={`KPI ${index + 1} value`} type="number" min="0" max="1000000" step="1" value={item.value} onChange={(event) => setExtraKpis((items) => items.map((current, itemIndex) => itemIndex === index ? { ...current, value: event.target.value } : current))} />
                  <button type="button" aria-label={`Remove KPI ${index + 1}`} onClick={() => setExtraKpis((items) => items.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
                </div>
              ))}
            </div>
            <label className="weekly-note-field">Manager note<textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Explain the result or add context for the week." /></label>
            <div className="weekly-evidence-field">
              <strong>Screenshot evidence</strong>
              {editing.evidenceUrl && <div className="weekly-existing-evidence"><img src={editing.evidenceUrl} alt="Existing result evidence" /><div><span>{editing.evidenceFileName || "Saved evidence image"}</span><button type="button" onClick={() => void deleteEvidence()} disabled={editorBusy}>Remove</button></div></div>}
              <label><Image size={17} /><span>{evidenceFile ? evidenceFile.name : editing.evidenceUrl ? "Replace screenshot" : "Choose screenshot"}</span><input type="file" accept="image/*" onChange={updateEvidenceFile} /></label>
              <small>PNG or JPG, up to 5 MB.</small>
            </div>
            {editorError && <p className="weekly-editor-error">{editorError}</p>}
            <div className="weekly-editor-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)} disabled={editorBusy}>Cancel</button><button type="submit" className="primary-button" disabled={editorBusy}>{editorBusy ? <RefreshCw size={15} className="spin" /> : <Save size={15} />}{editorBusy ? "Saving…" : "Save weekly results"}</button></div>
          </form>
        </div>
      )}
      {scoringOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setScoringOpen(false); }}>
          <section className="modal weekly-scoring-modal" role="dialog" aria-modal="true" aria-labelledby="weekly-scoring-title">
            <button type="button" className="modal-close" onClick={() => setScoringOpen(false)} aria-label="Close scoring guide"><X size={16} /></button>
            <p className="eyebrow">Weekly board guide</p>
            <h2 id="weekly-scoring-title">How the KPI score works</h2>
            <p>The ranking is a transparent points summary for this week. LinkedIn activity is read automatically; managers can add results that the extension cannot see.</p>
            <div className="weekly-score-formula"><span>Formula</span><code>comments + likes + (requests × 2) + (accepted × 4) + (emails × 5) + other KPI results + manager points</code></div>
            <div className="weekly-scoring-grid">
              <div><strong>1 point</strong><span>Each comment, like, or counted result in an Other KPI row.</span></div>
              <div><strong>2 points</strong><span>Each connection request recorded in the selected week.</span></div>
              <div><strong>4 points</strong><span>Each accepted connection recorded in the selected week.</span></div>
              <div><strong>5 points</strong><span>Each email, including tracked emails and Additional emails.</span></div>
            </div>
            <div className="weekly-scoring-example"><strong>Example</strong><span>3 comments + 2 likes + 4 requests + 1 acceptance + 2 emails + 3 other results = <b>30 points</b>.</span><small>3 + 2 + 8 + 4 + 10 + 3 = 30</small></div>
            <div className="weekly-scoring-rules">
              <p><strong>What managers can edit</strong></p>
              <ul><li><b>Additional emails:</b> added to the automatic email count and scored at 5 points each.</li><li><b>Other KPIs:</b> enter a label and count; each counted result adds 1 point.</li><li><b>Manager points:</b> an explicit adjustment from −100 to +100. Add a note or screenshot when using it.</li></ul>
            </div>
            <p className="weekly-scoring-footnote">This board is evidence for a weekly review, not a standalone termination decision. Check quality, replies, meetings, and context before acting.</p>
          </section>
        </div>
      )}
    </div>
  );
}

function currentWeekStart(): string {
  const now = new Date();
  return mondayFor(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
}

function mondayFor(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return currentWeekStart();
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function initials(value: string) {
  return value.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "S";
}

function wholeNumber(value: string, min: number, max: number, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function readError(value: unknown) {
  return value instanceof Error ? value.message : String(value || "Unknown error");
}
