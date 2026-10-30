"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { emptyInboxPages, walkInboxPages } from "./inbox-pagination.mjs";
import styles from "./hubspot-workspace.module.css";

type Item = { id: string; title?: string; subtitle?: string; status?: string; archived?: boolean; updatedAt?: string; createdAt?: string; text?: string | null; direction?: string; type?: string; truncated?: boolean };
type Pages = { items: Item[]; continuation: string | null; complete: boolean; notice: string; fetchedAt?: string; pages: number };
type Input = { archive: string; threadId?: string };
const formatDate = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Date not recorded";

function useInboxPages(input: Input | null, onUnauthorized: () => void) {
  const [state, setState] = useState<Pages>(emptyInboxPages);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const stateRef = useRef<Pages>(state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { unauthorizedRef.current = onUnauthorized; }, [onUnauthorized]);
  const archive = input?.archive, threadId = input?.threadId;
  const currentScope = archive ? `${archive}:${threadId ?? 'threads'}` : null;
  const load = useCallback(async (reset = false) => {
    if (!archive || retryAt > Date.now()) return;
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    const seed = reset ? emptyInboxPages() : stateRef.current;
    if (reset) { stateRef.current = seed; setState(seed); setLoadedScope(`${archive}:${threadId ?? 'threads'}`); }
    setBusy(true); setError(null);
    try {
      const final = await walkInboxPages({ initial: seed, input: { archive, ...(threadId ? { threadId } : {}) }, signal: controller.signal,
        request: async (body: object, parent: AbortSignal) => {
          const pageController = new AbortController();
          const abort = () => pageController.abort(); parent.addEventListener("abort", abort, { once: true });
          const timeout = window.setTimeout(abort, 30_000);
          try {
            const response = await fetch("/api/hubspot-tools/inbox", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: pageController.signal });
            if (parent.aborted || requestRef.current !== controller) throw new DOMException('Request cancelled', 'AbortError');
            if (response.status === 401) { stateRef.current = emptyInboxPages(); setState(stateRef.current); unauthorizedRef.current(); throw Error("Sign in again to load Inbox."); }
            const result = await response.json();
            if (parent.aborted || requestRef.current !== controller) throw new DOMException('Request cancelled', 'AbortError');
            if (response.status === 429 || result.error?.code === "HUBSPOT_RATE_LIMITED") {
              const seconds = Number(result.retryAfterSeconds ?? response.headers.get("Retry-After"));
              setRetryAt(Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) : 60) * 1000);
            }
            if (!response.ok || result.status !== "available") throw Error(result.error?.message ?? "Inbox could not load the next page. Continue to try again.");
            return result;
          } finally { window.clearTimeout(timeout); parent.removeEventListener("abort", abort); }
        },
        onPage: (page: Pages) => { if (requestRef.current === controller) { stateRef.current = page; setState(page); } },
      });
      if (requestRef.current === controller && !controller.signal.aborted && !final.complete && !final.continuation) setError("HubSpot could not provide the remaining pages. Loaded items are retained; refresh to restart.");
    } catch (failure) {
      if (requestRef.current === controller && !controller.signal.aborted) setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "Loading this page timed out. Continue to try again.");
    } finally { if (requestRef.current === controller) { requestRef.current = null; setBusy(false); } }
  }, [archive, threadId, retryAt]);
  // A new scope starts a new walk; it must never inherit another thread's cursor.
  useEffect(() => {
    requestRef.current?.abort(); requestRef.current = null;
    startTransition(() => { stateRef.current = emptyInboxPages(); setState(stateRef.current); setError(null); setBusy(false); if (archive) void load(true); });
    return () => { requestRef.current?.abort(); requestRef.current = null; };
    // Cooldown changes must not restart a completed or paused walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archive, threadId]);
  useEffect(() => { if (!retryAt) return; const timer = window.setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now())); return () => window.clearTimeout(timer); }, [retryAt]);
  const pause = () => { requestRef.current?.abort(); requestRef.current = null; setBusy(false); };
  return { state: loadedScope === currentScope ? state : emptyInboxPages() as Pages, busy: loadedScope === currentScope && busy, error: loadedScope === currentScope ? error : null, retryAt, load, pause };
}

export default function InboxWorkspace({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [archive, setArchive] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Item | null>(null);
  const threads = useInboxPages({ archive }, onUnauthorized);
  const messages = useInboxPages(selected ? { archive: "all", threadId: selected.id } : null, onUnauthorized);
  const rows = threads.state.items.filter(row => `${row.title} ${row.subtitle} ${row.status}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "name" ? (a.title ?? a.id).localeCompare(b.title ?? b.id, undefined, { numeric: true }) : (sort === "oldest" ? 1 : -1) * ((Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0) - (Date.parse(b.updatedAt ?? b.createdAt ?? "") || 0)));
  const pages = Math.max(1, Math.ceil(rows.length / 40)), currentPage = Math.min(page, pages);
  const controls = (collection: ReturnType<typeof useInboxPages>, noun: string) => <>
    <p className={styles.notice} role="status">{collection.state.items.length} {noun} loaded{collection.state.complete ? " · All pages loaded" : collection.busy ? " · Loading more…" : " · Incomplete"}</p>
    {collection.error && <p className={styles.messageError} role="alert">{collection.error}</p>}
    {collection.retryAt > 0 && <p className={styles.notice}>HubSpot is limiting requests. Continue after {formatDate(new Date(collection.retryAt).toISOString())}.</p>}
    {collection.busy ? <button className="btn btn-secondary" onClick={collection.pause}>Pause {noun}</button> : !collection.state.complete && (collection.state.pages === 0 || collection.state.continuation) ? <button className="btn btn-secondary" disabled={Boolean(collection.retryAt)} onClick={() => void collection.load(false)}>Continue loading {noun}</button> : !collection.state.complete && <p className={styles.notice}>No usable continuation is available. Use Refresh to restart this read.</p>}
  </>;
  return <section className={styles.workspace} aria-labelledby="inbox-title">
    <div className={styles.heading}><div><h1 id="inbox-title" tabIndex={-1}>Inbox</h1><p>HubSpot conversations and their message histories. Messaging stays in HubSpot.</p></div><div className={styles.headingActions}><span className={styles.readOnly}>Read-only</span><a className={styles.nativeLink} href="https://app.hubspot.com/live-messages/50894788" target="_blank" rel="noopener noreferrer">Open in HubSpot ↗</a><button className="btn btn-secondary" disabled={threads.busy || Boolean(threads.retryAt)} onClick={() => { setSelected(null); setPage(1); void threads.load(true); }}>Refresh</button></div></div>
    <div className={styles.toolbar}>
      <label>Conversations <select aria-label="Conversation archive filter" value={archive} onChange={event => { setSelected(null); setPage(1); setArchive(event.target.value); }}><option value="all">All, including archived</option><option value="active">Not archived</option><option value="archived">Archived</option></select></label>
      <label className={styles.search}><span className="sr-only">Filter loaded conversations</span><input type="search" value={query} placeholder="Filter loaded conversations" onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      <label>Sort <select aria-label="Sort conversations" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="newest">Newest activity</option><option value="oldest">Oldest activity</option><option value="name">Conversation name</option></select></label>
    </div>
    {controls(threads, "conversations")}
    <div className={styles.inbox}><div className={styles.threadList} aria-label="Conversations">{rows.slice((currentPage - 1) * 40, currentPage * 40).map(row => <button type="button" className={`${styles.thread} ${selected?.id === row.id ? styles.selectedThread : ""}`} key={row.id} onClick={() => setSelected(row)} aria-pressed={selected?.id === row.id}><strong>{row.title ?? `Conversation ${row.id}`}</strong><span>{row.subtitle}</span><small>{row.archived ? "Archived · " : ""}{row.status} · {formatDate(row.updatedAt)}</small></button>)}{!rows.length && !threads.busy && <p className={styles.notice}>{threads.state.complete ? "No conversations match this view." : "No conversations loaded yet."}</p>}</div>
      <section className={styles.messages} aria-label="Conversation messages">{selected ? <><div className={styles.messageHeader}><h2>{selected.title ?? `Conversation ${selected.id}`}</h2><button className="btn btn-secondary" disabled={messages.busy || Boolean(messages.retryAt)} onClick={() => void messages.load(true)}>Refresh messages</button></div>{controls(messages, "messages")}<ol className={styles.messageList}>{[...messages.state.items].sort((a, b) => (Date.parse(a.createdAt ?? "") || 0) - (Date.parse(b.createdAt ?? "") || 0) || a.id.localeCompare(b.id)).map(message => <li key={message.id}><div><span>{message.direction ?? message.type ?? "Message"}</span><time>{formatDate(message.createdAt)}</time></div><p>{message.text || "No plain-text content. Attachments and rich content are available in HubSpot."}</p>{message.truncated && <small className={styles.notice}>HubSpot supplied shortened content. Open HubSpot for the original.</small>}</li>)}</ol>{messages.state.complete && !messages.state.items.length && <p>No messages in this conversation.</p>}</> : <p className={styles.messageEmpty}>Select a conversation to read its messages.</p>}</section></div>
    {pages > 1 && <div className={styles.pagination}><span>Page {currentPage} of {pages} · {rows.length} matching conversations</span><div><button className="btn btn-secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="btn btn-secondary" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>}
    <p className={styles.footer}>Loads every available page, including archived conversations. New activity may arrive during a load; Refresh starts a new read. No messages are sent or marked as read.</p>
  </section>;
}
