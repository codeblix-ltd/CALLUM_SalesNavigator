import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import "./BugReports.css";

type Status = Doc<"bugReports">["status"];
const labels = { open: "Open", investigating: "Investigating", resolved: "Resolved" };
const date = (timestamp: number) => new Date(timestamp).toLocaleString();

export function BugReports() {
  const [filter, setFilter] = useState<Status | "all">("open");
  const [selected, setSelected] = useState<string | null>(null);
  const { results, status, loadMore } = usePaginatedQuery(api.bugReports.list, filter === "all" ? {} : { status: filter }, { initialNumItems: 20 });
  const report = results.find(item => item._id === selected);
  return <section className="bug-inbox">
    <div className="bug-toolbar"><div><h2>Scout bug reports</h2></div>
      <label>Status <select value={filter} onChange={event => { setFilter(event.target.value as Status | "all"); setSelected(null); }}><option value="all">All reports</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <div className="bug-layout"><div className="bug-list">
      {status === "LoadingFirstPage" ? <p>Loading reports…</p> : results.length === 0 ? <p>No {filter === "all" ? "" : filter} reports yet. Scouts can use Report bug in extension v0.10.31 or later.</p> : results.map(item => <button key={item._id} className={selected === item._id ? "selected" : ""} onClick={() => setSelected(item._id)}>
        <span><strong>{item.reporter}</strong><small>{labels[item.status]}</small></span><p>{item.description.slice(0, 160)}</p><small>Received {date(item._creationTime)} · v{item.context.version} · {item.screenshots.length} image(s)</small>
      </button>)}
      {status === "CanLoadMore" && <button onClick={() => loadMore(20)}>Load older reports</button>}
      {status === "LoadingMore" && <p>Loading older reports…</p>}
    </div>{report ? <ReportDetail key={report._id} report={report} /> : <div className="bug-detail bug-empty">Select a report to see screenshots and technical details.</div>}</div>
  </section>;
}

function ReportDetail({ report }: { report: Doc<"bugReports"> }) {
  const images = useQuery(api.bugReports.images, { id: report._id });
  const update = useMutation(api.bugReports.update);
  const reply = useMutation(api.bugReports.reply);
  const [replyText, setReplyText] = useState("");
  const [replyId, setReplyId] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState(report.status);
  const [note, setNote] = useState(report.adminNote);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <article className="bug-detail"><h2>{report.reporter}</h2><dl>
    <dt>Happened</dt><dd>{date(report.occurredAt)} (scout supplied)</dd><dt>Received</dt><dd>{date(report._creationTime)}</dd><dt>Scout timezone</dt><dd>{report.context.timezone || "Not supplied"}</dd>
  </dl><p className="bug-description">{report.description}</p>
    <div className="bug-images">{images === undefined ? <p>Loading screenshots…</p> : images.map((url, index) => url ? <a href={url} key={index} target="_blank" rel="noreferrer"><img src={url} alt={`Scout screenshot ${index + 1}`} /><span>Open screenshot {index + 1}</span></a> : <p key={index}>Screenshot unavailable</p>)}</div>
    <details><summary>Technical details</summary><dl>{Object.entries(report.context).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || "Not available"}</dd></div>)}</dl></details>
    <h3>Conversation</h3>
    {(report.messages ?? []).map(item => <div key={`${item.author}:${item.clientId}`}><strong>{item.author === "support" ? "Callum support" : report.reporter}</strong><small> · {date(item.sentAt)}</small><p className="bug-description">{item.text}</p>{item.screenshots?.length ? <ReplyImages id={report._id} clientId={item.clientId} /> : null}</div>)}
    <form onSubmit={async event => { event.preventDefault(); setBusy(true); try { await reply({ id: report._id, clientId: replyId, text: replyText }); setReplyText(""); setReplyId(crypto.randomUUID()); setMessage("Reply sent."); } catch(error) { setMessage(error instanceof Error ? error.message : "Could not send."); } finally { setBusy(false); } }}>
      <label>Reply to scout<textarea required maxLength={2000} rows={3} disabled={busy} value={replyText} onChange={event => { setReplyText(event.target.value); setReplyId(crypto.randomUUID()); }} placeholder="What changed and what to try next…" /></label><button disabled={busy}>Send reply</button>
    </form>
    <form onSubmit={async event => { event.preventDefault(); setBusy(true); setMessage(""); try { await update({ id: report._id, status, adminNote: note }); setMessage("Saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save. Please retry."); } finally { setBusy(false); } }}>
      <label>Status<select value={status} disabled={busy} onChange={event => setStatus(event.target.value as Status)}>{Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>Internal investigation note<textarea value={note} disabled={busy} maxLength={5000} rows={5} onChange={event => setNote(event.target.value)} placeholder="Findings, fix, release version, and verification…" /></label>
      <button disabled={busy} type="submit">{busy ? "Saving…" : "Save changes"}</button><p role="status">{message}</p>
    </form>
  </article>;
}

function ReplyImages({ id, clientId }: { id: Doc<"bugReports">["_id"]; clientId: string }) {
  const images = useQuery(api.bugReports.messageImages, { id, clientId });
  return <div className="bug-images">{images?.map((url, index) => url ? <a href={url} key={index} target="_blank" rel="noreferrer"><img src={url} alt={`Reply screenshot ${index + 1}`} /><span>Open reply screenshot {index + 1}</span></a> : null)}</div>;
}
