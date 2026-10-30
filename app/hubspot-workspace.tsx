"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import HubSpotRecordEditor, { type HubspotEditField } from "./hubspot-record-editor";
import { hubspotRecordSnapshotAvailable } from "./hubspot-record-edit.mjs";
import { currentHubspotMonth, filterHubspotRows, hubspotDateKey, hubspotMonthDays, hubspotRetryDeadline, hubspotSearchResponseMatches, normalizeHubspotSearchQuery, safeHubspotViewLink, shiftHubspotMonth, sortHubspotRows } from "./hubspot-workspace-view.mjs";
import styles from "./hubspot-workspace.module.css";

type ToolRecord = {
  id: string; title: string; subtitle?: string | null; status?: string | null; owner?: string | null; ownerId?: string | null;
  createdAt?: string | null; updatedAt?: string | null; scheduledAt?: string | null; endedAt?: string | null;
  phone?: string | null; email?: string | null; company?: string | null; health?: string | null;
  preview?: string | null; hubspotUrl: string; editValues?: Record<string, string>;
};
type ToolMessage = { id: string; text: string | null; createdAt: string | null; direction: string | null; type: string | null; truncated?: boolean };
type ToolResult = {
  tool: string; label: string; status: "available" | "permission-required" | "unavailable";
  records: ToolRecord[]; total: number | null; loadedCount: number; partial: boolean;
  fetchedAt: string; hubspotUrl: string; requiredScopes: string[]; notice?: string;
  error?: { code: string; message: string }; messages?: ToolMessage[]; selectedThreadId?: string; retryAfterSeconds?: number; query?: string | null;
  selectedRecordId?: string; fields?: HubspotEditField[]; capabilities?: { canEdit: boolean };
};
type ReadFailure = { message: string; retryAt?: number };
type Props = { tool: string; onUnauthorized: () => void; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void };
type Column = { field: keyof ToolRecord; label: string; date?: boolean; dateOnly?: boolean };
type Definition = { label: string; description: string; singular: string; columns: Column[] };
const DEFINITIONS: Record<string, Definition> = {
  "customer-success": { label: "Customer Success", description: "Customer companies and CSM sentiment recorded in HubSpot.", singular: "customer", columns: [{ field: "title", label: "Company" }, { field: "health", label: "CSM sentiment" }, { field: "owner", label: "Owner" }, { field: "scheduledAt", label: "Renewal date", dateOnly: true }, { field: "updatedAt", label: "Updated", date: true }] },
  inbox: { label: "Inbox", description: "Read your HubSpot conversations and their messages.", singular: "conversation", columns: [] },
  tickets: { label: "Tickets", description: "Tickets from your HubSpot account.", singular: "ticket", columns: [{ field: "title", label: "Ticket" }, { field: "status", label: "Stage" }, { field: "owner", label: "Owner" }, { field: "createdAt", label: "Created", date: true }, { field: "updatedAt", label: "Updated", date: true }] },
  calls: { label: "Calls", description: "Call activities logged in HubSpot.", singular: "call", columns: [{ field: "title", label: "Call" }, { field: "phone", label: "Phone" }, { field: "status", label: "Status" }, { field: "owner", label: "Owner" }, { field: "scheduledAt", label: "Call date", date: true }] },
  contacts: { label: "Contacts", description: "Contacts from your HubSpot account.", singular: "contact", columns: [{ field: "title", label: "Contact" }, { field: "email", label: "Email" }, { field: "phone", label: "Phone" }, { field: "company", label: "Company" }, { field: "status", label: "Lifecycle stage" }, { field: "owner", label: "Owner" }] },
  tasks: { label: "Tasks", description: "Tasks and due dates recorded in HubSpot.", singular: "task", columns: [{ field: "title", label: "Task" }, { field: "status", label: "Status" }, { field: "scheduledAt", label: "Due", date: true }, { field: "owner", label: "Owner" }, { field: "updatedAt", label: "Updated", date: true }] },
  calendar: { label: "Calendar", description: "Scheduled meetings recorded in HubSpot. All times are Eastern.", singular: "meeting", columns: [{ field: "title", label: "Meeting" }, { field: "scheduledAt", label: "Starts", date: true }, { field: "endedAt", label: "Ends", date: true }, { field: "status", label: "Outcome" }, { field: "owner", label: "Owner" }] },
  meetings: { label: "Meetings", description: "Meeting activities recorded in HubSpot.", singular: "meeting", columns: [{ field: "title", label: "Meeting" }, { field: "scheduledAt", label: "Starts", date: true }, { field: "endedAt", label: "Ends", date: true }, { field: "status", label: "Outcome" }, { field: "owner", label: "Owner" }] },
};
const PAGE_SIZE = 40;
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const CALENDAR_DATE_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

function dateLabel(value: unknown, timeOnly = false) {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? (timeOnly ? TIME_FORMAT : DATE_FORMAT).format(timestamp) : "Not recorded";
}
function textLabel(value: unknown) { return typeof value === "string" && value.trim() ? value : "Not recorded"; }
function calendarDateLabel(value: unknown) { const date = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(date) ? CALENDAR_DATE_FORMAT.format(date) : "Not recorded"; }
function ExternalIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></svg>; }
function NativeLink({ href, label = "Open in HubSpot" }: { href: unknown; label?: string }) {
  const safe = safeHubspotViewLink(href);
  return safe ? <a className={styles.nativeLink} href={safe} target="_blank" rel="noopener noreferrer">{label}<ExternalIcon /><span className="sr-only"> (opens in a new tab)</span></a> : null;
}

export default function HubSpotWorkspace({ tool, onUnauthorized, onDirtyChange, onBusyChange }: Props) {
  const definition = DEFINITIONS[tool];
  const [data, setData] = useState<ToolResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<ReadFailure | null>(null);
  const [query, setQuery] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const activeSearchRef = useRef<string | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ field: string; direction: "asc" | "desc" } | null>(null);
  const [detailRecord, setDetailRecord] = useState<ToolRecord | null>(null);
  const [detailFields, setDetailFields] = useState<HubspotEditField[]>([]);
  const [detailCanEdit, setDetailCanEdit] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const detailRequestRef = useRef<AbortController | null>(null);
  const detailRecordIdRef = useRef<string | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<ToolMessage[] | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadNotice, setThreadNotice] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const retryAtRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const threadRequestRef = useRef<AbortController | null>(null);
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { unauthorizedRef.current = onUnauthorized; }, [onUnauthorized]);
  useEffect(() => { (detailRecord ? detailHeadingRef : listHeadingRef).current?.focus(); }, [detailRecord]);
  useEffect(() => { onDirtyChange?.(editorOpen); return () => onDirtyChange?.(false); }, [editorOpen, onDirtyChange]);
  const reportEditorBusy = useCallback((busy: boolean) => { setEditorBusy(busy); onBusyChange?.(busy); }, [onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  const acceptCooldown = useCallback((response: Response, result: Partial<ToolResult>) => {
    const deadline = hubspotRetryDeadline(result.retryAfterSeconds ?? response.headers.get("Retry-After"), response.status === 429 || result.error?.code === "HUBSPOT_RATE_LIMITED");
    if (deadline) { retryAtRef.current = Math.max(retryAtRef.current, deadline); setRetryAt(retryAtRef.current); }
  }, []);

  const readRecordDetail = useCallback(async (record: ToolRecord): Promise<ToolRecord | null> => {
    const sourceTool = tool === "calendar" ? "meetings" : tool;
    if (!["contacts", "tickets", "tasks", "customer-success", "meetings"].includes(sourceTool) || retryAtRef.current > Date.now()) return null;
    detailRequestRef.current?.abort();
    const controller = new AbortController(); detailRequestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    setDetailLoading(true); setDetailError(null);
    try {
      const response = await fetch(`/api/hubspot-tools/${sourceTool}`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId: record.id }), signal: controller.signal });
      if (detailRequestRef.current !== controller || detailRecordIdRef.current !== record.id) return null;
      if (response.status === 401) { setData(null); setDetailRecord(null); setDetailCanEdit(false); setEditorOpen(false); unauthorizedRef.current(); return null; }
      const result = await response.json() as Partial<ToolResult>;
      if (detailRequestRef.current !== controller || detailRecordIdRef.current !== record.id) return null;
      acceptCooldown(response, result);
      if (!response.ok || result.status !== "available") { setDetailCanEdit(false); setDetailError(result.error?.message ?? "The latest record details could not be loaded. Try Refresh."); return null; }
      const fresh = result.records?.[0];
      if (result.tool !== sourceTool || result.selectedRecordId !== record.id || result.records?.length !== 1 || fresh?.id !== record.id || !Array.isArray(result.fields)) throw new Error("Unexpected detail response");
      const enriched = !fresh.owner && fresh.ownerId && fresh.ownerId === record.ownerId ? { ...fresh, owner: record.owner } : fresh;
      setDetailFields(result.fields); setDetailCanEdit(result.capabilities?.canEdit === true); setDetailRecord(enriched);
      setData(value => value ? { ...value, records: value.records.map(item => item.id === enriched.id ? enriched : item) } : value);
      return enriched;
    } catch {
      if (detailRequestRef.current === controller) { setDetailCanEdit(false); setDetailError(controller.signal.aborted ? "Loading the latest record timed out. Try Refresh." : "The latest record details could not be loaded. Try Refresh."); }
      return null;
    } finally {
      window.clearTimeout(timeout);
      if (detailRequestRef.current === controller) { detailRequestRef.current = null; setDetailLoading(false); }
    }
  }, [tool, acceptCooldown]);
  const openRecord = useCallback((record: ToolRecord) => {
    detailRecordIdRef.current = record.id; setDetailRecord(record); setDetailFields([]); setDetailCanEdit(false); setDetailError(null); setSaveNotice(null);
    void readRecordDetail(record);
  }, [readRecordDetail]);

  const load = useCallback(async (searchOverride?: string | null) => {
    if (!DEFINITIONS[tool]) return;
    if (retryAtRef.current > Date.now()) { setLoading(false); return; }
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    const requestedQuery = tool === "inbox" ? null : searchOverride === undefined ? activeSearchRef.current : searchOverride;
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    setLoading(true); setFailure(null);
    try {
      const response = await fetch(`/api/hubspot-tools/${encodeURIComponent(tool)}`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: requestedQuery ? JSON.stringify({ query: requestedQuery }) : "{}", signal: controller.signal });
      const result = await response.json() as Partial<ToolResult> & { retryAfterSeconds?: number };
      if (requestRef.current !== controller) return;
      if (response.status === 401) { setData(null); unauthorizedRef.current(); return; }
      acceptCooldown(response, result);
      if (!response.ok) {
        const seconds = Number(result.retryAfterSeconds ?? response.headers.get("Retry-After"));
        setFailure({ message: result.error?.message ?? "HubSpot could not load this view. Try Refresh.", retryAt: seconds > 0 && Number.isFinite(seconds) ? Date.now() + Math.min(seconds, 86400) * 1000 : undefined }); return;
      }
      if (result.tool !== tool || !["available", "permission-required", "unavailable"].includes(result.status ?? "") || !Array.isArray(result.records) || typeof result.fetchedAt !== "string") throw new Error("Unexpected response");
      if (tool !== "inbox" && !hubspotSearchResponseMatches(requestedQuery, result.query)) throw new Error("Search response does not match the request");
      activeSearchRef.current = requestedQuery; setActiveSearch(requestedQuery);
      setData(result as ToolResult); setPage(1);
    } catch {
      if (requestRef.current !== controller) return;
      setFailure({ message: controller.signal.aborted ? "HubSpot took too long to respond. Try Refresh." : "This view could not be loaded. Check your connection and try Refresh." });
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) { requestRef.current = null; setLoading(false); }
    }
  }, [tool, acceptCooldown]);

  useEffect(() => {
    startTransition(() => { setData(null); setQuery(""); setSort(null); setDetailRecord(null); setSearchDraft(""); setActiveSearch(null); activeSearchRef.current = null; setSearchError(null); setPage(1); setSelectedThread(null); setMessages(null); setThreadError(null); setThreadNotice(null); setMonth(currentHubspotMonth()); void load(null); });
    return () => { requestRef.current?.abort(); requestRef.current = null; threadRequestRef.current?.abort(); threadRequestRef.current = null; detailRequestRef.current?.abort(); detailRequestRef.current = null; detailRecordIdRef.current = null; };
  }, [load]);
  useEffect(() => {
    if (!failure?.retryAt) return;
    const timer = window.setTimeout(() => setFailure(value => value ? { ...value, retryAt: undefined } : null), Math.max(0, failure.retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [failure?.retryAt]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(() => { retryAtRef.current = 0; setRetryAt(null); }, Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAt]);

  const openThread = useCallback(async (record: ToolRecord) => {
    if (retryAtRef.current > Date.now() || !/^[1-9]\d{0,29}$/.test(record.id)) return;
    threadRequestRef.current?.abort();
    const controller = new AbortController(); threadRequestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    setSelectedThread(record.id); setMessages(null); setThreadError(null); setThreadNotice(null); setThreadLoading(true);
    try {
      const response = await fetch("/api/hubspot-tools/inbox", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: record.id }), signal: controller.signal });
      const result = await response.json() as Partial<ToolResult>;
      if (threadRequestRef.current !== controller) return;
      if (response.status === 401) { setData(null); setMessages(null); unauthorizedRef.current(); return; }
      acceptCooldown(response, result);
      if (!response.ok || result.tool !== "inbox" || result.status !== "available" || result.selectedThreadId !== record.id || !Array.isArray(result.messages)) { setThreadError(result.error?.message ?? result.notice ?? "Messages could not be loaded. Open this conversation in HubSpot or try again."); return; }
      setMessages(result.messages);
      if (result.partial) setThreadNotice(`Showing ${result.messages.length} loaded messages. More messages may be available in HubSpot.`);
    } catch {
      if (threadRequestRef.current === controller) setThreadError(controller.signal.aborted ? "Loading messages took too long. Select the conversation to try again." : "Messages could not be loaded. Select the conversation to try again.");
    } finally {
      window.clearTimeout(timeout);
      if (threadRequestRef.current === controller) { threadRequestRef.current = null; setThreadLoading(false); }
    }
  }, [acceptCooldown]);

  if (!definition) return <section className={styles.empty}><h1 tabIndex={-1}>View unavailable</h1><p>Choose a HubSpot view from the sidebar.</p></section>;
  const current = data?.tool === tool ? data : null;
  const filtered = filterHubspotRows(current?.records ?? [], query) as ToolRecord[];
  const monthRecords = tool === "calendar" && month ? filtered.filter(record => hubspotDateKey(record.scheduledAt)?.startsWith(month)) : filtered;
  const rows = sortHubspotRows(tool === "calendar" ? monthRecords : filtered, sort) as ToolRecord[];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const shown = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selected = current?.records.find(record => record.id === selectedThread);
  const available = current?.status === "available";
  const table = <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{definition.columns.map(column => <th key={column.field} scope="col" aria-sort={sort?.field === column.field ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button className={styles.sortButton} type="button" onClick={() => { setSort(value => ({ field: column.field, direction: value?.field === column.field && value.direction === "asc" ? "desc" : "asc" })); setPage(1); }} aria-label={`Sort by ${column.label}`}><span>{column.label}</span><span aria-hidden="true">{sort?.field === column.field ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>)}<th scope="col"><span className="sr-only">HubSpot record</span></th></tr></thead><tbody>{shown.map(record => <tr key={record.id}>{definition.columns.map(column => <td key={column.field}>{column.field === "title" ? <><button type="button" className={styles.recordName} onClick={() => openRecord(record)}>{record.title || `Untitled ${definition.singular}`}</button>{record.subtitle && <span className={styles.secondary}>{record.subtitle}</span>}</> : column.dateOnly ? calendarDateLabel(record[column.field]) : column.date ? dateLabel(record[column.field]) : <span className={column.field === "status" || column.field === "health" ? styles.status : undefined}>{textLabel(record[column.field])}</span>}</td>)}<td><NativeLink href={record.hubspotUrl} label="View" /></td></tr>)}</tbody></table></div>;
  const detailed = detailRecord ? current?.records.find(record => record.id === detailRecord.id) ?? detailRecord : null;
  if (detailed && available) {
    const recordInfoFields: Column[] = [...definition.columns, ...(detailed.subtitle ? [{ field: "subtitle" as const, label: "Details" }] : []), ...(["createdAt", "updatedAt"] as const).filter(field => !definition.columns.some(column => column.field === field)).map(field => ({ field, label: field === "createdAt" ? "Created" : "Updated", date: true }))];
    return <section className={styles.workspace} aria-labelledby="hubspot-record-title" aria-busy={loading}>
      <button type="button" className={`text-link ${styles.detailBack}`} disabled={editorOpen || editorBusy} onClick={() => { detailRequestRef.current?.abort(); detailRequestRef.current = null; detailRecordIdRef.current = null; setDetailRecord(null); setDetailLoading(false); }}>← Back to {definition.label}</button>
      <div className={styles.heading}><div><h1 id="hubspot-record-title" tabIndex={-1} ref={detailHeadingRef}>{detailed.title || `Untitled ${definition.singular}`}</h1><p>{definition.singular === "contact" ? "Contact information" : `${definition.label} record details`}</p></div><div className={styles.headingActions}><span className={styles.readOnly}>{detailCanEdit ? "Editing enabled" : "Read-only"}</span>{!editorOpen && <NativeLink href={detailed.hubspotUrl} />}{detailCanEdit && !editorOpen && <button className="btn btn-primary" disabled={detailLoading || Boolean(retryAt) || !hubspotRecordSnapshotAvailable(detailed, detailFields)} onClick={() => { onDirtyChange?.(true); setSaveNotice(null); setEditorOpen(true); }}>Edit record</button>}<button className="btn btn-secondary" disabled={loading || detailLoading || editorOpen || Boolean(failure?.retryAt || retryAt)} onClick={() => { if (["contacts", "tickets", "tasks", "customer-success", "meetings", "calendar"].includes(tool)) void readRecordDetail(detailed); else void load(); }}>{loading || detailLoading ? "Loading…" : "Refresh"}</button></div></div>
      {failure && <div className={styles.alert} role="alert"><strong>Showing the last loaded record</strong><p>{failure.message}</p></div>}
      {retryAt && <p className={styles.notice} role="status">HubSpot reads are available after {dateLabel(new Date(retryAt).toISOString())}.</p>}
      {!current?.records.some(record => record.id === detailed.id) && <p className={styles.notice} role="status">This record is outside the latest loaded results. These details are from the snapshot you opened.</p>}
      {detailError && <p className={styles.messageError} role="alert">{detailError}</p>}
      {detailLoading && <p className={styles.notice} role="status">Loading the latest record details…</p>}
      {saveNotice && <p className={styles.searchSummary} role="status">{saveNotice}</p>}
      {editorOpen && <HubSpotRecordEditor record={detailed} fields={detailFields} endpoint={`/api/hubspot-tools/${tool === "calendar" ? "meetings" : tool}/${detailed.id}`} canEdit={detailCanEdit} onClose={() => { setEditorOpen(false); onDirtyChange?.(false); }} onSaved={(saved, replayed) => { setDetailRecord(saved); setData(value => value ? { ...value, records: value.records.map(item => item.id === saved.id ? saved : item) } : value); setEditorOpen(false); onDirtyChange?.(false); setSaveNotice(replayed ? "Save already completed. Record refreshed from HubSpot." : "Saved to HubSpot."); }} onReload={() => readRecordDetail(detailed)} onUnauthorized={() => { setData(null); setDetailRecord(null); setEditorOpen(false); onDirtyChange?.(false); unauthorizedRef.current(); }} onBusyChange={reportEditorBusy} />}
      <dl className={styles.detailGrid}>{recordInfoFields.map(column => <div key={column.field}><dt>{column.label}</dt><dd>{column.dateOnly ? calendarDateLabel(detailed[column.field]) : column.date ? dateLabel(detailed[column.field]) : textLabel(detailed[column.field])}</dd></div>)}<div><dt>HubSpot record ID</dt><dd>{detailed.id}</dd></div></dl>
      {detailed.preview && <p className={styles.detailPreview}>{detailed.preview}</p>}
      <p className={styles.footer}>These details come from the loaded HubSpot record. Additional record activity is available in HubSpot.</p>
    </section>;
  }
  return <section className={styles.workspace} aria-labelledby="hubspot-view-title" aria-busy={loading}>
    <div className={styles.heading}><div><h1 id="hubspot-view-title" tabIndex={-1} ref={listHeadingRef}>{definition.label}</h1><p>{definition.description}</p></div><div className={styles.headingActions}><span className={styles.readOnly}>Read-only</span><NativeLink href={current?.hubspotUrl} /><button className="btn btn-secondary" disabled={loading || Boolean(failure?.retryAt || retryAt)} onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button></div></div>
    {tool !== "inbox" && <form className={styles.providerSearch} onSubmit={event => { event.preventDefault(); const normalized = normalizeHubspotSearchQuery(searchDraft); setSearchError(normalized.error); if (!normalized.error) { setQuery(""); void load(normalized.query); } }}>
      <label htmlFor="hubspot-global-search">{tool === "customer-success" ? "Search customer companies in HubSpot" : `Search ${definition.label.toLowerCase()} in HubSpot`}</label>
      <div><input id="hubspot-global-search" type="search" autoComplete="off" maxLength={200} value={searchDraft} placeholder="Enter a search phrase" aria-invalid={Boolean(searchError)} aria-describedby={searchError ? "hubspot-global-search-error" : "hubspot-global-search-hint"} onChange={event => { setSearchDraft(event.target.value); setSearchError(null); }} /><button className="btn btn-primary" type="submit" disabled={loading || Boolean(retryAt)}>Search HubSpot</button><button className="btn btn-secondary" type="button" disabled={loading || Boolean(retryAt)} onClick={() => { setSearchDraft(""); setSearchError(null); setQuery(""); void load(null); }}>Reset search</button></div>
      <p id="hubspot-global-search-hint">Search runs when you select Search HubSpot or press Enter. Reset returns to recent records.</p>{searchError && <p id="hubspot-global-search-error" className={styles.messageError} role="alert">{searchError}</p>}
    </form>}
    {failure && <div className={styles.alert} role="alert"><strong>{current?.status === "available" ? "Showing the last loaded records" : "View unavailable"}</strong><p>{failure.message}</p>{failure.retryAt && <p>Try again after {dateLabel(new Date(failure.retryAt).toISOString())}.</p>}</div>}
    {retryAt && <p className={styles.notice} role="status">HubSpot is limiting requests. Refresh and conversation reads are available after {dateLabel(new Date(retryAt).toISOString())}.</p>}
    {!current && loading && <div className={styles.loading} role="status">Loading {definition.label.toLowerCase()} from HubSpot…</div>}
    {current && !available && <div className={styles.empty} role="status"><h2>{current.status === "permission-required" ? "HubSpot permission required" : "This HubSpot view is unavailable"}</h2><p>{current.error?.message ?? current.notice ?? (current.status === "permission-required" ? "The app needs additional read access before these records can appear." : "Refresh to try again, or open the tool in HubSpot.")}</p>{current.error?.message && current.notice && <p>{current.notice}</p>}<NativeLink href={current.hubspotUrl} /></div>}
    {available && <>
      {activeSearch && <p className={styles.searchSummary}>HubSpot search results for “{activeSearch}”{current.total != null ? ` · ${current.total.toLocaleString("en-US")} matches` : ""}</p>}
      <div className={styles.toolbar}><label className={styles.search}><span className="sr-only">Filter loaded records</span><input type="search" placeholder="Filter loaded records" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label><p>{query ? `${filtered.length} matching · ` : ""}{current.loadedCount} loaded{current.total != null ? ` of ${current.total}` : ""}{current.partial ? " · Partial results" : ""}<span>Updated {dateLabel(current.fetchedAt)}</span></p></div>
      {current.notice && <p className={styles.notice} role="status">{current.notice}</p>}
      {current.partial && <p className={styles.notice}>Sorting, local filtering, and calendar views use the loaded records.</p>}
      {tool === "calendar" && month && <>
        <div className={styles.monthHeading}><h2>{MONTH_FORMAT.format(new Date(`${month}-01T12:00:00Z`))}</h2><div><button className="btn btn-quiet" aria-label="Previous month" onClick={() => { setMonth(shiftHubspotMonth(month, -1)); setPage(1); }}>←</button><button className="btn btn-quiet" onClick={() => { setMonth(currentHubspotMonth()); setPage(1); }}>This month</button><button className="btn btn-quiet" aria-label="Next month" onClick={() => { setMonth(shiftHubspotMonth(month, 1)); setPage(1); }}>→</button></div></div>
        <div className={styles.calendar} role="region" aria-label="Scheduled HubSpot meetings by day"><div className={styles.weekdays}>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <span key={day}>{day}</span>)}</div><div className={styles.days}>{hubspotMonthDays(month, filtered).map((day: {key:string;day:number;records:ToolRecord[]} | null, index: number) => day ? <div className={styles.day} key={day.key}><time dateTime={day.key}>{day.day}</time>{day.records.map(record => <div className={styles.event} key={record.id}><span>{dateLabel(record.scheduledAt, true)}</span><button type="button" className={styles.calendarRecord} onClick={() => openRecord(record)}>{record.title || "Meeting"}</button></div>)}</div> : <div className={styles.paddingDay} key={`padding-${index}`} aria-hidden="true" />)}</div></div>
        <h2 className={styles.agendaTitle}>Meeting agenda <span>{monthRecords.length}</span></h2>
      </>}
      {!filtered.length ? <div className={styles.empty}><h2>{query ? "No matching records" : `No ${definition.singular === "company" ? "companies" : definition.singular + "s"} returned`}</h2><p>{query ? "Try a different search." : "HubSpot returned no records for this view."}</p>{query && <button className="text-link" onClick={() => { setQuery(""); setPage(1); }}>Clear search</button>}</div>
        : tool === "inbox" ? <div className={styles.inbox}><div className={styles.threadList} aria-label="Conversations">{shown.map(record => <button type="button" className={`${styles.thread} ${selectedThread === record.id ? styles.selectedThread : ""}`} key={record.id} disabled={Boolean(retryAt)} onClick={() => void openThread(record)} aria-pressed={selectedThread === record.id}><strong>{record.title || "Conversation"}</strong><span>{record.preview || record.subtitle || "No preview available"}</span><small>{record.status ? `${record.status} · ` : ""}{dateLabel(record.updatedAt)}</small></button>)}</div><section className={styles.messages} aria-label="Conversation messages">{selected ? <><div className={styles.messageHeader}><h2>{selected.title || "Conversation"}</h2><NativeLink href={selected.hubspotUrl} label="Reply in HubSpot" /></div>{threadLoading && <p role="status">Loading messages…</p>}{threadError && <p role="alert" className={styles.messageError}>{threadError}</p>}{threadNotice && <p className={styles.notice} role="status">{threadNotice}</p>}{messages && (messages.length ? <ol className={styles.messageList}>{messages.map(message => <li key={message.id}><div><span>{message.direction || message.type || "Message"}</span><time>{dateLabel(message.createdAt)}</time></div><p>{message.text || "This message has no text preview. Open HubSpot to view its attachments or rich content."}</p>{message.truncated && <small className={styles.notice}>Message preview shortened. Open HubSpot to read the complete message.</small>}</li>)}</ol> : <p className={styles.messageEmpty}>No messages were returned for this conversation.</p>)}</> : <div className={styles.messageEmpty}>Select a conversation to read its messages.</div>}</section></div>
          : tool === "calendar" && !monthRecords.length ? <p className={styles.messageEmpty}>No loaded meetings are scheduled for this month.</p> : table}
      {rows.length > PAGE_SIZE && <div className={styles.pagination}><span>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, rows.length)} of {rows.length}</span><div><button className="btn btn-secondary" disabled={currentPage === 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="btn btn-secondary" disabled={currentPage === pages} onClick={() => setPage(value => value + 1)}>Next</button></div></div>}
      <p className={styles.footer}>Records refresh from HubSpot when you open this page or select Refresh. Changes and other actions are available in HubSpot.</p>
    </>}
  </section>;
}
