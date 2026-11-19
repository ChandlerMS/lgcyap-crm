"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRecruitEmail } from "./recruit-email";

type Folder = "inbox" | "sent";
type MailSummary = { id: string; threadId: string; from: string; to: string; subject: string; date: string | null; snippet: string; unread: boolean };
type MailMessage = Pick<MailSummary, "id" | "threadId" | "from" | "to" | "subject" | "date"> & { text: string; html: string; canReply: boolean };
const dateLabel = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Date unavailable";
const messageDocument = (html: string) => `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">${html}`;

export default function GmailMailbox({ email, onUnauthorized, refreshKey = 0 }: { email: string; onUnauthorized: () => void; refreshKey?: number }) {
  const { openReply, disabled, sentView, mailboxRefresh } = useRecruitEmail();
  const [folder, setFolder] = useState<Folder>(() => sentView ? "sent" : "inbox");
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<MailSummary[] | null>(null);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [readAttempt, setReadAttempt] = useState(0);
  const listGeneration = useRef(0);
  const readGeneration = useRef(0);
  const lastSentView = useRef(sentView);
  const pageToken = pages[page];
  const resetReader = useCallback(() => { readGeneration.current++; setSelected(""); setMessage(null); setReadError(""); setReading(false); }, []);
  const changeFolder = useCallback((next: Folder) => {
    listGeneration.current++; resetReader(); setFolder(next); setPages([undefined]); setPage(0); setMessages(null); setNextPageToken(null); setListError(""); setAttempt(value => value + 1);
  }, [resetReader]);
  useEffect(() => {
    if (lastSentView.current === sentView) return;
    lastSentView.current = sentView;
    void (async () => { changeFolder("sent"); })();
  }, [sentView, changeFolder]);
  useEffect(() => {
    const current = ++listGeneration.current;
    const controller = new AbortController();
    void (async () => {
      setLoading(true); setMessages(null); setNextPageToken(null); setListError(""); resetReader();
      try {
        const response = await fetch("/api/gmail/mail", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list", folder, ...(pageToken ? { pageToken } : {}) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
        if (controller.signal.aborted || current !== listGeneration.current) return;
        if (response.status === 401) { onUnauthorized(); return; }
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Email could not be loaded. Try refreshing the mailbox.");
        if (!controller.signal.aborted && current === listGeneration.current) { setMessages(data.messages); setNextPageToken(data.nextPageToken || null); }
      } catch (e) { if (!controller.signal.aborted && current === listGeneration.current) setListError(e instanceof Error ? e.message : "Email could not be loaded. Try refreshing the mailbox."); }
      finally { if (!controller.signal.aborted && current === listGeneration.current) setLoading(false); }
    })();
    return () => { controller.abort(); listGeneration.current = current + 1; };
  }, [email, folder, pageToken, refreshKey, mailboxRefresh, attempt, onUnauthorized, resetReader]);
  useEffect(() => {
    if (!selected) return;
    const current = ++readGeneration.current;
    const controller = new AbortController();
    void (async () => {
      setReading(true); setMessage(null); setReadError("");
      try {
        const response = await fetch("/api/gmail/mail", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", messageId: selected }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
        if (controller.signal.aborted || current !== readGeneration.current) return;
        if (response.status === 401) { onUnauthorized(); return; }
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "This email could not be opened. Select it to try again.");
        if (!controller.signal.aborted && current === readGeneration.current) setMessage(data.message);
      } catch (e) { if (!controller.signal.aborted && current === readGeneration.current) setReadError(e instanceof Error ? e.message : "This email could not be opened. Select it to try again."); }
      finally { if (!controller.signal.aborted && current === readGeneration.current) setReading(false); }
    })();
    return () => { controller.abort(); readGeneration.current = current + 1; };
  }, [email, folder, selected, readAttempt, onUnauthorized]);
  const selectMessage = (id: string) => { resetReader(); setSelected(id); setReadAttempt(value => value + 1); };
  const reload = () => { resetReader(); setPage(0); setPages([undefined]); setAttempt(value => value + 1); };
  return <div className="gmail-mailbox" aria-label="Gmail mailbox">
    <div className="gmail-mailbox-toolbar"><div role="group" aria-label="Gmail folders"><button type="button" className={`btn ${folder === "inbox" ? "btn-primary" : "btn-secondary"}`} aria-pressed={folder === "inbox"} onClick={() => changeFolder("inbox")}>Inbox</button><button type="button" className={`btn ${folder === "sent" ? "btn-primary" : "btn-secondary"}`} aria-pressed={folder === "sent"} onClick={() => changeFolder("sent")}>Sent</button></div><button type="button" className="btn btn-secondary" disabled={loading} onClick={reload}>Refresh mailbox</button></div>
    {listError && <p role="alert" className="connection-alert">{listError}</p>}
    {loading && <p role="status">Loading {folder === "inbox" ? "Inbox" : "Sent"}…</p>}
    {messages && <>{messages.length ? <ul className="gmail-message-list" aria-label={folder === "inbox" ? "Inbox messages" : "Sent messages"}>{messages.map(item => <li key={item.id}><button type="button" className={`gmail-message-row${item.unread ? " is-unread" : ""}${selected === item.id ? " is-selected" : ""}`} aria-label={`Read ${item.subject || "(No subject)"}`} aria-pressed={selected === item.id} onClick={() => selectMessage(item.id)}><span className="gmail-message-correspondent">{folder === "inbox" ? item.from : item.to}</span><span className="gmail-message-subject">{item.subject || "(No subject)"}{item.unread && <span className="sr-only"> (unread)</span>}</span><time dateTime={item.date || undefined}>{dateLabel(item.date)}</time><span className="gmail-message-snippet">{item.snippet}</span></button></li>)}</ul> : <p className="helper">No messages in {folder === "inbox" ? "Inbox" : "Sent"}.</p>}<div className="gmail-mailbox-pager"><button type="button" className="btn btn-secondary" disabled={page === 0 || loading} onClick={() => { resetReader(); setMessages(null); setPage(value => value - 1); }}>Newer messages</button><span>Page {page + 1}</span><button type="button" className="btn btn-secondary" disabled={!nextPageToken || loading} onClick={() => { if (!nextPageToken) return; resetReader(); setMessages(null); setPages(current => [...current.slice(0, page + 1), nextPageToken]); setPage(value => value + 1); }}>Older messages</button></div></>}
    {reading && <p role="status">Opening email…</p>}
    {readError && <p role="alert" className="connection-alert">{readError}</p>}
    {message && <article className="gmail-message-reader" aria-label="Email message reader"><div className="gmail-mailbox-toolbar"><h3>{message.subject || "(No subject)"}</h3><button type="button" className="btn btn-quiet" onClick={resetReader}>Close message</button></div><dl><div><dt>From</dt><dd>{message.from}</dd></div><div><dt>To</dt><dd>{message.to}</dd></div><div><dt>Date</dt><dd>{dateLabel(message.date)}</dd></div></dl>{message.canReply && <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => openReply(message.id)}>Reply</button>}{message.html ? <><p className="helper">Remote images are blocked for privacy.</p><iframe title="Email message" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={messageDocument(message.html)} /></> : <pre className="gmail-message-text">{message.text || "This message has no readable text."}</pre>}</article>}
  </div>;
}
