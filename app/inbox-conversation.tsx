"use client";
import { startTransition, useEffect, useRef, useState } from "react";
import { useInboxPages } from "./inbox-workspace";
import styles from "./inbox-conversation.module.css";

export type InboxDraft = { text: string; blocked?: string; pending?: boolean };
type ReplyContext = { contextToken: string; threadId: string; senderLabel: string; recipientLabel: string; channelLabel: string };
const formatDate = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Date not recorded";

export default function InboxConversation({ threadId, draft, onDraftChange, onBack, onUnauthorized, onSent }: { threadId: string; draft: InboxDraft; onDraftChange: (draft: InboxDraft) => void; onBack: () => void; onUnauthorized: () => void; onSent: () => void }) {
  const messages = useInboxPages({ archive: "all", threadId }, onUnauthorized);
  const [context, setContext] = useState<ReplyContext | null>(null);
  const [contextError, setContextError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const sendLock = useRef(false);
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => { unauthorized.current = onUnauthorized; }, [onUnauthorized]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45000);
    startTransition(() => { setContext(null); setContextError(""); });
    void (async () => {
      try {
        const response = await fetch("/api/inbox-reply", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", threadId }), signal: controller.signal });
        if (!active) return;
        if (response.status === 401) { unauthorized.current(); return; }
        const result = await response.json();
        if (!active) return;
        if (!response.ok || result.threadId !== threadId || !result.contextToken) throw new Error(result.error?.message ?? "Reply details could not be loaded.");
        setContext(result);
      } catch (error) { if (active) setContextError(error instanceof Error && error.name !== "AbortError" ? error.message : "Reply details took too long to load. Try again."); }
      finally { window.clearTimeout(timer); }
    })();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [threadId, attempt]);
  const send = async () => {
    if (sendLock.current || sending || draft.pending || draft.blocked || !draft.text.trim() || !context) return;
    sendLock.current = true; onDraftChange({ text: draft.text, pending: true }); setSending(true); setError(""); setNotice("");
    // One explicit Send click is one request. A lost response is never retried automatically.
    try {
      const response = await fetch("/api/inbox-reply", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(65000), body: JSON.stringify({ action: "send", threadId, requestId: crypto.randomUUID(), contextToken: context.contextToken, text: draft.text }) });
      if (response.status === 401) { onDraftChange({ text: draft.text }); unauthorized.current(); return; }
      const result = await response.json();
      if (!response.ok || result.status !== "sent") {
        const message = result.error?.message ?? "Reply could not be sent. Check HubSpot before trying again.";
        if (result.error?.uncertain || result.error?.code === "REPLY_ALREADY_PROCESSED" || !result.error?.code) onDraftChange({ text: draft.text, blocked: message });
        else onDraftChange({ text: draft.text });
        setError(message); return;
      }
      onDraftChange({ text: "" }); setNotice("Reply accepted by HubSpot.");
      setAttempt(value => value + 1); void messages.load(true); onSent();
    } catch {
      const message = "The send outcome is uncertain. Check the conversation in HubSpot before sending again.";
      onDraftChange({ text: draft.text, blocked: message }); setError(message);
    } finally { setSending(false); sendLock.current = false; }
  };
  return <section className={styles.conversation} aria-label={`Conversation ${threadId}`}>
    <div className={styles.heading}><button type="button" className="text-link" disabled={sending || draft.pending} onClick={onBack}>← Conversations</button><a className="text-link" href={`#inbox/thread/${threadId}`}>Open full Inbox</a></div>
    <h3>Conversation {threadId}</h3>
    <div className={styles.messages} role="region" aria-label="Message history" tabIndex={0}>
      {messages.busy && <p role="status">Loading messages…</p>}
      {messages.error && <p role="alert">{messages.error}</p>}
      <ol>{[...messages.state.items].sort((a, b) => (Date.parse(a.createdAt ?? "") || 0) - (Date.parse(b.createdAt ?? "") || 0)).map(message => <li key={message.id}><div><strong>{message.direction ?? message.type ?? "Message"}</strong><time>{formatDate(message.createdAt)}</time></div><p>{message.text || "No plain-text content. Open HubSpot to view attachments."}</p>{message.truncated && <small>Message shortened by HubSpot.</small>}</li>)}</ol>
      {!messages.busy && !messages.error && !messages.state.items.length && <p>No messages loaded.</p>}
    </div>
    <div className={styles.actions}>{messages.busy ? <button type="button" className="text-link" onClick={messages.pause}>Pause loading</button> : !messages.state.complete && <button type="button" className="text-link" disabled={Boolean(messages.retryAt)} onClick={() => void messages.load(false)}>Continue loading messages</button>}<button type="button" className="text-link" disabled={messages.busy} onClick={() => void messages.load(true)}>Refresh messages</button></div>
    <form onSubmit={event => { event.preventDefault(); void send(); }}>
      <h4>Reply</h4>
      {context ? <p className={styles.recipient}>From: {context.senderLabel}<br />To: {context.recipientLabel} · {context.channelLabel}</p> : <p role="status">{contextError || "Loading reply details…"}</p>}
      <button type="button" className="text-link" disabled={sending} onClick={() => setAttempt(value => value + 1)}>Refresh reply details</button>
      <label htmlFor={`inbox-reply-${threadId}`}>Your reply</label><textarea id={`inbox-reply-${threadId}`} value={draft.text} onChange={event => onDraftChange({ text: event.target.value })} maxLength={10000} rows={4} disabled={sending || draft.pending || Boolean(draft.blocked)} placeholder="Write a reply to this conversation…" />
      {(error || draft.blocked) && <p className={styles.error} role="alert">{draft.blocked || error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className={styles.actions}><button type="submit" className="btn btn-primary" disabled={sending || draft.pending || Boolean(draft.blocked) || !context || !draft.text.trim()}>{sending || draft.pending ? "Sending…" : "Send reply"}</button><a className="text-link" href="https://app.hubspot.com/live-messages/50894788" target="_blank" rel="noopener noreferrer">Open in HubSpot ↗</a></div>
    </form>
  </section>;
}
