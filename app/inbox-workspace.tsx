"use client";
import DismissibleNotice from './dismissible-notice';

import { useEffect, useId, useRef, useState } from "react";
import { useInboxPages, type Item } from "./inbox-pages";
import InboxConversation, { type InboxDraft } from "./inbox-conversation";
import { SectionToggle } from "./dashboard-section";
import styles from "./hubspot-workspace.module.css";

const formatDate = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Date not recorded";

export default function InboxWorkspace({ onUnauthorized, initialThreadId, compact = false, pageHref, endpoint = "/api/hubspot-tools/inbox", label = "Inbox", headingLevel, showCompose = true, showSectionToggle = true, refreshKey = 0 }: { onUnauthorized: () => void; initialThreadId?: string; compact?: boolean; pageHref?: string; endpoint?: string; label?: string; headingLevel?: 2 | 3; showCompose?: boolean; showSectionToggle?: boolean; refreshKey?: number }) {
  const instanceId = useId();
  const [drafts, setDrafts] = useState<Record<string, InboxDraft>>({});
  const [archive, setArchive] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Item | null>(() => initialThreadId && /^[1-9]\d{0,19}$/.test(initialThreadId) ? { id: initialThreadId, title: `Conversation ${initialThreadId}` } : null);
  const threads = useInboxPages({ archive }, onUnauthorized, endpoint);
  const previousRefresh = useRef(refreshKey);
  const reloadThreads = threads.load;
  useEffect(() => {
    if (previousRefresh.current !== refreshKey) { previousRefresh.current = refreshKey; void reloadThreads(true); }
  }, [refreshKey, reloadThreads]);
  const rows = threads.state.items.filter(row => `${row.title} ${row.subtitle} ${row.status}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "name" ? (a.title ?? a.id).localeCompare(b.title ?? b.id, undefined, { numeric: true }) : (sort === "oldest" ? 1 : -1) * ((Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0) - (Date.parse(b.updatedAt ?? b.createdAt ?? "") || 0)));
  const pages = Math.max(1, Math.ceil(rows.length / 40)), currentPage = Math.min(page, pages);
  const controls = (collection: ReturnType<typeof useInboxPages>, noun: string) => <>
    <DismissibleNotice className={styles.notice} role="status">{collection.state.items.length} {noun} loaded{collection.state.complete ? " · All pages loaded" : collection.busy ? " · Loading more…" : " · Incomplete"}</DismissibleNotice>
    {collection.error && <p className={styles.messageError} role="alert">{collection.error}</p>}
    {collection.retryAt > 0 && <DismissibleNotice className={styles.notice}>HubSpot is limiting requests. Continue after {formatDate(new Date(collection.retryAt).toISOString())}.</DismissibleNotice>}
    {collection.busy ? <button className="btn btn-secondary" onClick={collection.pause}>Pause {noun}</button> : !collection.state.complete && (collection.state.pages === 0 || collection.state.continuation) ? <button className="btn btn-secondary" disabled={Boolean(collection.retryAt)} onClick={() => void collection.load(false)}>Continue loading {noun}</button> : !collection.state.complete && <DismissibleNotice className={styles.notice}>No usable continuation is available. Use Refresh to restart this read.</DismissibleNotice>}
  </>;
  const Heading = headingLevel === 3 ? "h3" : headingLevel === 2 || compact ? "h2" : "h1";
  const titleId = endpoint === "/api/email" ? `received-email-${instanceId}` : compact ? "today-inbox-title" : "inbox-title";
  return <section className={`${styles.workspace} ${compact ? styles.compact : ""}`} aria-labelledby={titleId}>
    <div className={styles.heading} data-section-heading><div><div className="section-title-controls"><Heading id={titleId} tabIndex={-1}>{pageHref ? <a className="panel-title-link" href={pageHref}>{label}</a> : label}</Heading><div className="panel-heading-actions">{showCompose && <a className="summary-add" title="New message in HubSpot" aria-label="New message in HubSpot" href="https://app.hubspot.com/live-messages/50894788" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">+</span><span className="sr-only">New message in HubSpot (opens in a new tab)</span></a>}{showSectionToggle && <SectionToggle />}</div></div>{!compact && <p>Read and reply to HubSpot conversations, or close and reopen them here.</p>}</div><div className={styles.headingActions}><a className={styles.nativeLink} href="https://app.hubspot.com/live-messages/50894788" target="_blank" rel="noopener noreferrer">Open in HubSpot<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></svg><span className="sr-only"> (opens in a new tab)</span></a><button className="btn btn-secondary" disabled={threads.busy || Boolean(threads.retryAt)} onClick={() => { setSelected(null); setPage(1); void threads.load(true); }}>Refresh</button></div></div>
    <div className={styles.toolbar}>
      <label>Conversations <select aria-label="Conversation archive filter" value={archive} onChange={event => { setSelected(null); setPage(1); setArchive(event.target.value); }}><option value="all">All, including archived</option><option value="active">Not archived</option><option value="archived">Archived</option></select></label>
      <label className={styles.search}><span className="sr-only">Filter loaded conversations</span><input type="search" value={query} placeholder="Filter loaded conversations" onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      <label>Sort <select aria-label="Sort conversations" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="newest">Newest activity</option><option value="oldest">Oldest activity</option><option value="name">Conversation name</option></select></label>
    </div>
    {controls(threads, "conversations")}
    <div className={styles.inbox}><div className={styles.threadList} aria-label="Conversations">{rows.slice((currentPage - 1) * 40, currentPage * 40).map(row => <button type="button" className={`${styles.thread} ${selected?.id === row.id ? styles.selectedThread : ""}`} key={row.id} onClick={() => setSelected(row)} aria-pressed={selected?.id === row.id}><strong>{row.title ?? `Conversation ${row.id}`}</strong><span>{row.subtitle}</span><small>{row.archived ? "Archived · " : ""}{row.status} · {formatDate(row.updatedAt)}</small></button>)}{!rows.length && !threads.busy && <DismissibleNotice className={styles.notice}>{threads.state.complete ? "No conversations match this view." : "No conversations loaded yet."}</DismissibleNotice>}</div>
      <section className={`${styles.messages} inbox-conversation-page`} aria-label="Conversation messages">{selected ? <InboxConversation endpoint={endpoint} key={selected.id} threadId={selected.id} draft={drafts[selected.id] ?? { text: "" }} onDraftChange={draft => setDrafts(current => ({ ...current, [selected.id]: draft }))} onBack={() => setSelected(null)} onUnauthorized={onUnauthorized} onSent={() => void threads.load(true)} /> : <p className={styles.messageEmpty}>Select a conversation to read and reply to its messages.</p>}</section></div>
    {pages > 1 && <div className={styles.pagination}><span>Page {currentPage} of {pages} · {rows.length} matching conversations</span><div><button className="btn btn-secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="btn btn-secondary" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>}
    <p className={styles.footer}>HubSpot is the source of truth. Completed views refresh every minute while visible and when you return to this window. New conversations are composed in HubSpot; sending here requires an explicit Send reply click.</p>
  </section>;
}
