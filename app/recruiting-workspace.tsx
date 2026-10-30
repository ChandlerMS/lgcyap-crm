"use client";

import Image from "next/image";

import { Fragment, startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import AddRecruits from "./add-recruits";
import RecruitEditor from "./recruit-editor";
import RecruitCommunications from "./recruit-communications";
import RecruitStageControls from "./recruit-stage-controls";
import RecruitPipeline from "./recruit-pipeline";
import DemoRecruitEditor from "./demo-recruit-editor";
import { createDemoRecruits, applyDemoStage } from "./recruit-demo.mjs";
import HubSpotWorkspace from "./hubspot-workspace";
import Leaderboard from "./leaderboard";
import RecruitingPeriodControls from "./recruiting-period-controls";
import { resolveRecruitingPeriod, recordsInRecruitingPeriod } from "./recruiting-period.mjs";
import { saveRecruitStage, StageSaveError } from "./recruit-stage-save.mjs";
import { sortRecruitRows } from "./recruit-list-view.mjs";
import { STAGE_PAGES, TERMINAL_STAGE_IDS } from "../lib/recruiting-config.mjs";
import { WORKSPACE_NAV, WORKSPACE_NAV_GROUPS, HUBSPOT_TOOLS, WORKSPACE_EXTRA_PAGES, resolveWorkspaceRoute, stagePageForRecord, stagePageForView, recordsForStagePage, unmappedStageRecords } from "./recruiting-navigation.mjs";
import { RECRUITING_PATHS, LICENSE_ROUTES } from "../lib/recruiting-flow.mjs";

type View = string;
type Route = { view: View; id?: string };
type Flag = boolean | null;
type Recruit = {
  id: string; name: string; office: string; intake: string; stage: string; stageId: string;
  firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null;
  contactName?: string | null; contactId?: string | null; contactStatus?: string; lastContactedSource?: string | null;
  isDemo?: boolean;
  stageKey: string; recruitingPath: string; licenseRoute: string;
  enteredStageAt: string | null; updatedAt: string | null; createdAt: string | null;
  orientationDate: string | null; recruitType: string;
  recruiter?: string | null; ownerId?: string | null; recruiterStatus?: string; lastContactedAt?: string | null;
  flags: { orientationRegistered: Flag; orientationCheckedIn: Flag; licensingStarted: Flag; contractingRegistered: Flag; appointmentsCreated: Flag };
  hubspotUrl: string;
  editValues?: Record<string, string>;
};
type Dataset = { recruits: Recruit[]; total: number; loadedCount: number; partial: boolean; fetchedAt: string; portalId: string | number; pipelineId: string; capabilities?: { canEdit: boolean; writeAccessPending: boolean; canCreateContact?: boolean; canCreateRecruit?: boolean } };
type ReadError = { message: string; code?: string; signInPath?: string; retryAt?: number };
type ApiResult = Partial<Dataset> & { error?: { code?: string; message?: string }; signInPath?: string; retryAfterSeconds?: number };
const NAV = WORKSPACE_NAV;
const PATH_LABELS: Record<string, string> = RECRUITING_PATHS;
const LICENSE_LABELS: Record<string, string> = LICENSE_ROUTES;
const TERMINAL_IDS = new Set<string>(TERMINAL_STAGE_IDS);
const ZONE = "America/New_York";
const PAGE_SIZE = 8;

function Icon({ name }: { name: string }) {
  const shapes: Record<string, ReactNode> = {
    home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1z" />,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87" /><circle cx="9" cy="7" r="4" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    "add-person": <><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a4 4 0 0 1 4-4h6m6-5v10m-5-5h10" /></>,
    file: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6" />,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 6-6" /></>,
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.09 4.2 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.79a2 2 0 0 1-.45 2.11L8.06 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.34 1.83.58 2.79.7A2 2 0 0 1 22 16.92z" />,
    transfer: <><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" /></>,
    training: <><path d="m2 9 10-5 10 5-10 5L2 9zM6 11v6c4 3 8 3 12 0v-6M22 9v7" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1.1L20 9M4 15l2.3 3.1A7 7 0 0 0 17.9 17" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14" /><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
    back: <path d="m12 5-7 7 7 7M5 12h14" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    folder: <path d="M3 7V4h7l2 3h9v14H3V7z" />,
    chart: <><path d="M3 3v18h18M7 17v-5M12 17V7M17 17V4" /></>,
    inbox: <><path d="M3 4h18v16H3zM3 13h5l2 3h4l2-3h5" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name] || shapes.file}</svg>;
}
function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(/^\d+$/.test(value) ? Number(value) : /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isFinite(date.getTime()) ? date : null;
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
  const hash = window.location.hash;
  const route = resolveWorkspaceRoute(hash) as Route;
  if (hash === "#follow-up" || hash === "#add-recruit") window.history.replaceState(null, "", `#${route.view}`);
  return route;
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
  return <a className="person" href={`#recruit/${encodeURIComponent(recruit.id)}`}><span className="avatar" aria-hidden="true">{initials(recruit.name)}</span><span><span className="person-name">{recruit.name}</span><span className="person-meta">{office ? `${recruit.office} · ` : ""}{PATH_LABELS[recruit.recruitingPath] ?? "Path not recorded"}</span></span></a>;
}
function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty-state"><h2>{title}</h2><p>{children}</p></div>; }
function preserveRecruiter(before: Recruit, after: Recruit): Recruit {
  if (before.id !== after.id) return after;
  const merged = before.ownerId && before.ownerId === after.ownerId && !after.recruiter && before.recruiter
    ? { ...after, recruiter: before.recruiter, recruiterStatus: before.recruiterStatus } : { ...after };
  if (after.contactStatus !== "not-loaded" || !before.contactStatus || before.contactStatus === "not-loaded") return merged;
  // Ticket-only save confirmations do not reload associated Contact information.
  merged.contactStatus = before.contactStatus;
  merged.contactId = before.contactId ?? null;
  merged.contactName = before.contactName ?? null;
  merged.firstName = before.firstName ?? null;
  merged.lastName = before.lastName ?? null;
  if (before.contactStatus === "available") {
    merged.phone = before.phone ?? after.phone;
    merged.email = before.email ?? after.email;
  }
  const previousContact = Date.parse(before.lastContactedAt ?? ""), confirmedContact = Date.parse(after.lastContactedAt ?? "");
  if (Number.isFinite(previousContact) && (!Number.isFinite(confirmedContact) || previousContact > confirmedContact)) {
    merged.lastContactedAt = before.lastContactedAt;
    merged.lastContactedSource = before.lastContactedSource;
  }
  return merged;
}
function Flags({ recruit }: { recruit: Recruit }) {
  const rows: [keyof Recruit["flags"], string][] = [["orientationRegistered", "Registered for orientation"], ["orientationCheckedIn", "Checked in at orientation"], ["licensingStarted", "Licensing started"], ["contractingRegistered", "Registered for contracting"], ["appointmentsCreated", "Carrier appointments created"]];
  return <dl className="flag-list">{rows.map(([key, label]) => <div key={key}><dt>{label}</dt><dd className={recruit.flags[key] === true ? "flag-yes" : "muted"}>{recruit.flags[key] === true ? "Yes" : recruit.flags[key] === false ? "No" : "Not recorded"}</dd></div>)}</dl>;
}

export default function RecruitingWorkspace() {
  const [route, setRoute] = useState<Route>({ view: "today" });
  const [liveData, setData] = useState<Dataset | null>(null);
  const [liveLoading, setLoading] = useState(true);
  const [liveError, setError] = useState<ReadError | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [demoRecords, setDemoRecords] = useState<Recruit[]>([]);
  const [toolDirty, setToolDirty] = useState(false);
  const [toolBusy, setToolBusy] = useState(false);
  const toolDirtyRef = useRef(false);
  const toolBusyRef = useRef(false);
  const currentRouteRef = useRef<Route>({view:"today"});
  const updateToolDirty = useCallback((dirty: boolean) => { toolDirtyRef.current = dirty; setToolDirty(dirty); }, []);
  const updateToolBusy = useCallback((busy: boolean) => { toolBusyRef.current = busy; setToolBusy(busy); }, []);
  const [office, setOffice] = useState("All offices");
  const [intake, setIntake] = useState("All license statuses");
  const [query, setQuery] = useState("");
  const [listView, setListView] = useState<"list" | "board">("list");
  const [page, setPage] = useState(1);
  const [listSort, setListSort] = useState({field:"name",direction:"asc"});
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [periodSelection, setPeriodSelection] = useState<{preset:string;startDate?:string;endDate?:string}>({preset:"today"});
  const [now, setNow] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [stageSavingId, setStageSavingId] = useState<string | null>(null);
  const [stageBlockedIds, setStageBlockedIds] = useState<string[]>([]);
  const [stageSaveError, setStageSaveError] = useState<{ message: string; retryAt?: number } | null>(null);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [intakeDirty, setIntakeDirty] = useState(false);
  const intakeDraftRef = useRef(false);
  const intakeBusyRef = useRef(false);
  const updateIntakeDraft = useCallback((dirty: boolean) => { intakeDraftRef.current = dirty; setIntakeDirty(dirty); }, []);
  const updateIntakeBusy = useCallback((busy: boolean) => { intakeBusyRef.current = busy; setIntakeBusy(busy); }, []);
  const stageWriteBusyRef = useRef(false);
  const stageWriteRequestRef = useRef<AbortController | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const desktopMenuRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const restoreMenuFocus = useRef(false);
  const focusPageAfterNav = useRef(false);
  const editingIdRef = useRef(editingId);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);
  useEffect(() => { currentRouteRef.current = route; }, [route]);
  const loading = !demoMode && liveLoading;
  const error = demoMode && !liveError?.signInPath ? null : liveError;
  const data: Dataset | null = demoMode ? {recruits:demoRecords,total:demoRecords.length,loadedCount:demoRecords.length,partial:false,fetchedAt:new Date(now ?? 0).toISOString(),portalId:"50894788",pipelineId:"924992938",capabilities:{canEdit:true,writeAccessPending:false,canCreateRecruit:false,canCreateContact:false}} : liveData;
  const refresh = useCallback(async (): Promise<Dataset | null> => {
    if (busyRef.current || stageWriteBusyRef.current || liveError?.retryAt && liveError.retryAt > Date.now()
      || stageSaveError?.retryAt && stageSaveError.retryAt > Date.now()) return null;
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
      // Keep the open profile draft mounted if the latest read no longer includes it.
      // The editor receives this result and explains that its snapshot cannot be reloaded.
      if (editingIdRef.current && !result.recruits.some(recruit => recruit.id === editingIdRef.current)) return result as Dataset;
      setData(result as Dataset); setNow(Date.now()); setStageBlockedIds([]); setStageSaveError(null); return result as Dataset;
    } catch {
      if (controller.signal.aborted && requestRef.current !== controller) return null;
      setError({ message: controller.signal.aborted ? "HubSpot took too long to respond. Try Refresh again." : "Recruiting data could not be loaded. Check your connection, then try Refresh." });
      return null;
    } finally {
      window.clearTimeout(timer);
      if (requestRef.current === controller) { busyRef.current = false; setLoading(false); }
    }
  }, [liveError, stageSaveError]);
  useEffect(() => {
    startTransition(() => { const instant = Date.now(); setRoute(getRoute()); setNow(instant); if (new URLSearchParams(window.location.search).get("demo") === "1") { setDemoRecords(createDemoRecruits(instant) as Recruit[]); setDemoMode(true); } });
    const updateRoute = () => {
      if (editingIdRef.current) { window.history.replaceState(null, "", `#recruit/${encodeURIComponent(editingIdRef.current)}`); return; }
      if (toolDirtyRef.current || toolBusyRef.current) { window.history.replaceState(null, "", `#${currentRouteRef.current.view}`); setSaveNotice("Save or cancel your record edit before leaving this page."); return; }
      if (intakeDraftRef.current || intakeBusyRef.current) {
        window.history.replaceState(null, "", "#add-recruits");
        setSaveNotice("Submit or clear your recruit entries before leaving Add Recruits."); return;
      }
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
        const controls = Array.from(sidebar?.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),summary") ?? []).filter(control => control.getClientRects().length > 0);
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
  useEffect(() => { startTransition(() => setPage(1)); }, [office, intake, query, route.view]);
  useEffect(() => {
    if (!stageSaveError?.retryAt) return;
    const timer = window.setTimeout(() => setStageSaveError(value => value ? { ...value, retryAt: undefined } : null), Math.max(0, stageSaveError.retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [stageSaveError?.retryAt]);
  useEffect(() => () => { stageWriteRequestRef.current?.abort(); }, []);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(clock);
  }, []);
  useEffect(() => {
    if (!stageSavingId) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [stageSavingId]);

  const timestamp = now ?? 0;
  const all = data?.recruits ?? [];
  const editingRecruit = editingId ? all.find(recruit => recruit.id === editingId) : undefined;
  const canEdit = data?.capabilities?.canEdit === true;
  const writeAccessPending = data?.capabilities?.writeAccessPending === true;
  const officeRecords = all.filter(recruit => office === "All offices" || recruit.office === office);
  const periodSource = query.trim() ? all.filter(recruit => [recruit.name, recruit.office, recruit.stage, recruit.firstName ?? "", recruit.lastName ?? "", recruit.phone ?? "", recruit.email ?? "", recruit.recruiter ?? ""].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))) : all;
  const periodRecords = recordsInRecruitingPeriod(periodSource, resolveRecruitingPeriod(periodSelection, timestamp || undefined)) as Recruit[];
  const stagePage = stagePageForView(route.view);
  const stageRecords = route.view === "today" ? officeRecords : recordsForStagePage(officeRecords, route.view) as Recruit[];
  const unmapped = unmappedStageRecords(officeRecords) as Recruit[];
  const filtered = sortRecruitRows(stageRecords.filter(recruit => (intake === "All license statuses" || recruit.intake === intake) && (!query.trim() || [recruit.name, recruit.office, recruit.stage, recruit.phone ?? "", recruit.email ?? "", recruit.recruiter ?? ""].some(value => value.toLowerCase().includes(query.trim().toLowerCase())))), listSort) as Recruit[];
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selected = route.id ? all.find(recruit => recruit.id === route.id) : undefined;
  const selectedPage = selected ? stagePageForRecord(selected) : undefined;
  const activeView = selectedPage?.id ?? route.view;
  const leaderboardView = route.view === "leaderboard";
  const hubspotTool = HUBSPOT_TOOLS.find(item => item.id === route.view);
  const pageName = route.id ? selected?.name ?? "Recruit" : hubspotTool?.label ?? NAV.find(item => item.id === route.view)?.label ?? "Today";
  const filteredSuffix = data?.partial ? " loaded" : "";
  const closeMenu = () => { restoreMenuFocus.current = true; setMenuOpen(false); };
  const navigateFromMenu = () => { if (menuOpen) focusPageAfterNav.current = true; setMenuOpen(false); setQuery(""); };
  const resetFilters = () => { setOffice("All offices"); setIntake("All license statuses"); setQuery(""); };
  const officeFilter = <label className="filter-field"><span className="sr-only">Office</span><select className="select" value={office} onChange={event => setOffice(event.target.value)}><option>All offices</option>{["Orlando", "Tampa", "Miami", "Not recorded"].map(value => <option key={value}>{value}</option>)}</select></label>;
  const heading = (title: string, subtitle: string, actions: ReactNode = officeFilter) => <div className="page-head"><div><h1 id="page-title" className="page-title" tabIndex={-1}>{title}</h1><p className="subheading">{subtitle}</p></div><div className="header-actions">{actions}</div></div>;
  const switchDataMode = useCallback((nextDemo: boolean, view = "today") => {
    if (editingIdRef.current || intakeDraftRef.current || intakeBusyRef.current || stageWriteBusyRef.current || toolDirtyRef.current || toolBusyRef.current) return;
    const instant = Date.now();
    if (nextDemo && !demoRecords.length) setDemoRecords(createDemoRecruits(instant) as Recruit[]);
    setDemoMode(nextDemo); setNow(instant); setQuery(""); setOffice("All offices"); setIntake("All license statuses"); setPage(1); setPeriodSelection({preset:"today"}); setSaveNotice(null); setStageSaveError(null); setStageBlockedIds([]);
    const url = new URL(window.location.href);
    if (nextDemo) url.searchParams.set("demo", "1"); else url.searchParams.delete("demo");
    url.hash = view;
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`); setRoute({view});
    if (!nextDemo) void refresh();
  }, [demoRecords.length, refresh]);
  const navigationLink = (item: { id: string; label: string; icon: string }) => <a key={item.id} className="nav-link" href={`#${item.id}`} aria-current={activeView === item.id ? "page" : undefined} onClick={navigateFromMenu}><Icon name={item.icon} /><span>{item.label}</span></a>;
  const navigation = <>
    {navigationLink(NAV[0])}
    <details className="nav-pipeline">
      <summary><Icon name="folder" /><span>Pipeline</span><span className="nav-branch-chevron" aria-hidden="true">⌄</span></summary>
      <div className="pipeline-pages">
        {WORKSPACE_NAV_GROUPS.map(group => <Fragment key={group.id}>{group.branch ? <details className="nav-branch"><summary><Icon name={group.id === "licensed" ? "check" : group.id === "not-licensed" ? "file" : "people"} /><span>{group.label}</span><span className="nav-branch-chevron" aria-hidden="true">⌄</span></summary><div className="nav-branch-stages">{group.items.map(navigationLink)}</div></details> : <><p className="nav-flow-caption">{group.label}</p>{group.items.map(navigationLink)}</>}</Fragment>)}
      </div>
    </details>
    {navigationLink(NAV[1])}
    <div className="pipeline-nav-divider" role="separator" aria-label="HubSpot tools" />
    {[...HUBSPOT_TOOLS, ...WORKSPACE_EXTRA_PAGES].map(tool => <a key={tool.id} className="nav-link nav-hubspot-tool" href={`#${tool.id}`} aria-current={activeView === tool.id ? "page" : undefined} onClick={() => { if (demoMode) switchDataMode(false, tool.id); navigateFromMenu(); }}><Icon name={tool.icon} /><span>{tool.label}</span></a>)}
  </>;

  function savedRecruit(recruit: Recruit, replayed: boolean) {
    setData(value => value ? { ...value, recruits: value.recruits.map(item => item.id === recruit.id ? preserveRecruiter(item, recruit) : item) } : null);
    setNow(Date.now()); setEditingId(null);
    setSaveNotice(`${replayed ? "Save already completed. Record refreshed from HubSpot" : "Saved to HubSpot"} · ${updatedLabel(new Date().toISOString())}`);
  }
  function expiredSignIn() {
    setEditingId(null); setData(null); setSaveNotice(null);
    setError({ message: "Sign in again before opening recruiting records.", signInPath: "/sign-in" });
  }

  const changeStage = useCallback(async (recruit: Recruit, targetStageId: string, flowChanges?: { licensing_branch?: "licensed" | "not_licensed" }) => {
    if (demoMode) {
      if (editingIdRef.current) return;
      try {
        const instant = Date.now();
        const updated = applyDemoStage(recruit, targetStageId, flowChanges ?? {}, instant) as Recruit;
        setDemoRecords(rows => rows.map(item => item.id === recruit.id ? updated : item)); setNow(instant);
        setSaveNotice("Demo stage updated. HubSpot was not changed.");
      } catch { setStageSaveError({message:"That demo move is unavailable. Choose a connected stage."}); }
      return;
    }
    if (recruit.isDemo) { setStageSaveError({message:"Demo recruits can only be edited in Demo data."}); return; }
    if (stageWriteBusyRef.current || editingIdRef.current || loading || error || !canEdit
      || stageBlockedIds.includes(recruit.id) || (stageSaveError?.retryAt ?? 0) > Date.now()) return;
    stageWriteBusyRef.current = true; setStageSavingId(recruit.id); setStageSaveError(null); setSaveNotice(null);
    const controller = new AbortController(); stageWriteRequestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const result = await saveRecruitStage(recruit, targetStageId, { signal: controller.signal, flowChanges });
      setData(value => value ? { ...value, recruits: value.recruits.map(item => item.id === recruit.id ? preserveRecruiter(item, result.recruit as Recruit) : item) } : null);
      setNow(Date.now());
      setSaveNotice(`${recruit.name} moved to ${STAGE_PAGES.find(page => page.stageId === targetStageId)?.label ?? "the selected stage"}. Saved to HubSpot.`);
    } catch (caught) {
      if (caught instanceof StageSaveError && caught.status === 401) { expiredSignIn(); return; }
      setStageBlockedIds(value => value.includes(recruit.id) ? value : [...value, recruit.id]);
      const failure = caught instanceof StageSaveError ? caught : null;
      setStageSaveError({ message: `${recruit.name}: ${failure?.message ?? "The stage change could not be confirmed. Refresh and check the recruit before trying again."}`,
        retryAt: failure?.retryAfterSeconds ? Date.now() + failure.retryAfterSeconds * 1000 : undefined });
    } finally {
      window.clearTimeout(timer); stageWriteRequestRef.current = null; stageWriteBusyRef.current = false; setStageSavingId(null);
    }
  }, [demoMode, loading, error, canEdit, stageBlockedIds, stageSaveError?.retryAt]);
  const stageControlsDisabled = Boolean(stageSavingId || editingId || loading || error || stageSaveError?.retryAt);

  function collectionContent() {
    const boardStages = [
      ...STAGE_PAGES.map(stage => ({ id: stage.stageId, label: stage.label, records: filtered.filter(recruit => recruit.stageId === stage.stageId) })),
      ...Array.from(new Set(filtered.filter(recruit => !STAGE_PAGES.some(stage => stage.stageId === recruit.stageId)).map(recruit => recruit.stageId))).map(stageId => ({
        id: stageId, label: filtered.find(recruit => recruit.stageId === stageId)?.stage ?? "Unrecognized stage", records: filtered.filter(recruit => recruit.stageId === stageId),
      })),
    ].filter(stage => stage.records.length > 0);
    return <><div className="filterbar">{officeFilter}<label className="filter-field"><span className="sr-only">License status at intake</span><select className="select" value={intake} onChange={event => setIntake(event.target.value)}><option>All license statuses</option>{["Already Licensed", "In Progress", "Unlicensed", "Not recorded"].map(value => <option key={value}>{value}</option>)}</select></label>{(office !== "All offices" || intake !== "All license statuses" || query) && <button className="text-link" onClick={resetFilters}>Clear filters</button>}</div><div className="results-line"><span>{filtered.length}{filteredSuffix} recruit{filtered.length === 1 ? "" : "s"}{query && ` matching “${query}”`}</span><div className="view-switch" aria-label={route.view === "today" ? "Follow-up view" : "Recruit view"}><button className={`btn btn-quiet ${listView === "list" ? "selected" : ""}`} aria-pressed={listView === "list"} onClick={() => setListView("list")}>List</button><button className={`btn btn-quiet ${listView === "board" ? "selected" : ""}`} aria-pressed={listView === "board"} onClick={() => setListView("board")}>Board</button></div></div>{!filtered.length ? <Empty title="No matching recruits">No loaded recruits match these filters. Try another office, license status, or search. <button className="text-link" onClick={resetFilters}>Clear filters</button></Empty> : listView === "board" ? <div className="board">{boardStages.map(stage => <section className="board-column" key={stage.id}><h2>{stage.label}<span>{stage.records.length}</span></h2>{stage.records.map(recruit => <a className="board-item" href={`#recruit/${recruit.id}`} key={recruit.id}><strong>{recruit.name}</strong><span>{recruit.office}</span><small>{stageAge(recruit, timestamp)}</small></a>)}</section>)}</div> : <><div className="table-wrap"><table className="data-table"><thead><tr>{[["name","Recruit"],["phone","Phone"],["email","Email"],["recruiter","Recruiter"],["stage","Stage"],["timeInStage","Time in stage"],["lastContactedAt","Last contacted"]].map(([field,label]) => <th key={field} aria-sort={listSort.field === field ? listSort.direction === "asc" ? "ascending" : "descending" : "none"}><button className="column-sort" onClick={() => { setListSort(value => ({field,direction:value.field === field && value.direction === "asc" ? "desc" : "asc"})); setPage(1); }}>{label}{listSort.field === field && <span aria-hidden="true">{listSort.direction === "asc" ? " ↑" : " ↓"}</span>}</button></th>)}<th><span className="sr-only">Move stage</span></th><th className="communication-cell"><span className="sr-only">Contact tools</span></th></tr></thead><tbody>{shown.map(recruit => <tr key={recruit.id}><td><div className="recruit-row-person"><Person recruit={recruit} office={false} /></div></td><td>{recruit.phone || "Not recorded"}</td><td>{recruit.email || "Not recorded"}</td><td>{recruit.recruiter || (recruit.recruiterStatus === "unassigned" ? "Not assigned" : "Unavailable")}</td><td><RecruitStageControls recruit={recruit} mode="select" canEdit={canEdit} disabled={stageControlsDisabled || stageBlockedIds.includes(recruit.id)} onChange={(stageId, flowChanges) => void changeStage(recruit, stageId, flowChanges)} /></td><td className="next-step">{stageAge(recruit, timestamp)}</td><td>{dateLabel(recruit.lastContactedAt ?? null)}</td><td><RecruitStageControls recruit={recruit} mode="arrows" canEdit={canEdit} disabled={stageControlsDisabled || stageBlockedIds.includes(recruit.id)} onChange={(stageId, flowChanges) => void changeStage(recruit, stageId, flowChanges)} /></td><td className="communication-cell"><RecruitCommunications recruitName={recruit.name} recruitId={recruit.id} hubspotUrl={recruit.hubspotUrl} isDemo={recruit.isDemo} /></td></tr>)}</tbody></table></div><div className="pagination"><span>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}{filteredSuffix}</span><div><button className="btn btn-secondary" disabled={currentPage <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="btn btn-secondary" disabled={currentPage >= pageCount} onClick={() => setPage(value => value + 1)}>Next</button></div></div></>}</>;
  }

  function content() {
    if (demoMode && hubspotTool) return <>{heading(hubspotTool.label, "This workspace uses live HubSpot records.", null)}<p className="helper">Demo recruits stay separate from these records.</p><button className="btn btn-primary" onClick={() => switchDataMode(false, hubspotTool.id)}>Open live {hubspotTool.label}</button></>;
    if (leaderboardView) return <Leaderboard onUnauthorized={expiredSignIn} />;
    if (hubspotTool && !route.id) return <HubSpotWorkspace key={hubspotTool.id} tool={hubspotTool.id} onUnauthorized={expiredSignIn} onDirtyChange={updateToolDirty} onBusyChange={updateToolBusy} />;
    if (route.view === "add-recruits" && demoMode) return <>{heading("Add Recruits", "Switch to live data to add real recruits to HubSpot.", null)}<p className="helper">Demo records are separate from HubSpot.</p><button className="btn btn-primary" onClick={() => switchDataMode(false, "add-recruits")}>Use live data</button></>;
    if (route.view === "add-recruits") return <AddRecruits canCreate={data?.capabilities?.canCreateRecruit === true && !error}
      checkingAccess={loading} onUnauthorized={expiredSignIn} onCreated={() => { void refresh(); }}
      onBusyChange={updateIntakeBusy} onDraftChange={updateIntakeDraft} />;
    if (!data) return <>{heading(pageName, "Your recruiting workspace", null)}{loading ? <section aria-label="Loading recruiting data" className="loading-state"><p role="status">Loading recruiting data from HubSpot…</p><div className="skeleton skeleton-stats" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /></section> : <Empty title={error?.code === "CONNECTION_NOT_CONFIGURED" ? "Recruiting data is not connected yet" : "Recruiting data is unavailable"}>{error?.signInPath ? "Sign in to continue, then refresh the workspace." : error?.code === "CONNECTION_NOT_CONFIGURED" ? "The live connection needs to be completed before recruits can appear here." : "Use Refresh to try loading your recruiting records again."}</Empty>}</>;
    if (route.id) {
      if (!selected) return <>{heading("Recruit not in this view", "This recruit may have moved or may be outside the loaded results.", null)}<a href="#recruits" className="btn btn-secondary">Back to recruits</a></>;
      return <><a className="text-link back-link" href={`#${selectedPage?.id ?? "recruits"}`}><Icon name="back" />{selectedPage?.label ?? "Recruits"}</a><div className="profile-header"><div className="person"><span className="avatar avatar-large" aria-hidden="true">{initials(selected.name)}</span><div><h1 id="page-title" className="page-title" tabIndex={-1}>{selected.name}</h1><p className="subheading">{selected.office} / {selected.stage}</p></div></div><div className="profile-actions"><RecruitCommunications recruitName={selected.name} recruitId={selected.id} hubspotUrl={selected.hubspotUrl} isDemo={selected.isDemo} />{(canEdit || writeAccessPending) && <button className="btn btn-primary" disabled={!selected.editValues || !selected.updatedAt || loading || Boolean(stageSavingId)} onClick={() => { setSaveNotice(null); setEditingId(selected.id); }}>Edit recruit</button>}{!demoMode && <HubSpotLink recruit={selected} />}</div></div>{editingRecruit && demoMode && <DemoRecruitEditor recruit={editingRecruit} onClose={() => setEditingId(null)} onSave={updated => { setDemoRecords(rows => rows.map(item => item.id === updated.id ? updated as Recruit : item)); setEditingId(null); setSaveNotice("Demo contact updated. HubSpot was not changed."); }} />}{editingRecruit && !demoMode && <RecruitEditor embedded recruit={editingRecruit} canEdit={canEdit} writeAccessPending={writeAccessPending} onClose={() => setEditingId(null)} onSaved={savedRecruit} onUnauthorized={expiredSignIn} onReload={async () => { const latest = await refresh(); return latest?.recruits.find(recruit => recruit.id === editingId) ?? null; }} />}<div className="profile-grid"><div><section className="profile-section"><p className="muted">Current stage</p><h2 className="stage-headline">{selected.stage}</h2><p className="helper">{stageAge(selected, timestamp)}</p>{reviewSuggested(selected, timestamp) && <p className="review-note">Review suggested: at least five days in this stage.</p>}</section><section className="profile-section"><h2 className="section-title">Recruiting progress</h2><Flags recruit={selected} /><p className="helper">{demoMode ? "Fictional demo progress. These values are separate from HubSpot." : "These are the values recorded in HubSpot. Intake status is not license verification, and appointment creation is not carrier approval."}</p></section></div><aside className="profile-aside"><h2 className="section-title">Recruit details</h2><dl className="details-list"><dt>First name</dt><dd>{selected.firstName || "Not recorded"}</dd><dt>Last name</dt><dd>{selected.lastName || "Not recorded"}</dd><dt>Phone</dt><dd>{selected.phone || "Not recorded"}</dd><dt>Email</dt><dd>{selected.email || "Not recorded"}</dd><dt>Recruiter</dt><dd>{selected.recruiter || (selected.recruiterStatus === "unassigned" ? "Not assigned" : "Unavailable")}</dd><dt>Last contacted</dt><dd>{dateLabel(selected.lastContactedAt ?? null)}</dd><dt>Office</dt><dd>{selected.office}</dd><dt>Recruiting path</dt><dd>{PATH_LABELS[selected.recruitingPath] ?? "Not recorded"}</dd><dt>Licensing branch</dt><dd>{LICENSE_LABELS[selected.licenseRoute] ?? "Not chosen"}</dd><dt>License status at intake</dt><dd>{selected.intake}</dd><dt>Recruit type</dt><dd>{selected.recruitType}</dd><dt>Orientation date</dt><dd>{dateLabel(selected.orientationDate)}</dd><dt>Entered current stage</dt><dd>{dateLabel(selected.enteredStageAt)}</dd><dt>{demoMode ? "Last demo update" : "Last updated in HubSpot"}</dt><dd>{dateLabel(selected.updatedAt)}</dd></dl><p className="helper">{demoMode ? "Demo edits stay in this app. No HubSpot records are changed." : canEdit ? "Use Edit recruit to save updates directly to HubSpot. Open HubSpot for tasks and other record details." : writeAccessPending ? "Saving is disabled in this workspace. You can preview the editor." : "This workspace is read-only. Open HubSpot to update a recruit or create a task."}</p></aside></div></>;
    }
    if (route.view === "today") return <>
      <RecruitingPeriodControls records={periodSource} stages={STAGE_PAGES} selection={periodSelection} onSelectionChange={setPeriodSelection} now={now ? new Date(now).toISOString() : undefined} partial={data.partial} />
      {query.trim() && <p className="pipeline-search-note" role="status">Showing matches for “{query.trim()}”. <button className="text-link" onClick={() => setQuery("")}>Clear search</button></p>}
      <RecruitPipeline records={periodRecords} stages={STAGE_PAGES} partial={data.partial} now={timestamp} canEdit={canEdit} disabled={stageControlsDisabled} pendingId={stageSavingId} blockedIds={stageBlockedIds} onNavigate={view => { setQuery(""); window.location.hash = view; }} onStageChange={(recruit, stageId, flowChanges) => { const current = all.find(item => item.id === recruit.id); if (current) void changeStage(current, stageId, flowChanges); }} />
    </>;
    return <>{heading(stagePage?.label ?? "Recruits", `Recruiting records in ${stagePage?.label ?? "Recruits"}`, null)}{collectionContent()}</>;
  }

  return <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}><a href="#main" className="skip-link sr-only" onClick={event => { event.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a><aside ref={sidebarRef} className={`sidebar ${menuOpen ? "is-open" : ""}`} id="main-sidebar" aria-label="Main navigation"><button className="desktop-sidebar-close btn btn-quiet" aria-label="Collapse sidebar" aria-controls="main-sidebar" onClick={() => { desktopMenuRef.current?.focus(); setSidebarCollapsed(true); }}><Icon name="back" /></button><a className="brand" href="#today" onClick={navigateFromMenu}><Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners home" width="164" height="107" /></a><button className="mobile-close btn btn-quiet" onClick={closeMenu} aria-label="Close navigation"><Icon name="close" /></button><nav aria-label="Recruiting workspace">{navigation}</nav><div className="sidebar-bottom"><a className="signout-link" href="/sign-out" target="_top">Sign out</a><p className="sidebar-note">Legacy Agency Partners<br />Private recruiting workspace</p></div></aside>{menuOpen && <button className="mobile-backdrop" onClick={closeMenu} aria-label="Close navigation" tabIndex={-1} />}<div className="workspace" inert={menuOpen}><header className="topbar"><div className="breadcrumb"><button className="btn btn-quiet desktop-sidebar-toggle" ref={desktopMenuRef} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-controls="main-sidebar" aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed(value => !value)}><Icon name="menu" /></button><button className="btn btn-quiet mobile-toggle" aria-label="Open navigation" aria-controls="main-sidebar" aria-expanded={menuOpen} ref={menuRef} onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><span>Recruiting workspace</span></div>{!hubspotTool && !leaderboardView && <div className="data-mode-switch" role="group" aria-label="Recruiting data source"><button aria-pressed={!demoMode} disabled={Boolean(editingId || stageSavingId || intakeDirty || intakeBusy || toolDirty || toolBusy)} onClick={() => switchDataMode(false)}>Live data</button><button aria-pressed={demoMode} disabled={Boolean(editingId || stageSavingId || intakeDirty || intakeBusy || toolDirty || toolBusy)} onClick={() => switchDataMode(true)}>Demo data</button></div>}{route.view !== "add-recruits" && !hubspotTool && !leaderboardView && <label className="global-search"><Icon name="search" /><span className="sr-only">{route.view === "today" ? "Search pipeline" : `Search ${NAV.find(item => item.id === activeView)?.label ?? "recruits"}`}</span><input type="search" className="search-input" disabled={Boolean(editingId || stageSavingId)} placeholder={route.view === "today" ? "Search pipeline" : "Search this stage"} value={query} onChange={event => { setQuery(event.target.value); if (route.id) { const target = (selectedPage?.id ?? "recruits") as View; window.history.replaceState(null, "", `#${target}`); setRoute({ view: target }); } }} /></label>}</header><div className="source-bar" hidden={leaderboardView}><div className="source-summary"><span className="live-badge"><span aria-hidden="true" />{demoMode ? "Demo · Local changes" : "Private"} · {hubspotTool ? "Connected HubSpot workspace" : route.view === "add-recruits" ? (data?.capabilities?.canCreateRecruit ? "Recruit entry enabled" : "Read-only") : (canEdit ? "Editing enabled" : "Read-only")}</span><span>{demoMode ? "60 fictional Test recruits · No HubSpot changes" : hubspotTool ? `HubSpot ${hubspotTool.label}` : "HubSpot Recruiting"}</span>{!hubspotTool && !leaderboardView && data && <span className="updated-at">Updated {updatedLabel(data.fetchedAt)}</span>}</div>{!hubspotTool && !leaderboardView && <button className="btn refresh-button" disabled={loading || Boolean(error?.retryAt || stageSavingId || stageSaveError?.retryAt || editingId || intakeBusy || intakeDirty)} onClick={() => { if (demoMode) { const instant = Date.now(); setDemoRecords(createDemoRecruits(instant) as Recruit[]); setNow(instant); setSaveNotice("Demo records reset."); } else void refresh(); }}><Icon name="refresh" />{loading ? "Loading…" : demoMode ? "Reset demo" : "Refresh"}</button>}</div>{((!hubspotTool && !leaderboardView) || error?.signInPath) && error && <div className={`connection-alert ${data ? "stale-alert" : ""}`} role="alert"><strong>{data ? "Showing previously loaded data" : "Live data unavailable"}</strong><p>{error.message}{data && ` Last successful refresh: ${updatedLabel(data.fetchedAt)}.`}</p>{error.retryAt && <p>Try again after {new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(error.retryAt))}.</p>}{error.signInPath && <a className="btn btn-primary" href={error.signInPath} target="_top">Sign in</a>}</div>}{stageSavingId && <div className="save-notice" role="status">Saving stage to HubSpot…</div>}{stageSaveError && <div className="connection-alert" role="alert"><strong>Stage change needs attention</strong><p>{stageSaveError.message}</p><p>Use Refresh to load the latest record before another attempt.</p></div>}{saveNotice && <div className="save-notice" role="status"><span>{saveNotice}</span><button className="btn btn-quiet" aria-label="Dismiss save notification" onClick={() => setSaveNotice(null)}>×</button></div>}{!hubspotTool && !leaderboardView && data?.partial && <p className="partial-notice" role="status">Showing {data.loadedCount} of {data.total} recruiting records. Counts and filters below cover the loaded records.</p>}{!hubspotTool && !leaderboardView && unmapped.length > 0 && <div className="connection-alert" role="status"><strong>{unmapped.length} recruiting record{unmapped.length === 1 ? " has" : "s have"} an unrecognized stage</strong><p>These records use a retired or unrecognized stage. Review their path and stage in HubSpot before moving them.</p><div className="unmapped-record-links">{unmapped.map(recruit => <a className="text-link" href={`#recruit/${recruit.id}`} key={recruit.id}>Review {recruit.name}</a>)}</div></div>}<main id="main" className="content" ref={mainRef} tabIndex={-1} aria-busy={leaderboardView ? undefined : loading}>{content()}</main></div></div>;
}




