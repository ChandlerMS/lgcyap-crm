"use client";

import Image from "next/image";

import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import RecruitEditor from "./recruit-editor";

type View = "today" | "recruits" | "contracting" | "follow-up";
type Route = { view: View; id?: string };
type Flag = boolean | null;
type Recruit = {
  id: string; name: string; office: string; intake: string; stage: string; stageId: string;
  enteredStageAt: string | null; updatedAt: string | null; createdAt: string | null;
  orientationDate: string | null; recruitType: string;
  flags: { orientationRegistered: Flag; orientationCheckedIn: Flag; licensingStarted: Flag; contractingRegistered: Flag; appointmentsCreated: Flag };
  hubspotUrl: string;
  editValues?: Record<string, string>;
};
type Dataset = { recruits: Recruit[]; total: number; loadedCount: number; partial: boolean; fetchedAt: string; portalId: string | number; pipelineId: string; capabilities?: { canEdit: boolean; writeAccessPending: boolean } };
type ReadError = { message: string; code?: string; signInPath?: string; retryAt?: number };
type ApiResult = Partial<Dataset> & { error?: { code?: string; message?: string }; signInPath?: string; retryAfterSeconds?: number };
const NAV: { id: View; label: string; icon: string }[] = [
  { id: "today", label: "Today", icon: "home" }, { id: "recruits", label: "Recruits", icon: "people" },
  { id: "contracting", label: "Contracting", icon: "file" }, { id: "follow-up", label: "Follow-up", icon: "check" },
];
const STAGES = ["Orientation", "Licensing", "Transfer Approval", "Pre-Contracting Requirements", "Contracting", "Training", "Complete - Active", "Withdrawn / Did Not Complete"];
const CONTRACTING_IDS = new Set(["1416243213", "1416243214", "1416243215", "1416243216", "1416243217"]);
const TERMINAL_IDS = new Set(["1416243218", "1416243219"]);
const ZONE = "America/New_York";
const PAGE_SIZE = 8;

function Icon({ name }: { name: string }) {
  const shapes: Record<string, ReactNode> = {
    home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1z" />,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87" /><circle cx="9" cy="7" r="4" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    file: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6" />,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 6-6" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1.1L20 9M4 15l2.3 3.1A7 7 0 0 0 17.9 17" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14" /><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
    back: <path d="m12 5-7 7 7 7M5 12h14" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name] || shapes.file}</svg>;
}
function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(/^\d+$/.test(value) ? Number(value) : /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function localDay(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function dateLabel(value: string | null) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric", year: "numeric" }).format(date) : "Not recorded";
}
function updatedLabel(value: string) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date) : "Not available";
}
function daysInStage(recruit: Recruit, now: number) {
  const entered = parseDate(recruit.enteredStageAt);
  return entered && entered.getTime() <= now ? Math.floor((now - entered.getTime()) / 86_400_000) : null;
}
function stageAge(recruit: Recruit, now: number) {
  const days = daysInStage(recruit, now);
  return days === null ? "Stage date not recorded" : `${days} day${days === 1 ? "" : "s"} in stage`;
}
function reviewSuggested(recruit: Recruit, now: number) { return !TERMINAL_IDS.has(recruit.stageId) && (daysInStage(recruit, now) ?? -1) >= 5; }
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length ? `${words[0][0]}${words.length > 1 ? words[words.length - 1][0] : ""}`.toUpperCase() : "?";
}
function getRoute(): Route {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith("recruit/")) return { view: "recruits", id: hash.slice(8) };
  return { view: NAV.some(item => item.id === hash) ? hash as View : "today" };
}
function safeHubSpotLink(recruit: Recruit) {
  try {
    const url = new URL(recruit.hubspotUrl);
    return url.origin === "https://app.hubspot.com" && url.pathname === `/contacts/50894788/record/0-5/${recruit.id}` ? url.href : undefined;
  } catch { return undefined; }
}
function HubSpotLink({ recruit }: { recruit: Recruit }) {
  const href = safeHubSpotLink(recruit);
  return href ? <a className="btn btn-secondary" href={href} target="_blank" rel="noopener noreferrer">Open in HubSpot<Icon name="external" /></a> : <span className="muted">Link unavailable</span>;
}
function Person({ recruit, office = true }: { recruit: Recruit; office?: boolean }) {
  return <a className="person" href={`#recruit/${encodeURIComponent(recruit.id)}`}><span className="avatar" aria-hidden="true">{initials(recruit.name)}</span><span><span className="person-name">{recruit.name}</span>{office && <span className="person-meta">{recruit.office}</span>}</span></a>;
}
function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty-state"><h2>{title}</h2><p>{children}</p></div>; }
function Flags({ recruit }: { recruit: Recruit }) {
  const rows: [keyof Recruit["flags"], string][] = [["orientationRegistered", "Registered for orientation"], ["orientationCheckedIn", "Checked in at orientation"], ["licensingStarted", "Licensing started"], ["contractingRegistered", "Registered for contracting"], ["appointmentsCreated", "Carrier appointments created"]];
  return <dl className="flag-list">{rows.map(([key, label]) => <div key={key}><dt>{label}</dt><dd className={recruit.flags[key] === true ? "flag-yes" : "muted"}>{recruit.flags[key] === true ? "Yes" : recruit.flags[key] === false ? "No" : "Not recorded"}</dd></div>)}</dl>;
}

export default function RecruitingWorkspace() {
  const [route, setRoute] = useState<Route>({ view: "today" });
  const [data, setData] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ReadError | null>(null);
  const [office, setOffice] = useState("All offices");
  const [stage, setStage] = useState("All stages");
  const [intake, setIntake] = useState("All license statuses");
  const [query, setQuery] = useState("");
  const [listView, setListView] = useState<"list" | "board">("list");
  const [page, setPage] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const restoreMenuFocus = useRef(false);
  const focusPageAfterNav = useRef(false);
  const editingIdRef = useRef(editingId);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);
  async function refresh(): Promise<Dataset | null> {
    if (busyRef.current || error?.retryAt && error.retryAt > Date.now()) return null;
    busyRef.current = true;
    const controller = new AbortController(); requestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 60_000);
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/recruits", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal });
      const result = await response.json() as ApiResult;
      if (!response.ok) {
        const retrySeconds = Number(result.retryAfterSeconds ?? response.headers.get("Retry-After"));
        const signInPath = response.status === 401 && typeof result.signInPath === "string" && result.signInPath === "/sign-in" ? result.signInPath : undefined;
        if (response.status === 401) { setData(null); setEditingId(null); }
        setError({ message: typeof result.error?.message === "string" ? result.error.message : "Recruiting data could not be loaded. Try Refresh again.", code: result.error?.code, signInPath, retryAt: Number.isFinite(retrySeconds) && retrySeconds > 0 ? Date.now() + Math.min(retrySeconds, 86400) * 1000 : undefined });
        return null;
      }
      if (!Array.isArray(result.recruits) || !Number.isFinite(result.total) || typeof result.fetchedAt !== "string") throw new Error("Invalid data response");
      setData(result as Dataset); setNow(Date.now()); return result as Dataset;
    } catch {
      if (controller.signal.aborted && requestRef.current !== controller) return null;
      setError({ message: controller.signal.aborted ? "HubSpot took too long to respond. Try Refresh again." : "Recruiting data could not be loaded. Check your connection, then try Refresh." });
      return null;
    } finally {
      window.clearTimeout(timer);
      if (requestRef.current === controller) { busyRef.current = false; setLoading(false); }
    }
  }
  useEffect(() => {
    startTransition(() => { setRoute(getRoute()); setNow(Date.now()); });
    const updateRoute = () => {
      if (editingIdRef.current) { window.history.replaceState(null, "", `#recruit/${encodeURIComponent(editingIdRef.current)}`); return; }
      setRoute(getRoute()); setMenuOpen(false); setPage(1);
    };
    window.addEventListener("hashchange", updateRoute);
    startTransition(() => { void refresh(); });
    return () => { window.removeEventListener("hashchange", updateRoute); const request = requestRef.current; requestRef.current = null; request?.abort(); busyRef.current = false; };
    // Load once; later reads require an explicit Refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (document.activeElement instanceof HTMLInputElement) return;
    mainRef.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [route.view, route.id]);
  useEffect(() => {
    if (!menuOpen) {
      if (restoreMenuFocus.current) { menuRef.current?.focus(); restoreMenuFocus.current = false; }
      else if (focusPageAfterNav.current) mainRef.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
      focusPageAfterNav.current = false;
      return;
    }
    const sidebar = sidebarRef.current;
    sidebar?.querySelector<HTMLElement>(".nav-link[aria-current='page'],.nav-link")?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); restoreMenuFocus.current = true; setMenuOpen(false); }
      if (event.key === "Tab") {
        const controls = sidebar?.querySelectorAll<HTMLElement>("a[href],button:not([disabled])");
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    function resize() { if (window.innerWidth > 800) setMenuOpen(false); }
    document.addEventListener("keydown", keydown); window.addEventListener("resize", resize);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); window.removeEventListener("resize", resize); };
  }, [menuOpen]);
  useEffect(() => {
    if (!error?.retryAt) return;
    const timer = window.setTimeout(() => setError(value => value ? { ...value, retryAt: undefined } : null), Math.max(0, error.retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [error?.retryAt]);
  useEffect(() => { startTransition(() => setPage(1)); }, [office, stage, intake, query]);

  const timestamp = now ?? 0;
  const all = data?.recruits ?? [];
  const editingRecruit = editingId ? all.find(recruit => recruit.id === editingId) : undefined;
  const canEdit = data?.capabilities?.canEdit === true;
  const writeAccessPending = data?.capabilities?.writeAccessPending === true;
  const officeRecords = all.filter(recruit => office === "All offices" || recruit.office === office);
  const active = officeRecords.filter(recruit => !TERMINAL_IDS.has(recruit.stageId));
  const review = active.filter(recruit => reviewSuggested(recruit, timestamp)).sort((a, b) => (daysInStage(b, timestamp) ?? 0) - (daysInStage(a, timestamp) ?? 0));
  const inOrientation = active.filter(recruit => recruit.stageId === "1416243212");
  const today = now === null ? "" : localDay(new Date(now));
  const upcoming = officeRecords.filter(recruit => { const date = parseDate(recruit.orientationDate); return !TERMINAL_IDS.has(recruit.stageId) && date && localDay(date) >= today; }).sort((a, b) => (a.orientationDate ?? "").localeCompare(b.orientationDate ?? ""));
  const filtered = officeRecords.filter(recruit => (stage === "All stages" || recruit.stage === stage) && (intake === "All license statuses" || recruit.intake === intake) && (!query.trim() || [recruit.name, recruit.office, recruit.stage].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selected = route.id ? all.find(recruit => recruit.id === route.id) : undefined;
  const pageName = route.id ? selected?.name ?? "Recruit" : NAV.find(item => item.id === route.view)?.label ?? "Today";
  const filteredSuffix = data?.partial ? " loaded" : "";
  const closeMenu = () => { restoreMenuFocus.current = true; setMenuOpen(false); };
  const navigateFromMenu = () => { if (menuOpen) focusPageAfterNav.current = true; setMenuOpen(false); setQuery(""); };
  const resetFilters = () => { setOffice("All offices"); setStage("All stages"); setIntake("All license statuses"); setQuery(""); };
  const officeFilter = <label className="filter-field"><span className="sr-only">Office</span><select className="select" value={office} onChange={event => setOffice(event.target.value)}><option>All offices</option>{["Orlando", "Tampa", "Miami", "Not recorded"].map(value => <option key={value}>{value}</option>)}</select></label>;
  const heading = (title: string, subtitle: string, actions: ReactNode = officeFilter) => <div className="page-head"><div><h1 id="page-title" className="page-title" tabIndex={-1}>{title}</h1><p className="subheading">{subtitle}</p></div><div className="header-actions">{actions}</div></div>;
  const reviewRows = (records: Recruit[]) => <div className="attention-list">{records.map(recruit => <div className="attention-row" key={recruit.id}><Person recruit={recruit} /><div className="next-step"><span>{recruit.stage}</span><span className="person-meta">{stageAge(recruit, timestamp)}</span></div><a className="btn btn-secondary" href={`#recruit/${recruit.id}`}>Review</a></div>)}</div>;
  function savedRecruit(recruit: Recruit, replayed: boolean) {
    setData(value => value ? { ...value, recruits: value.recruits.map(item => item.id === recruit.id ? recruit : item) } : null);
    setNow(Date.now()); setEditingId(null);
    setSaveNotice(`${replayed ? "Save already completed. Record refreshed from HubSpot" : "Saved to HubSpot"} · ${updatedLabel(new Date().toISOString())}`);
  }
  function expiredSignIn() {
    setEditingId(null); setData(null); setSaveNotice(null);
    setError({ message: "Sign in again before opening recruiting records.", signInPath: "/sign-in" });
  }

  function content() {
    if (!data) return <>{heading(pageName, "Your recruiting workspace", null)}{loading ? <section aria-label="Loading recruiting data" className="loading-state"><p role="status">Loading recruiting data from HubSpot…</p><div className="skeleton skeleton-stats" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /></section> : <Empty title={error?.code === "CONNECTION_NOT_CONFIGURED" ? "Recruiting data is not connected yet" : "Recruiting data is unavailable"}>{error?.signInPath ? "Sign in to continue, then refresh the workspace." : error?.code === "CONNECTION_NOT_CONFIGURED" ? "The live connection needs to be completed before recruits can appear here." : "Use Refresh to try loading your recruiting records again."}</Empty>}</>;
    if (route.id) {
      if (!selected) return <>{heading("Recruit not in this view", "This recruit may have moved or may be outside the loaded results.", null)}<a href="#recruits" className="btn btn-secondary">Back to recruits</a></>;
      return <><a className="text-link back-link" href="#recruits"><Icon name="back" />Recruits</a><div className="profile-header"><div className="person"><span className="avatar avatar-large" aria-hidden="true">{initials(selected.name)}</span><div><h1 id="page-title" className="page-title" tabIndex={-1}>{selected.name}</h1><p className="subheading">{selected.office} / {selected.stage}</p></div></div><div className="profile-actions">{(canEdit || writeAccessPending) && <button className="btn btn-primary" disabled={!selected.editValues || !selected.updatedAt || loading} onClick={() => { setSaveNotice(null); setEditingId(selected.id); }}>Edit recruit</button>}<HubSpotLink recruit={selected} /></div></div><div className="profile-grid"><div><section className="profile-section"><p className="muted">Current stage</p><h2 className="stage-headline">{selected.stage}</h2><p className="helper">{stageAge(selected, timestamp)}</p>{reviewSuggested(selected, timestamp) && <p className="review-note">Review suggested: at least five days in this stage.</p>}</section><section className="profile-section"><h2 className="section-title">Recruiting progress</h2><Flags recruit={selected} /><p className="helper">These are the values recorded in HubSpot. Intake status is not license verification, and appointment creation is not carrier approval.</p></section></div><aside className="profile-aside"><h2 className="section-title">Recruit details</h2><dl className="details-list"><dt>Office</dt><dd>{selected.office}</dd><dt>License status at intake</dt><dd>{selected.intake}</dd><dt>Recruit type</dt><dd>{selected.recruitType}</dd><dt>Orientation date</dt><dd>{dateLabel(selected.orientationDate)}</dd><dt>Entered current stage</dt><dd>{dateLabel(selected.enteredStageAt)}</dd><dt>Last updated in HubSpot</dt><dd>{dateLabel(selected.updatedAt)}</dd></dl><p className="helper">{canEdit ? "Use Edit recruit to save updates directly to HubSpot. Open HubSpot for tasks and other record details." : writeAccessPending ? "Saving is disabled in this workspace. You can preview the editor." : "This workspace is read-only. Open HubSpot to update a recruit or create a task."}</p></aside></div></>;
    }
    if (route.view === "today") return <>{heading("Today", now === null ? "Your recruiting workspace" : new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "long", month: "long", day: "numeric" }).format(new Date(now)))}<div className="stat-row">{[[active.length, `Active recruits${data.partial ? " shown" : ""}`], [review.length, "Suggested for review"], [inOrientation.length, "In orientation"]].map(([value, label]) => <div className="stat" key={label}><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>)}</div><div className="today-layout"><section><div className="section-head"><h2 className="section-title">Needs a closer look</h2>{review.length > 3 && <a href="#follow-up" className="text-link">View all {review.length}</a>}</div><p className="section-description">Suggested review for open recruits with at least five days in their current stage.</p>{review.length ? reviewRows(review.slice(0, 3)) : <Empty title="No review suggestions">No loaded recruits meet the five-day review rule for this office.</Empty>}</section><aside className="upcoming"><h2 className="section-title">Coming up</h2>{upcoming.length ? upcoming.slice(0, 3).map(recruit => <div className="calendar-event" key={recruit.id}><Icon name="calendar" /><div><a href={`#recruit/${recruit.id}`} className="person-name">{recruit.name}</a><p>Orientation · {dateLabel(recruit.orientationDate)}</p><p>{recruit.office}</p></div></div>) : <p className="muted">No upcoming orientation dates are recorded for this office.</p>}<p className="helper">Dates shown as recorded in HubSpot.</p></aside></div></>;
    if (route.view === "follow-up") return <>{heading("Follow-up", "A focused list for your next recruiting conversation")}<div className="context-note"><p>Suggested reviews use the five-day stage rule. This list is not a HubSpot task queue.</p><p className="helper">Open a recruit in HubSpot to see or create their tasks.</p></div><div className="section-head"><h2 className="section-title">Recruits to review</h2><span className="muted">{review.length}{filteredSuffix} recruit{review.length === 1 ? "" : "s"}</span></div>{review.length ? reviewRows(review) : <Empty title="No review suggestions">No loaded recruits meet the five-day review rule for this office.</Empty>}</>;
    if (route.view === "contracting") {
      const records = officeRecords.filter(recruit => CONTRACTING_IDS.has(recruit.stageId));
      return <>{heading("Contracting", "Licensing, transfers, contracting and training")}<div className="section-head"><h2 className="section-title">In progress</h2><span className="muted">{records.length}{filteredSuffix} recruit{records.length === 1 ? "" : "s"}</span></div>{records.length ? reviewRows(records) : <Empty title="No recruits in these stages">No loaded recruits are in licensing, transfer approval, pre-contracting, contracting or training for this office.</Empty>}<p className="helper footer-note">Progress and approvals remain managed in HubSpot.</p></>;
    }
    return <>{heading("Recruits", "One place for every recruiting conversation", null)}<div className="filterbar">{officeFilter}<label className="filter-field"><span className="sr-only">Stage</span><select className="select" value={stage} onChange={event => setStage(event.target.value)}><option>All stages</option>{STAGES.map(value => <option key={value}>{value}</option>)}</select></label><label className="filter-field"><span className="sr-only">License status at intake</span><select className="select" value={intake} onChange={event => setIntake(event.target.value)}><option>All license statuses</option>{["Already Licensed", "In Progress", "Unlicensed", "Not recorded"].map(value => <option key={value}>{value}</option>)}</select></label>{(office !== "All offices" || stage !== "All stages" || intake !== "All license statuses" || query) && <button className="text-link" onClick={resetFilters}>Clear filters</button>}</div><div className="results-line"><span>{filtered.length}{filteredSuffix} recruit{filtered.length === 1 ? "" : "s"}{query && ` matching “${query}”`}</span><div className="view-switch" aria-label="Recruit view"><button className={`btn btn-quiet ${listView === "list" ? "selected" : ""}`} aria-pressed={listView === "list"} onClick={() => setListView("list")}>List</button><button className={`btn btn-quiet ${listView === "board" ? "selected" : ""}`} aria-pressed={listView === "board"} onClick={() => setListView("board")}>Board</button></div></div>{!filtered.length ? <Empty title="No matching recruits">Try another office, stage, intake status, or search. <button className="text-link" onClick={resetFilters}>Clear filters</button></Empty> : listView === "board" ? <div className="board">{Array.from(new Set([...STAGES, ...filtered.map(recruit => recruit.stage)])).filter(label => filtered.some(recruit => recruit.stage === label)).map(label => <section className="board-column" key={label}><h2>{label}<span>{filtered.filter(recruit => recruit.stage === label).length}</span></h2>{filtered.filter(recruit => recruit.stage === label).map(recruit => <a className="board-item" href={`#recruit/${recruit.id}`} key={recruit.id}><strong>{recruit.name}</strong><span>{recruit.office}</span><small>{stageAge(recruit, timestamp)}</small></a>)}</section>)}</div> : <><div className="table-wrap"><table className="data-table"><thead><tr><th>Recruit</th><th>Office</th><th>Stage</th><th>Time in stage</th><th><span className="sr-only">Review</span></th></tr></thead><tbody>{shown.map(recruit => <tr key={recruit.id}><td><Person recruit={recruit} office={false} /></td><td>{recruit.office}</td><td><span className="stage-indicator">{recruit.stage}</span></td><td className="next-step">{stageAge(recruit, timestamp)}</td><td><a className="btn btn-quiet" href={`#recruit/${recruit.id}`} aria-label={`Review ${recruit.name}`}>Review</a></td></tr>)}</tbody></table></div><div className="pagination"><span>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}{filteredSuffix}</span><div><button className="btn btn-secondary" disabled={currentPage <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="btn btn-secondary" disabled={currentPage >= pageCount} onClick={() => setPage(value => value + 1)}>Next</button></div></div></>}</>;
  }

  return <div className="app-shell"><a href="#main" className="skip-link sr-only" onClick={event => { event.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a><aside ref={sidebarRef} className={`sidebar ${menuOpen ? "is-open" : ""}`} id="main-sidebar" aria-label="Main navigation"><a className="brand" href="#today" onClick={navigateFromMenu}><Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners home" width="164" height="107" /></a><button className="mobile-close btn btn-quiet" onClick={closeMenu} aria-label="Close navigation"><Icon name="close" /></button><nav aria-label="Recruiting workspace">{NAV.map(item => <a key={item.id} className="nav-link" href={`#${item.id}`} aria-current={route.view === item.id ? "page" : undefined} onClick={navigateFromMenu}><Icon name={item.icon} /><span>{item.label}</span></a>)}</nav><div className="sidebar-bottom"><a className="signout-link" href="/sign-out" target="_top">Sign out</a><p className="sidebar-note">Legacy Agency Partners<br />Private recruiting workspace</p></div></aside>{menuOpen && <button className="mobile-backdrop" onClick={closeMenu} aria-label="Close navigation" tabIndex={-1} />}<div className="workspace" inert={menuOpen}><header className="topbar"><div className="breadcrumb"><button className="btn btn-quiet mobile-toggle" aria-label="Open navigation" aria-controls="main-sidebar" aria-expanded={menuOpen} ref={menuRef} onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><span>Recruiting workspace</span></div><label className="global-search"><Icon name="search" /><span className="sr-only">Search recruits</span><input type="search" className="search-input" placeholder="Search recruits" value={query} onChange={event => { setQuery(event.target.value); if (route.view !== "recruits" || route.id) { window.history.replaceState(null, "", "#recruits"); setRoute({ view: "recruits" }); } }} /></label></header><div className="source-bar"><div className="source-summary"><span className="live-badge"><span aria-hidden="true" />Private · {canEdit ? "Editing enabled" : "Read-only"}</span><span>HubSpot Recruiting</span>{data && <span className="updated-at">Updated {updatedLabel(data.fetchedAt)}</span>}</div><button className="btn refresh-button" disabled={loading || Boolean(error?.retryAt)} onClick={() => void refresh()}><Icon name="refresh" />{loading ? "Loading…" : "Refresh"}</button></div>{error && <div className={`connection-alert ${data ? "stale-alert" : ""}`} role="alert"><strong>{data ? "Showing previously loaded data" : "Live data unavailable"}</strong><p>{error.message}{data && ` Last successful refresh: ${updatedLabel(data.fetchedAt)}.`}</p>{error.retryAt && <p>Try again after {new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(error.retryAt))}.</p>}{error.signInPath && <a className="btn btn-primary" href={error.signInPath} target="_top">Sign in</a>}</div>}{saveNotice && <div className="save-notice" role="status"><span>{saveNotice}</span><button className="btn btn-quiet" aria-label="Dismiss save notification" onClick={() => setSaveNotice(null)}>×</button></div>}{data?.partial && <p className="partial-notice" role="status">Showing {data.loadedCount} of {data.total} recruiting records. Counts and filters below cover the loaded records.</p>}<main id="main" className="content" ref={mainRef} tabIndex={-1} aria-busy={loading}>{content()}</main></div>{editingRecruit && <RecruitEditor recruit={editingRecruit} canEdit={canEdit} writeAccessPending={writeAccessPending} onClose={() => setEditingId(null)} onSaved={savedRecruit} onUnauthorized={expiredSignIn} onReload={async () => { const latest = await refresh(); return latest?.recruits.find(recruit => recruit.id === editingId) ?? null; }} />}</div>;
}




