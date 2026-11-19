"use client";
import DismissibleNotice from './dismissible-notice';
import { ExpandCollapseControls } from "./expand-collapse";

import Image from "next/image";
import SalesPage from "./sales-page";
import CallsPage from "./calls-page";
import AdminDashboard from "./admin/admin-dashboard";
import ExternalWorkspace from "./external-workspace";
import { ADMIN_PAGES, AGENT_PORTAL_PAGES, externalWorkspacePage } from "./external-workspace-pages.mjs";
import SidebarFlyout from "./sidebar-flyout";
import WorkspaceTitlebar from "./workspace-titlebar";
import WorkspaceViewControl from "./workspace-view-control";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AddRecruits from "./add-recruits";
import RecruitEditor from "./recruit-editor";
import RecruitCommunications from "./recruit-communications";
import RecruitPathPage from "./recruit-path-page";
import RecruitQuickActions, { AddActivityButtons } from "./recruit-quick-actions";
import RingCentralPanel, { NewCallButton } from "./ringcentral-panel";
import RecruitEmailPanel from "./recruit-email-panel";
import { RecruitEmailProvider, RecruitEmailSummary } from "./recruit-email";
import RecruitStageControls, { type StageFlowChanges } from "./recruit-stage-controls";
import RecruitPipeline from "./recruit-pipeline";
import { useRecruitHoverCard } from "./recruit-hover";
import RecruitFollowUpChips from "./recruit-follow-up-chips";
import RecruitTaskChips from "./recruit-task-chips";
import SupportSummary from "./support-summary";
import RecruitMeetingChips from "./recruit-meeting-chips";
import RecruitsHubSpotLink from "./recruits-hubspot-link";
import RecruitsPanel from "./recruits-panel";
import FollowUpPage from "./follow-up-page";
import FollowUpPanel from "./follow-up-panel";
import ApplicationsPage from "./applications-page";
import TrainingClassesPage from "./training-classes-page";
import { activityRecruits } from "./dashboard-activity.mjs";
import RecruitActivity from "./recruit-activity";
import DemoRecruitEditor from "./demo-recruit-editor";
import { DEMO_RECRUIT_COUNT, createDemoRecruits, applyDemoStage } from "./recruit-demo.mjs";
import HubSpotWorkspace from "./hubspot-workspace";
import Leaderboard from "./leaderboard";
import LeadData from "./lead-data";
import EventAttendanceBoard from "./event-attendance/event-attendance-board";
import { CollapsibleCards, DashboardSection, SectionToggle } from "./dashboard-section";
import RecruitingPeriodControls from "./recruiting-period-controls";
import { resolveRecruitingPeriod, recordsInRecruitingPeriod } from "./recruiting-period.mjs";
import { saveRecruitStageWithRefresh, StageSaveError } from "./recruit-stage-save.mjs";
import { sortRecruitRows } from "./recruit-list-view.mjs";
import { STAGE_PAGES, TERMINAL_STAGE_IDS } from "../lib/recruiting-config.mjs";
import { WORKSPACE_NAV, DASHBOARD_COMMUNICATION_TOOLS, RECRUIT_PATH_PAGES, RECRUITS_CHILD_PAGES, RECRUITS_SITE_LINKS, HUBSPOT_TOOLS, SIDEBAR_HUBSPOT_TOOLS, SIDEBAR_RECRUITING_PAGES, RECRUITS_PAGE_TOOLS, DASHBOARD_PAGES, WORKSPACE_EXTRA_PAGES, QUEUE_PAGES, sidebarViewFor, resolveWorkspaceRoute, stagePageForRecord, stagePageForView, recordsForStagePage, unmappedStageRecords } from "./recruiting-navigation.mjs";
import { RECRUITING_PATHS, LICENSE_ROUTES } from "../lib/recruiting-flow.mjs";

import { lifecycleStatusLabel } from "../lib/recruit-lifecycle.mjs";

type View = string;
type Route = { view: View; id?: string; source?: "shopper" | "shopper-dispositions" | "standard" | "standard-dispositions" };
type Flag = boolean | null;
type Recruit = {
  id: string; name: string; office: string; intake: string; stage: string; stageId: string;
  firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null;
  contactName?: string | null; contactId?: string | null; contactStatus?: string; lastContactedSource?: string | null;
  isDemo?: boolean;
  customRecruitUrl?: string;
  customRecruitSync?: { status: string; checkedAt?: string | null };
  lifecycleSync?: { status: string; checkedAt?: string | null; syncedAt?: string | null };
  stageKey: string; recruitingPath: string; licenseRoute: string;
  enteredStageAt: string | null; updatedAt: string | null; createdAt: string | null;
  orientationDate: string | null; recruitType: string;
  recruiter?: string | null; ownerId?: string | null; recruiterStatus?: string; lastContactedAt?: string | null;
  flags: { orientationRegistered: Flag; orientationCheckedIn: Flag; licensingStarted: Flag; contractingRegistered: Flag; appointmentsCreated: Flag };
  hubspotUrl: string;
  editValues?: Record<string, string>;
};
type Dataset = { customRecruitSync?: { status?: string; checkedAt?: string | null }; recruits: Recruit[]; total: number; loadedCount: number; partial: boolean; fetchedAt: string; portalId: string | number; pipelineId: string; capabilities?: { canEdit: boolean; writeAccessPending: boolean; canCreateContact?: boolean; canCreateRecruit?: boolean } };
type ReadError = { message: string; code?: string; signInPath?: string; retryAt?: number };
type ApiResult = Partial<Dataset> & { error?: { code?: string; message?: string }; signInPath?: string; retryAfterSeconds?: number };
const NAV = WORKSPACE_NAV;
const PATH_LABELS: Record<string, string> = RECRUITING_PATHS;
const LICENSE_LABELS: Record<string, string> = LICENSE_ROUTES;
const TERMINAL_IDS = new Set<string>(TERMINAL_STAGE_IDS);
const ZONE = "America/New_York";
const PAGE_SIZE = 8;
// Full HubSpot pages opened from the dashboard's summaries and panel titles.
const ACTIVITY_PAGES = [
  { id: "tasks", label: "Tasks", description: "HubSpot tasks assigned to you, including the tasks and follow-ups added from the dashboard." },
  { id: "meetings", label: "Meetings", description: "HubSpot meetings assigned to you. Open a meeting to see or edit its details." },
  { id: "calendar", label: "Calendar", description: "Your HubSpot meetings by month. All times are Eastern." },
] as const;

function Icon({ name }: { name: string }) {
  const shapes: Record<string, ReactNode> = {
    home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1z" />,
    funnel: <path d="M3 4h18l-7 8.5V19l-4 2v-8.5z" />,
    // A numbered list, for Queues.
    "list-numbered": <><path d="M10 6h11M10 12h11M10 18h11" /><path d="M3.5 5 5 4v5.5M3.5 9.5h3" /><path d="M3.5 14.6a1.5 1.5 0 0 1 3 .1c0 1.6-3 2.4-3 4.3h3" /></>,
    chevron: <path d="m6 9 6 6 6-6" />,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87" /><circle cx="9" cy="7" r="4" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    "add-person": <><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a4 4 0 0 1 4-4h6m6-5v10m-5-5h10" /></>,
    gear: <><path d="m9.5 3-.6 2.2-2 .9-2-.6L2.5 9l1.5 1.6v2.8L2.5 15l2.4 3.5 2-.6 2 .9.6 2.2h5l.6-2.2 2-.9 2 .6 2.4-3.5-1.5-1.6v-2.8L21.5 9l-2.4-3.5-2 .6-2-.9L14.5 3z" /><circle cx="12" cy="12" r="3" /></>,
    file: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6" />,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 6-6" /></>,
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.09 4.2 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.79a2 2 0 0 1-.45 2.11L8.06 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.34 1.83.58 2.79.7A2 2 0 0 1 22 16.92z" />,
    transfer: <><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" /></>,
    training: <><path d="m2 9 10-5 10 5-10 5L2 9zM6 11v6c4 3 8 3 12 0v-6M22 9v7" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1.1L20 9M4 15l2.3 3.1A7 7 0 0 0 17.9 17" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14" /><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
    back: <path d="m12 5-7 7 7 7M5 12h14" />,
    forward: <path d="m12 5 7 7-7 7M19 12H5" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    folder: <path d="M3 7V4h7l2 3h9v14H3V7z" />,
    money: <><path d="M12 2v20M17 5H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H6" /></>,
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
  if (hash === "#follow-up" || hash === "#add-recruit" || hash === "#lead-data") window.history.replaceState(null, "", `#${route.view}`);
  return route;
}
function safeHubSpotLink(recruit: Recruit) {
  try {
    const url = new URL(recruit.hubspotUrl);
    return url.origin === "https://app.hubspot.com" && url.pathname === `/contacts/50894788/record/0-5/${recruit.id}` ? url.href : undefined;
  } catch { return undefined; }
}
function customSyncLabel(status: string) {
  if (status === "synced") return "Up to date";
  if (status === "pending" || status === "busy") return "Checking for updates";
  if (["conflict", "association_changed", "unmapped"].includes(status)) return "Needs review in HubSpot";
  if (["uncertain", "intake_uncertain"].includes(status)) return "Confirming the last update";
  return "Sync needs attention";
}
function CustomRecruitLink({ recruit }: { recruit: Recruit }) {
  let href: string | undefined;
  try {
    const url = new URL(recruit.customRecruitUrl || "");
    if (url.origin === "https://app.hubspot.com" && /^\/contacts\/50894788\/record\/2-72246945\/[1-9]\d{0,19}$/.test(url.pathname)) href = url.href;
  } catch { /* A pending recruit has no custom record link yet. */ }
  return href ? <a className="btn btn-secondary" href={href} target="_blank" rel="noopener noreferrer">HubSpot Recruit<Icon name="external" /></a> : null;
}
function HubSpotLink({ recruit }: { recruit: Recruit }) {
  const href = safeHubSpotLink(recruit);
  return href ? <a className="btn btn-secondary" href={href} target="_blank" rel="noopener noreferrer">Open in HubSpot<Icon name="external" /></a> : <span className="muted">Link unavailable</span>;
}
// hover carries the recruit details card's handlers, as on the Recruits page.
function Person({ recruit, office = true, hover }: { recruit: Recruit; office?: boolean; hover?: ReturnType<ReturnType<typeof useRecruitHoverCard>["bind"]> }) {
  return <a className="person" href={`#recruit/${encodeURIComponent(recruit.id)}`} {...hover}><span className="avatar" aria-hidden="true">{initials(recruit.name)}</span><span><span className="person-name">{recruit.name}</span><span className="person-meta">{office ? `${recruit.office} · ` : ""}{PATH_LABELS[recruit.recruitingPath] ?? "Path not recorded"}</span></span></a>;
}
function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty-state"><h2>{title}</h2><p>{children}</p></div>; }
function preserveRecruiter(before: Recruit, after: Recruit): Recruit {
  if (before.id !== after.id) return after;
  const merged = before.ownerId && before.ownerId === after.ownerId && !after.recruiter && before.recruiter
    ? { ...after, recruiter: before.recruiter, recruiterStatus: before.recruiterStatus } : { ...after };
  if (!after.customRecruitUrl && before.customRecruitUrl) merged.customRecruitUrl = before.customRecruitUrl;
  if (!after.customRecruitSync && before.customRecruitSync) merged.customRecruitSync = { status: "pending" };
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

export default function RecruitingWorkspace({ ringCentralClientId = "" }: { ringCentralClientId?: string }) {
  const [route, setRoute] = useState<Route>({ view: "today" });
  const [liveData, setData] = useState<Dataset | null>(null);
  const [liveLoading, setLoading] = useState(true);
  const [liveError, setError] = useState<ReadError | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [expandedNav, setExpandedNav] = useState<string | null>(null);
  const [hoveredNav, setHoveredNav] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterNav = (group: string) => { if (hoverTimer.current) clearTimeout(hoverTimer.current); setHoveredNav(group); };
  const leaveNav = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => { setHoveredNav(null); setExpandedNav(null); }, 200); };
  const dismissNav = useCallback(() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); setExpandedNav(null); setHoveredNav(null); }, []);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const [demoRecords, setDemoRecords] = useState<Recruit[]>([]);
  const [toolDirty, setToolDirty] = useState(false);
  const [toolBusy, setToolBusy] = useState(false);
  const toolDirtyRef = useRef(false);
  const toolBusyRef = useRef(false);
  const currentRouteRef = useRef<Route>({view:"today"});
  const updateToolDirty = useCallback((dirty: boolean) => { toolDirtyRef.current = dirty; setToolDirty(dirty); }, []);
  const updateToolBusy = useCallback((busy: boolean) => { toolBusyRef.current = busy; setToolBusy(busy); }, []);
  // Recruits-page panels report separately; the page stays guarded while any one has an open edit.
  const panelReports = useMemo(() => {
    const dirty = new Set<string>(), busy = new Set<string>();
    const reports: Record<string, { onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void }> = {};
    for (const id of [...RECRUITS_PAGE_TOOLS.map(tool => tool.id), ...DASHBOARD_COMMUNICATION_TOOLS.map(tool => tool.id), "tasks"]) reports[id] = {
      onDirtyChange: value => { if (value) dirty.add(id); else dirty.delete(id); updateToolDirty(dirty.size > 0); },
      onBusyChange: value => { if (value) busy.add(id); else busy.delete(id); updateToolBusy(busy.size > 0); },
    };
    return reports;
  }, [updateToolDirty, updateToolBusy]);
  const [office, setOffice] = useState("All offices");
  const [intake, setIntake] = useState("All license statuses");
  const [query, setQuery] = useState("");
  const [listView, setListView] = useState<"list" | "board">("list");
  const [page, setPage] = useState(1);
  const [listSort, setListSort] = useState({field:"name",direction:"asc"});
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Queues opens by itself on a queue page until someone opens or closes it.
  const [periodSelection, setPeriodSelection] = useState<{preset:string;startDate?:string;endDate?:string}>({preset:"weekly"});
  const [now, setNow] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [stageSavingId, setStageSavingId] = useState<string | null>(null);
  const [stageBlockedIds, setStageBlockedIds] = useState<string[]>([]);
  const [stageSaveError, setStageSaveError] = useState<{ message: string; retryAt?: number; retryWithoutRefresh?: boolean } | null>(null);
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
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);
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
      setRoute(getRoute()); setPage(1);
    };
    window.addEventListener("hashchange", updateRoute);
    startTransition(() => { void refresh(); });
    return () => { window.removeEventListener("hashchange", updateRoute); const request = requestRef.current; requestRef.current = null; request?.abort(); busyRef.current = false; };
    // Initial read; background reads below pause while a draft is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (demoMode || liveError?.signInPath) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible" || editingIdRef.current || toolDirtyRef.current || toolBusyRef.current
        || intakeDraftRef.current || intakeBusyRef.current) return;
      void refresh();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [demoMode, liveError?.signInPath, refresh]);
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
    const activeLink = sidebar?.querySelector<HTMLElement>(".nav-link[aria-current='page']");
    const focusTarget = activeLink?.getClientRects().length ? activeLink : sidebar?.querySelector<HTMLElement>(".nav-link");
    focusTarget?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); restoreMenuFocus.current = true; setMenuOpen(false); }
      if (event.key === "Tab") {
        const controls = Array.from(sidebar?.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),summary") ?? []).filter(control => control.getClientRects().length > 0).flatMap(control => {
          const id = control.getAttribute("aria-controls");
          const panel = id ? document.getElementById(id) : null;
          return panel?.classList.contains("sidebar-flyout") && getComputedStyle(panel).visibility === "visible" ? [control, ...Array.from(panel.querySelectorAll<HTMLElement>("a[href]"))] : [control];
        });
        if (!controls.length) return;
        event.preventDefault();
        const index = controls.indexOf(document.activeElement as HTMLElement);
        controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
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
  const pathPage = RECRUIT_PATH_PAGES.find(page => page.id === route.view);
  const stageRecords = ["today", "recruits"].includes(route.view) ? officeRecords : recordsForStagePage(officeRecords, route.view) as Recruit[];
  const unmapped = unmappedStageRecords(officeRecords) as Recruit[];
  const filtered = sortRecruitRows(stageRecords.filter(recruit => (intake === "All license statuses" || recruit.intake === intake) && (!query.trim() || [recruit.name, recruit.office, recruit.stage, recruit.phone ?? "", recruit.email ?? "", recruit.recruiter ?? ""].some(value => value.toLowerCase().includes(query.trim().toLowerCase())))), listSort) as Recruit[];
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selected = route.id ? all.find(recruit => recruit.id === route.id) : undefined;
  const selectedPage = selected ? stagePageForRecord(selected) : undefined;
  const activeView = selectedPage?.id ?? route.view;
  // Leaderboard and Call Analytics are one area of the app, switched by the toggle at the top of the page.
  const callAnalyticsView = route.view === "call-analytics";
  const leaderboardView = route.view === "leaderboard" || callAnalyticsView;
  const queuePage = QUEUE_PAGES.find(item => item.id === route.view);
  const eventAttendanceView = route.view === "event-attendance";
  const applicationsView = route.view === "applications";
  const externalPage = externalWorkspacePage(route.view);
  const embeddedView = route.view === "training-classes" || route.view === "admin" || Boolean(externalPage) || Boolean(queuePage) || eventAttendanceView || route.view === "loa";
  const sidebarView = sidebarViewFor(activeView);
  const hubspotTool = HUBSPOT_TOOLS.find(item => item.id === route.view && item.id !== "recruits");
  const activityPage = ACTIVITY_PAGES.find(page => page.id === route.view) ?? null;
  // Add Task and Add Follow-Up save to HubSpot, so they appear only for live data and accounts that can save.
  const canAddActivity = canEdit && !demoMode;
  // The Recruits page shows the pipeline's recruit details card beside a name on hover.
  const recruitHover = useRecruitHoverCard({ now: timestamp, canAdd: canAddActivity });
  const meetingAction = (view: string, trigger: "plus" | "button") => canAddActivity && ["meetings", "calendar"].includes(view)
    ? <RecruitQuickActions kinds={["meeting"]} recruits={activityRecruits(all)} trigger={trigger} meetingLabel={view === "calendar" ? "Add to Calendar" : "Add Meeting"} /> : undefined;
  // The top bar only appears when it has something to hold: the data source switch and search.
  const pageName = route.id ? selected?.name ?? "Recruit" : externalPage?.label ?? hubspotTool?.label ?? pathPage?.label ?? NAV.find(item => item.id === route.view)?.label ?? (route.view === "email" ? "Email" : route.view === "recruits" ? "Recruits" : "Today");
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
    setDemoMode(nextDemo); setNow(instant); setQuery(""); setOffice("All offices"); setIntake("All license statuses"); setPage(1); setPeriodSelection({preset:"weekly"}); setSaveNotice(null); setStageSaveError(null); setStageBlockedIds([]);
    const url = new URL(window.location.href);
    if (nextDemo) url.searchParams.set("demo", "1"); else url.searchParams.delete("demo");
    url.hash = view;
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`); setRoute({view});
    if (!nextDemo) void refresh();
  }, [demoRecords.length, refresh]);
  const navigationLink = (item: { id: string; label: string; icon: string }) => <a key={item.id} className="nav-link" href={`#${item.id}`} aria-current={sidebarView === item.id ? "page" : undefined} onClick={navigateFromMenu}><Icon name={item.icon} /><span>{item.label}</span></a>;
  const focusFlyout = (event: React.KeyboardEvent<HTMLElement>, id: string, group: string) => {
    if (event.key !== "ArrowRight") return;
    event.preventDefault(); setHoveredNav(null); setExpandedNav(group);
    requestAnimationFrame(() => document.getElementById(id)?.querySelector<HTMLAnchorElement>("a")?.focus());
  };
  // Dashboard heads the sidebar; Call Analytics opens from the Leaderboard toggle.
  const navigation = <>
    {SIDEBAR_RECRUITING_PAGES.map(navigationLink)}
    <a className="nav-link" href="#leaderboard" aria-current={leaderboardView ? "page" : undefined} onClick={() => { dismissNav(); navigateFromMenu(); }}><Icon name="chart" /><span>Leaderboard</span></a>
    <a className="nav-link" href="#queue" aria-current={queuePage ? "page" : undefined} onClick={() => { dismissNav(); navigateFromMenu(); }}><Icon name="list-numbered" /><span>Queues</span></a>
    <a className="nav-link" href="#sales" aria-current={route.view === "sales" ? "page" : undefined} onClick={() => { dismissNav(); if (demoMode) switchDataMode(false, "sales"); navigateFromMenu(); }}><Icon name="money" /><span>Sales</span></a>
    <a className="nav-link" href="#calls" aria-current={route.view === "calls" ? "page" : undefined} onClick={() => { dismissNav(); if (demoMode) switchDataMode(false, "calls"); navigateFromMenu(); }}><Icon name="phone" /><span>Calls</span></a>
    <div className="pipeline-nav-divider" role="separator" aria-label="HubSpot tools" />
    {SIDEBAR_HUBSPOT_TOOLS.map(tool => tool.id === "contract-agents" ? <div className="nav-group" key={tool.id} onMouseEnter={() => enterNav("agents")} onMouseLeave={leaveNav}>
      <a className="nav-link nav-group-toggle" href="#contract-agents" aria-current={sidebarView === tool.id ? "page" : undefined} aria-expanded={(hoveredNav ?? expandedNav) === "agents"} aria-controls="agent-object-links" onKeyDown={event => focusFlyout(event, "agent-object-links", "agents")} onClick={() => { setHoveredNav(null); setExpandedNav(value => value === "agents" ? null : "agents"); if (demoMode) switchDataMode(false, tool.id); }}><Icon name="people" /><span>Agents</span><Icon name="chevron" /></a>
      <SidebarFlyout onEnter={() => enterNav("agents")} onLeave={leaveNav} id="agent-object-links" hidden={(hoveredNav ?? expandedNav) !== "agents"} layoutKey={`${menuOpen}:${sidebarCollapsed}`} onDismiss={dismissNav}>{HUBSPOT_TOOLS.filter(item => ["carrier-appointments", "carriers"].includes(item.id)).map(item => <a className="nav-link" key={item.id} href={`#${item.id}`} aria-current={route.view === item.id ? "page" : undefined} onClick={() => { if (demoMode) switchDataMode(false, item.id); navigateFromMenu(); }}>{item.label}</a>)}{AGENT_PORTAL_PAGES.map(item => <a className="nav-link" key={item.id} href={`#${item.id}`} aria-current={route.view === item.id ? "page" : undefined} onClick={navigateFromMenu}>{item.label}</a>)}</SidebarFlyout>
    </div> : tool.id === "recruits" ? <div className="nav-group" key={tool.id} onMouseEnter={() => enterNav("recruits")} onMouseLeave={leaveNav}>
      <a className="nav-link nav-group-toggle" href="#recruits" aria-current={sidebarView === "recruits" ? "page" : undefined} aria-expanded={(hoveredNav ?? expandedNav) === "recruits"} aria-controls="recruit-path-links" onKeyDown={event => focusFlyout(event, "recruit-path-links", "recruits")} onClick={() => { setHoveredNav(null); setExpandedNav(value => value === "recruits" ? null : "recruits"); }}><Icon name="people" /><span>Recruits</span><Icon name="chevron" /></a>
      <SidebarFlyout onEnter={() => enterNav("recruits")} onLeave={leaveNav} id="recruit-path-links" hidden={(hoveredNav ?? expandedNav) !== "recruits"} layoutKey={`${menuOpen}:${sidebarCollapsed}`} onDismiss={dismissNav}>{RECRUITS_SITE_LINKS.map(item => <a className="nav-link nav-site-link" key={item.id} href={item.href} target={item.embedded ? undefined : "_blank"} rel={item.embedded ? undefined : "noopener noreferrer"} aria-current={route.view === item.id ? "page" : undefined} onClick={navigateFromMenu}><span>{item.label}</span>{!item.embedded && <><Icon name="external" /><span className="sr-only"> (opens in a new tab)</span></>}</a>)}{RECRUITS_CHILD_PAGES.map(item => <a className="nav-link" key={item.id} href={`#${item.id}`} aria-current={route.view === item.id ? "page" : undefined} onClick={navigateFromMenu}>{item.label}</a>)}</SidebarFlyout>
    </div> : <a key={tool.id} className="nav-link nav-hubspot-tool" href={`#${tool.id}`} aria-current={activeView === tool.id ? "page" : undefined} onClick={() => { if (demoMode && tool.id !== "recruits") switchDataMode(false, tool.id); navigateFromMenu(); }}><Icon name={tool.icon} /><span>{tool.label}</span></a>)}
  </>;
  const leaderboardSwitch = <nav className="page-switch" aria-label="Leaderboard and Call Analytics">{WORKSPACE_EXTRA_PAGES.map(item => <a key={item.id} href={`#${item.id}`} aria-current={route.view === item.id ? "page" : undefined}>{item.label}</a>)}</nav>;

  function savedRecruit(recruit: Recruit, replayed: boolean) {
    setData(value => value ? { ...value, recruits: value.recruits.map(item => item.id === recruit.id ? preserveRecruiter(item, recruit) : item) } : null);
    setNow(Date.now()); setEditingId(null);
    setSaveNotice(`${replayed ? "Save already completed. Record refreshed from HubSpot" : "Saved to HubSpot"} · ${updatedLabel(new Date().toISOString())}`);
  }
  function expiredSignIn() {
    setEditingId(null); setData(null); setSaveNotice(null);
    setError({ message: "Sign in again before opening recruiting records.", signInPath: "/sign-in" });
  }

  const changeStage = useCallback(async (recruit: Recruit, targetStageId: string, flowChanges?: StageFlowChanges) => {
    const stageLabel = STAGE_PAGES.find(page => page.stageId === targetStageId)?.label ?? "the selected stage";
    const destination = flowChanges?.recruiting_path ? `${PATH_LABELS[flowChanges.recruiting_path]} · ${stageLabel}` : stageLabel;
    if (demoMode) {
      if (editingIdRef.current) return;
      try {
        const instant = Date.now();
        const updated = applyDemoStage(recruit, targetStageId, flowChanges ?? {}, instant) as Recruit;
        setDemoRecords(rows => rows.map(item => item.id === recruit.id ? updated : item)); setNow(instant);
        setSaveNotice(`Demo: ${recruit.name} moved to ${destination}. HubSpot was not changed.`);
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
      const result = await saveRecruitStageWithRefresh(recruit, targetStageId, { signal: controller.signal, flowChanges,
        onRefreshed: fresh => setData(value => value ? { ...value, recruits: value.recruits.map(item => item.id === recruit.id ? preserveRecruiter(item, fresh as Recruit) : item) } : null),
      });
      setData(value => value ? { ...value, recruits: value.recruits.map(item => item.id === recruit.id ? preserveRecruiter(item, result.recruit as Recruit) : item) } : null);
      setNow(Date.now());
      setSaveNotice(`${recruit.name} moved to ${destination}. Saved to HubSpot.${result.recruit.lifecycleSync ? ` Contact stage: ${lifecycleStatusLabel(result.recruit.lifecycleSync.status)}.` : ""}`);
    } catch (caught) {
      if (caught instanceof StageSaveError && caught.status === 401) { expiredSignIn(); return; }
      const failure = caught instanceof StageSaveError ? caught : null;
      if (!failure || !["STAGE_REFRESH_FAILED", "STAGE_CHANGED_BEFORE_SAVE", "RECORD_CHANGED"].includes(failure.code)) {
        setStageBlockedIds(value => value.includes(recruit.id) ? value : [...value, recruit.id]);
      }
      setStageSaveError({ message: `${recruit.name}: ${failure?.message ?? "The stage change could not be confirmed. Refresh and check the recruit before trying again."}`,
        retryWithoutRefresh: Boolean(failure && ["STAGE_REFRESH_FAILED", "STAGE_CHANGED_BEFORE_SAVE", "RECORD_CHANGED"].includes(failure.code)),
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
    return <><div className="filterbar">{officeFilter}<label className="filter-field"><span className="sr-only">License status at intake</span><select className="select" value={intake} onChange={event => setIntake(event.target.value)}><option>All license statuses</option>{["Already Licensed", "In Progress", "Unlicensed", "Not recorded"].map(value => <option key={value}>{value}</option>)}</select></label>{(office !== "All offices" || intake !== "All license statuses" || query) && <button className="text-link" onClick={resetFilters}>Clear filters</button>}</div><div className="results-line"><span>{filtered.length}{filteredSuffix} recruit{filtered.length === 1 ? "" : "s"}{query && ` matching “${query}”`}</span><div className="view-switch" aria-label={route.view === "today" ? "Follow-up view" : "Recruit view"}><button className={`btn btn-quiet ${listView === "list" ? "selected" : ""}`} aria-pressed={listView === "list"} onClick={() => setListView("list")}>List</button><button className={`btn btn-quiet ${listView === "board" ? "selected" : ""}`} aria-pressed={listView === "board"} onClick={() => setListView("board")}>Board</button></div></div>{!filtered.length ? <Empty title="No matching recruits">No loaded recruits match these filters. Try another office, license status, or search. <button className="text-link" onClick={resetFilters}>Clear filters</button></Empty> : listView === "board" ? <div className="board">{boardStages.map(stage => <section className="board-column" key={stage.id}><h2>{stage.label}<span>{stage.records.length}</span></h2>{stage.records.map(recruit => <a className="board-item" href={`#recruit/${recruit.id}`} key={recruit.id} {...recruitHover.bind(recruit)}><strong>{recruit.name}</strong><span>{recruit.office}</span><small>{stageAge(recruit, timestamp)}</small></a>)}</section>)}</div> : <><div className="table-wrap"><table className="data-table"><thead><tr>{[["name","Recruit"],["phone","Phone"],["email","Email"],["recruiter","Recruiter"],["createdAt","Date added"],["office","Office"],["stage","Stage"],["timeInStage","Time in stage"],["lastContactedAt","Last contacted"]].map(([field,label]) => <th key={field} aria-sort={listSort.field === field ? listSort.direction === "asc" ? "ascending" : "descending" : "none"}><button className="column-sort" onClick={() => { setListSort(value => ({field,direction:value.field === field && value.direction === "asc" ? "desc" : "asc"})); setPage(1); }}>{label}{listSort.field === field && <span aria-hidden="true">{listSort.direction === "asc" ? " ↑" : " ↓"}</span>}</button></th>)}<th><span className="sr-only">Move stage</span></th><th className="communication-cell"><span className="sr-only">Contact tools</span></th></tr></thead><tbody>{shown.map(recruit => <tr key={recruit.id}><td><div className="recruit-row-person"><Person recruit={recruit} office={false} hover={recruitHover.bind(recruit)} /></div></td><td>{recruit.phone || "Not recorded"}</td><td>{recruit.email || "Not recorded"}</td><td>{recruit.recruiter || (recruit.recruiterStatus === "unassigned" ? "Not assigned" : "Unavailable")}</td><td>{dateLabel(recruit.createdAt)}</td><td>{recruit.office || "Not recorded"}</td><td><RecruitStageControls recruit={recruit} mode="select" canEdit={canEdit} disabled={stageControlsDisabled || stageBlockedIds.includes(recruit.id)} onChange={(stageId, flowChanges) => void changeStage(recruit, stageId, flowChanges)} /></td><td className="next-step">{stageAge(recruit, timestamp)}</td><td>{dateLabel(recruit.lastContactedAt ?? null)}</td><td><RecruitStageControls recruit={recruit} mode="arrows" canEdit={canEdit} disabled={stageControlsDisabled || stageBlockedIds.includes(recruit.id)} onChange={(stageId, flowChanges) => void changeStage(recruit, stageId, flowChanges)} /></td><td className="communication-cell"><div className="recruit-row-tools"><RecruitCommunications recruitName={recruit.name} recruitId={recruit.id} phone={recruit.phone} hubspotUrl={recruit.hubspotUrl} isDemo={recruit.isDemo} />{canEdit && !demoMode && !recruit.isDemo && <RecruitQuickActions recruitId={recruit.id} recruitName={recruit.name} />}</div></td></tr>)}</tbody></table></div><div className="pagination"><span>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}{filteredSuffix}</span><div><button className="btn btn-secondary" disabled={currentPage <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="btn btn-secondary" disabled={currentPage >= pageCount} onClick={() => setPage(value => value + 1)}>Next</button></div></div></>}</>;
  }

  // Live HubSpot panels under the pipeline. Demo data leaves them unloaded so fictional recruits never sit beside live records.
  function recruitsPagePanel(id: string) {
    const tool = id === "tasks" ? { id: "tasks", label: "Tasks" } : [...RECRUITS_PAGE_TOOLS, ...DASHBOARD_COMMUNICATION_TOOLS].find(item => item.id === id);
    if (!tool) return null;
    const pageHref = id === "calls" ? "#calls/standard" : HUBSPOT_TOOLS.some(item => item.id === id) || DASHBOARD_PAGES.includes(id) ? `#${id}` : undefined;
    if (demoMode) return <section className="today-panel" aria-labelledby={`today-${id}-title`}><div className="follow-up-heading" data-section-heading><h2 id={`today-${id}-title`}>{pageHref ? <a className="panel-title-link" href={pageHref}>{tool.label}</a> : tool.label}</h2><div className="panel-heading-actions"><SectionToggle /></div></div><p className="helper">This panel shows live HubSpot records. Demo recruits stay separate.</p><button className="btn btn-secondary" disabled={Boolean(editingId || stageSavingId)} onClick={() => switchDataMode(false)}>Use live data</button></section>;
    // Meetings shows five rows a page (up to 25 by choice); Calls shows ten; Tasks shows five with numbered pages and Add Task.
    // Tasks and Meetings rows stay collapsed until the pointer is over them; the full-width Calendar shows every
    // meeting in its day.
    const paging = id === "meetings" ? { pageSize: 5, pageSizes: [5, 10, 15, 20, 25], hoverRows: true, headerAction: meetingAction(id, "button") } : id === "calls" ? { pageSize: 10, headerAction: <NewCallButton /> } : id === "calendar" ? { headerAction: meetingAction(id, "button") }
      : id === "tasks" ? { pageSize: 5, pageNumbers: true, hoverRows: true, headerAction: canAddActivity ? <RecruitQuickActions kinds={["task"]} recruits={activityRecruits(all)} trigger="button" /> : undefined } : {};
    return <HubSpotWorkspace compact tool={tool.id} label={tool.label} pageHref={pageHref} onUnauthorized={expiredSignIn} {...paging} {...panelReports[tool.id]} />;
  }

  function content() {
    // Calls and Recruits open from their panel titles on the Recruits page, so their pages lead back there.
    // Add Recruits opens from its button on the dashboard, so it leads back there too.
    const dashboardLink = route.view !== "today" || route.id ? <div className="dashboard-back-row"><a className="text-link back-link" href="#today"><Icon name="back" />{NAV[0].label}</a></div> : null;
    if (route.view === "training-classes") return <>{dashboardLink}<TrainingClassesPage onUnauthorized={expiredSignIn} onDirtyChange={updateToolDirty} onBusyChange={updateToolBusy} /></>;
    if (route.view === "loa") return <>{dashboardLink}<iframe className="queue-workspace-frame" src="https://legacyportal.io/" title="LOA · Legacy Portal" /></>;
    if (queuePage) return <>{dashboardLink}<iframe key={queuePage.id} className="queue-workspace-frame" src="https://queue.lgcyap.com/embed" title="Shopper and Standard vs Preferred live queues" allow="fullscreen; screen-wake-lock" /></>;
    if (route.view === "admin") return <>{dashboardLink}<AdminDashboard embedded /></>;
    if (externalPage) return <>{dashboardLink}<ExternalWorkspace view={route.view} /></>;
    if (eventAttendanceView) return <>{dashboardLink}<iframe className="queue-workspace-frame" src="/event-attendance?embedded=1" title="Hiring event attendance" /></>;
    // Online applications are live HubSpot records, read for the admin team; demo data leaves them unloaded.
    if (applicationsView && demoMode) return <>{dashboardLink}{heading("Applications", "This page shows live online applications from HubSpot.", null)}<p className="helper">Demo recruits stay separate from these records.</p><button className="btn btn-primary" onClick={() => switchDataMode(false, "applications")}>Open live Applications</button></>;
    if (applicationsView) return <>{dashboardLink}<ApplicationsPage onUnauthorized={expiredSignIn} /></>;
    if (route.view === "calls" && !demoMode) return <>{dashboardLink}<CallsPage view={route.source ?? "shopper"} onSourceChange={source => { window.location.hash = `calls/${source}`; }} onUnauthorized={expiredSignIn} onDirtyChange={updateToolDirty} onBusyChange={updateToolBusy} /></>;
    if (route.view === "sales" && !demoMode) return <>{dashboardLink}<SalesPage onUnauthorized={expiredSignIn} onDirtyChange={updateToolDirty} onBusyChange={updateToolBusy} /></>;
    if (demoMode && hubspotTool) return <>{dashboardLink}{heading(hubspotTool.label, "This workspace uses live HubSpot records.", null)}<p className="helper">Demo recruits stay separate from these records.</p><button className="btn btn-primary" onClick={() => switchDataMode(false, hubspotTool.id)}>Open live {hubspotTool.label}</button></>;
    // Tasks opens from the dashboard's Tasks summary: HubSpot tasks assigned to you, with the same view and edits as other HubSpot pages.
    if (activityPage && demoMode) return <>{dashboardLink}{heading(activityPage.label, "This page shows live HubSpot records.", null)}<p className="helper">Demo recruits stay separate from these records.</p><button className="btn btn-primary" onClick={() => switchDataMode(false, activityPage.id)}>Open live {activityPage.label}</button></>;
    if (activityPage) return <>{dashboardLink}<HubSpotWorkspace key={activityPage.id} tool={activityPage.id} label={activityPage.label} description={activityPage.description} headerAction={activityPage.id === "tasks" && canAddActivity && data ? <RecruitQuickActions kinds={["task"]} recruits={activityRecruits(all)} trigger="button" /> : meetingAction(activityPage.id, "button")} onUnauthorized={expiredSignIn} onDirtyChange={updateToolDirty} onBusyChange={updateToolBusy} /></>;
    if (pathPage) return <>{dashboardLink}<RecruitPathPage key={`${pathPage.id}:${demoMode}`} view={pathPage.id} label={pathPage.label} demoRecords={demoMode ? recordsForStagePage(demoRecords, pathPage.id) as Recruit[] : undefined} onUnauthorized={expiredSignIn} /></>;
    if (callAnalyticsView) return <>{dashboardLink}<LeadData navigation={leaderboardSwitch} onUnauthorized={expiredSignIn} /></>;
    if (leaderboardView) return <>{dashboardLink}<Leaderboard navigation={leaderboardSwitch} onUnauthorized={expiredSignIn} /></>;
    if (hubspotTool && (!route.id || hubspotTool.id === "inbox")) return <>{dashboardLink}<HubSpotWorkspace key={`${hubspotTool.id}:${route.id ?? ""}`} tool={hubspotTool.id} initialThreadId={hubspotTool.id === "inbox" ? route.id : undefined} label={hubspotTool.label} description={hubspotTool.id === "help-desk" ? "Live support tickets from HubSpot’s Support Pipeline." : undefined} onUnauthorized={expiredSignIn} onDirtyChange={updateToolDirty} onBusyChange={updateToolBusy} /></>;
    if (route.view === "add-recruits" && demoMode) return <>{dashboardLink}{heading("Add Recruits", "Switch to live data to add real recruits to HubSpot.", null)}<p className="helper">Demo records are separate from HubSpot.</p><button className="btn btn-primary" onClick={() => switchDataMode(false, "add-recruits")}>Use live data</button></>;
    if (route.view === "add-recruits") return <>{dashboardLink}<AddRecruits canCreate={data?.capabilities?.canCreateRecruit === true && !error}
      checkingAccess={loading} onUnauthorized={expiredSignIn} onCreated={() => { void refresh(); }}
      onBusyChange={updateIntakeBusy} onDraftChange={updateIntakeDraft} /></>;
    if (!data) return <>{dashboardLink}{heading(pageName, "Your recruiting workspace", null)}{loading ? <section aria-label="Loading recruiting data" className="loading-state"><p role="status">Loading recruiting data from HubSpot…</p><div className="skeleton skeleton-stats" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /></section> : <Empty title={error?.code === "CONNECTION_NOT_CONFIGURED" ? "Recruiting data is not connected yet" : "Recruiting data is unavailable"}>{error?.signInPath ? "Sign in to continue, then refresh the workspace." : error?.code === "CONNECTION_NOT_CONFIGURED" ? "The live connection needs to be completed before recruits can appear here." : "Use Refresh to try loading your recruiting records again."}</Empty>}</>;
    if (route.view === "email") return <>{dashboardLink}<RecruitEmailPanel onUnauthorized={expiredSignIn} compact={false} recruits={all} onRefresh={demoMode ? undefined : () => { void refresh(); }} refreshing={loading} refreshDisabled={Boolean(error?.retryAt || stageSavingId || stageSaveError?.retryAt || editingId || intakeBusy || intakeDirty || toolBusy || toolDirty)} /></>;
    if (route.view === "follow-up") return <>{dashboardLink}<FollowUpPage records={all} now={timestamp} partial={data.partial} query={query} canAddActivity={canEdit && !demoMode} /></>;
    if (route.id) {
      if (!selected) return <>{dashboardLink}{heading("Recruit not in this view", "This recruit may have moved or may be outside the loaded results.", null)}<a href="#recruits" className="btn btn-secondary">Back to recruits</a></>;
      return <>{dashboardLink}<a className="text-link back-link" href={`#${selectedPage?.id ?? "recruits"}`}><Icon name="back" />{selectedPage?.label ?? "Recruits"}</a><div className="profile-header"><div className="person"><span className="avatar avatar-large" aria-hidden="true">{initials(selected.name)}</span><div><h1 id="page-title" className="page-title" tabIndex={-1}>{selected.name}</h1><p className="subheading">{selected.office} / {selected.stage}</p></div></div><div className="profile-actions"><RecruitCommunications recruitName={selected.name} recruitId={selected.id} phone={selected.phone} hubspotUrl={selected.hubspotUrl} isDemo={selected.isDemo} />{(canEdit || writeAccessPending) && <button className="btn btn-primary" disabled={!selected.editValues || !selected.updatedAt || loading || Boolean(stageSavingId)} onClick={() => { setSaveNotice(null); setEditingId(selected.id); }}>Edit recruit</button>}{!demoMode && <><CustomRecruitLink recruit={selected} /><HubSpotLink recruit={selected} /></>}</div></div>{editingRecruit && demoMode && <DemoRecruitEditor recruit={editingRecruit} onClose={() => setEditingId(null)} onSave={updated => { setDemoRecords(rows => rows.map(item => item.id === updated.id ? updated as Recruit : item)); setEditingId(null); setSaveNotice("Demo contact updated. HubSpot was not changed."); }} />}{editingRecruit && !demoMode && <RecruitEditor embedded recruit={editingRecruit} canEdit={canEdit} writeAccessPending={writeAccessPending} onClose={() => setEditingId(null)} onSaved={savedRecruit} onUnauthorized={expiredSignIn} onReload={async () => { const latest = await refresh(); return latest?.recruits.find(recruit => recruit.id === editingId) ?? null; }} />}<div className="profile-grid"><div><section className="profile-section"><p className="muted">Current stage</p><h2 className="stage-headline">{selected.stage}</h2><p className="helper">{stageAge(selected, timestamp)}</p>{!demoMode && selected.customRecruitSync && <p className="helper" role="status"><strong>Recruit sync:</strong> {customSyncLabel(selected.customRecruitSync.status)}{selected.customRecruitSync.checkedAt && <> · Checked {dateLabel(selected.customRecruitSync.checkedAt)}</>}</p>}{!demoMode && selected.lifecycleSync && <p className="helper" role="status"><strong>Contact stage sync:</strong> {lifecycleStatusLabel(selected.lifecycleSync.status)}{selected.lifecycleSync.checkedAt && <> · Checked {dateLabel(selected.lifecycleSync.checkedAt)}</>}</p>}{reviewSuggested(selected, timestamp) && <p className="review-note">Review suggested: at least five days in this stage.</p>}</section><section className="profile-section"><h2 className="section-title">Recruiting progress</h2><Flags recruit={selected} /><p className="helper">{demoMode ? "Fictional demo progress. These values are separate from HubSpot." : "These are the values recorded in HubSpot. Intake status is not license verification, and appointment creation is not carrier approval."}</p></section></div><aside className="profile-aside"><h2 className="section-title">Recruit details</h2><dl className="details-list"><dt>First name</dt><dd>{selected.firstName || "Not recorded"}</dd><dt>Last name</dt><dd>{selected.lastName || "Not recorded"}</dd><dt>Phone</dt><dd>{selected.phone || "Not recorded"}</dd><dt>Email</dt><dd>{selected.email || "Not recorded"}</dd><dt>Recruiter</dt><dd>{selected.recruiter || (selected.recruiterStatus === "unassigned" ? "Not assigned" : "Unavailable")}</dd><dt>Last contacted</dt><dd>{dateLabel(selected.lastContactedAt ?? null)}</dd><dt>Office</dt><dd>{selected.office}</dd><dt>Recruiting path</dt><dd>{PATH_LABELS[selected.recruitingPath] ?? "Not recorded"}</dd><dt>Licensing branch</dt><dd>{LICENSE_LABELS[selected.licenseRoute] ?? "Not chosen"}</dd><dt>License status at intake</dt><dd>{selected.intake}</dd><dt>Recruit type</dt><dd>{selected.recruitType}</dd><dt>Orientation date</dt><dd>{dateLabel(selected.orientationDate)}</dd><dt>Entered current stage</dt><dd>{dateLabel(selected.enteredStageAt)}</dd><dt>{demoMode ? "Last demo update" : "Last updated in HubSpot"}</dt><dd>{dateLabel(selected.updatedAt)}</dd></dl><p className="helper">{demoMode ? "Demo edits stay in this app. No HubSpot records are changed." : canEdit ? "Use Edit recruit to save updates directly to HubSpot. Open HubSpot for tasks and other record details." : writeAccessPending ? "Saving is disabled in this workspace. You can preview the editor." : "This workspace is read-only. Open HubSpot to update a recruit or create a task."}</p></aside></div><RecruitActivity key={selected.id} recruitId={selected.id} isDemo={demoMode} /></>;
    }
    if (route.view === "today") {
      const followUpChoices = activityRecruits(all, { now: timestamp, followUpFirst: true });
      // Each summary's hover pop-up also offers Add Note, Add Task, Add Follow-Up, Add Meeting and Add to Calendar.
      const previewActions = canAddActivity ? <AddActivityButtons recruits={activityRecruits(all)} /> : undefined;
      return <>
      {query.trim() && <p className="pipeline-search-note" role="status">Showing matches for “{query.trim()}”. <button className="text-link" onClick={() => setQuery("")}>Clear search</button></p>}
      {/* Top to bottom: the recruiting pipeline, collapsed, holding the reporting period (Weekly), its totals and Add Recruits,
          Recruits and Agents; the Tasks, Follow up, Meetings, Calendar and Email cards; Event Attendance; then the full panels,
          one per row. Every section and card collapses from the chevron at the right of its title, remembered in this browser. */}
      <h1 id="page-title" className="sr-only" tabIndex={-1}>Recruiting Dashboard</h1>
      <details className="dashboard-pipeline"><summary>Recruiting pipeline</summary><div className="dashboard-pipeline-body">
      <RecruitingPeriodControls headingLevel={2} records={periodSource} stages={STAGE_PAGES} selection={periodSelection} onSelectionChange={setPeriodSelection} now={now ? new Date(now).toISOString() : undefined} partial={data.partial} actions={<div className="dashboard-actions"><a className="btn btn-primary add-recruits-button" href="#add-recruits"><Icon name="add-person" />Add Recruits</a><a className="btn btn-secondary" href="#recruits"><Icon name="people" />Recruits</a><a className="btn btn-secondary" href="#contract-agents"><Icon name="people" />Agents</a></div>} />
      <RecruitPipeline records={periodRecords} stages={STAGE_PAGES} partial={data.partial} now={timestamp} canEdit={canEdit} disabled={stageControlsDisabled} pendingId={stageSavingId} blockedIds={stageBlockedIds} onNavigate={view => { setQuery(""); window.location.hash = view; }} onStageChange={(recruit, stageId, flowChanges) => { const current = all.find(item => item.id === recruit.id); if (current) void changeStage(current, stageId, flowChanges); }} /></div></details>
      <CollapsibleCards><div className="today-summaries">
        <RecruitTaskChips live={!demoMode} now={timestamp} onUnauthorized={expiredSignIn} lead={canAddActivity ? <RecruitQuickActions kinds={["task"]} recruits={activityRecruits(all)} trigger="plus" /> : undefined} previewActions={previewActions} />
        <RecruitFollowUpChips records={all} now={timestamp} partial={data.partial} canAddActivity={canAddActivity} lead={canAddActivity ? <RecruitQuickActions kinds={["follow-up"]} recruits={followUpChoices} trigger="plus" /> : undefined} previewActions={previewActions} />
        <RecruitMeetingChips live={!demoMode} now={timestamp} onUnauthorized={expiredSignIn} meetingLead={meetingAction("meetings", "plus")} calendarLead={meetingAction("calendar", "plus")} previewActions={previewActions} />
        <RecruitEmailSummary recruits={all} />
        <SupportSummary tool="inbox" live={!demoMode} onUnauthorized={expiredSignIn} />
        <SupportSummary tool="help-desk" live={!demoMode} onUnauthorized={expiredSignIn} />
        <SupportSummary tool="tickets" live={!demoMode} onUnauthorized={expiredSignIn} />
      </div></CollapsibleCards>
      {/* Live hiring-event counts, like the HubSpot panels below: Demo data leaves them unloaded. */}
      <DashboardSection id="event-attendance" label="Event Attendance" className="today-attendance">{demoMode ? <section className="today-panel" aria-labelledby="today-event-attendance-title"><div className="follow-up-heading" data-section-heading><h2 id="today-event-attendance-title"><a className="panel-title-link" href="#event-attendance">Event Attendance</a></h2><div className="panel-heading-actions"><SectionToggle /></div></div><p className="helper">This section shows live HubSpot counts. Demo recruits stay separate.</p><button className="btn btn-secondary" disabled={Boolean(editingId || stageSavingId)} onClick={() => switchDataMode(false)}>Use live data</button></section> : <EventAttendanceBoard section recruits={all} canAddActivity={canAddActivity} now={timestamp} />}</DashboardSection>
      {/* Stacked, one per row: Recruits, Calls, Tasks, Follow up, Meetings, Calendar, Email, Inbox, Help Desk, then Tickets. */}
      <div className="today-overview">
        <DashboardSection id="recruits" label="Recruits"><RecruitsPanel headerAction={<button type="button" className="summary-add" title="Add recruit" aria-label="Add recruit" disabled={demoMode || Boolean(editingId || stageSavingId || intakeBusy || intakeDirty || toolBusy || toolDirty)} onClick={() => { window.location.hash = "add-recruits"; }}><span aria-hidden="true">+</span><span className="sr-only">Add recruit</span></button>} onRefresh={demoMode ? undefined : () => { void refresh(); }} refreshing={loading} refreshDisabled={Boolean(error?.retryAt || stageSavingId || stageSaveError?.retryAt || editingId || intakeBusy || intakeDirty || toolBusy || toolDirty)} showHubSpotLink={!demoMode} records={all} partial={data.partial} canAddActivity={canAddActivity} now={timestamp} canEdit={canEdit} disabled={stageControlsDisabled} blockedIds={stageBlockedIds} onStageChange={(recruit, stageId, flowChanges) => { const current = all.find(item => item.id === recruit.id); if (current) void changeStage(current, stageId, flowChanges); }} /></DashboardSection>
        <DashboardSection id="calls" label="Calls">{recruitsPagePanel("calls")}</DashboardSection>
        <DashboardSection id="tasks" label="Tasks">{recruitsPagePanel("tasks")}</DashboardSection>
        <DashboardSection id="follow-up" label="Follow up"><FollowUpPanel records={all} now={timestamp} partial={data.partial} canAddActivity={canAddActivity} recruits={followUpChoices} /></DashboardSection>
        <DashboardSection id="meetings" label="Meetings">{recruitsPagePanel("meetings")}</DashboardSection>
        <DashboardSection id="calendar" label="Calendar">{recruitsPagePanel("calendar")}</DashboardSection>
        <DashboardSection id="email" label="Email"><RecruitEmailPanel onUnauthorized={expiredSignIn} recruits={all} onRefresh={demoMode ? undefined : () => { void refresh(); }} refreshing={loading} refreshDisabled={Boolean(error?.retryAt || stageSavingId || stageSaveError?.retryAt || editingId || intakeBusy || intakeDirty || toolBusy || toolDirty)} /></DashboardSection>
        <DashboardSection id="inbox" label="Inbox">{recruitsPagePanel("inbox")}</DashboardSection>
        <DashboardSection id="help-desk" label="Help Desk">{recruitsPagePanel("help-desk")}</DashboardSection>
        <DashboardSection id="tickets" label="Tickets">{recruitsPagePanel("tickets")}</DashboardSection>
      </div>
    </>;
    }
    return <>{dashboardLink}{heading(stagePage?.label ?? "Recruits", route.view === "recruits" ? "Recruiting records connected to your HubSpot recruiting pipeline." : `Recruiting records in ${stagePage?.label ?? "Recruits"}`, !demoMode && route.view === "recruits" ? <RecruitsHubSpotLink /> : null)}{collectionContent()}</>;
  }

  // Queue shares the hash navigation and unsaved-edit protection of other workspace pages.
  const statusBar = <div className="source-bar" hidden={leaderboardView || embeddedView || Boolean(activityPage) || Boolean(pathPage) || applicationsView}><div className="source-summary"><span className="live-badge"><span aria-hidden="true" />{demoMode ? "Demo · Local changes" : "Private"} · {hubspotTool ? "Connected HubSpot workspace" : route.view === "add-recruits" ? (data?.capabilities?.canCreateRecruit ? "Recruit entry enabled" : "Read-only") : (canEdit ? "Editing enabled" : "Read-only")}</span><span>{demoMode ? `${DEMO_RECRUIT_COUNT} fictional Test recruits · No HubSpot changes` : hubspotTool ? `HubSpot ${hubspotTool.label}` : "HubSpot Recruiting"}</span>{!hubspotTool && !leaderboardView && !embeddedView && !pathPage && data && <span className="updated-at">Updated {updatedLabel(data.fetchedAt)}</span>}</div>{!hubspotTool && !leaderboardView && !embeddedView && !pathPage && <button className="btn refresh-button" disabled={loading || Boolean(error?.retryAt || stageSavingId || stageSaveError?.retryAt || editingId || intakeBusy || intakeDirty)} onClick={() => { if (demoMode) { const instant = Date.now(); setDemoRecords(createDemoRecruits(instant) as Recruit[]); setNow(instant); setSaveNotice("Demo records reset."); } else void refresh(); }}><Icon name="refresh" />{loading ? "Loading…" : demoMode ? "Reset demo" : "Refresh"}</button>}</div>;
  return <RecruitEmailProvider recruits={all} disabled={demoMode}><RingCentralPanel clientId={ringCentralClientId} isDemo={demoMode}><WorkspaceViewControl onHideChrome={() => { restoreMenuFocus.current = false; focusPageAfterNav.current = false; setMenuOpen(false); dismissNav(); }} /><WorkspaceTitlebar demo={demoMode} demoRecords={demoRecords} modeDisabled={Boolean(editingId || stageSavingId || intakeDirty || intakeBusy || toolDirty || toolBusy)} searchDisabled={Boolean(editingId || stageSavingId)} menuOpen={menuOpen} activeView={activeView} onModeChange={switchDataMode} onNavigate={navigateFromMenu} onSupportNavigate={id => { if (demoMode) switchDataMode(false, id); navigateFromMenu(); }} onUnauthorized={expiredSignIn} /><div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}><a href="#main" className="skip-link sr-only" onClick={event => { event.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a><aside ref={sidebarRef} className={`sidebar ${menuOpen ? "is-open" : ""}`} id="main-sidebar" aria-label="Main navigation"><button className="desktop-sidebar-close btn btn-quiet" ref={sidebarCloseRef} aria-label="Collapse sidebar" aria-controls="main-sidebar" onClick={() => { setSidebarCollapsed(true); requestAnimationFrame(() => desktopMenuRef.current?.focus()); }}><Icon name="back" /></button><a className="brand" href="#today" onClick={navigateFromMenu}><Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners home" width="164" height="107" /></a><button className="mobile-close btn btn-quiet" onClick={closeMenu} aria-label="Close navigation"><Icon name="close" /></button><nav aria-label="Recruiting workspace">{navigation}</nav><div className="sidebar-bottom"><div className="sidebar-bottom-link"><a className="nav-link" href="#loa" aria-current={route.view === "loa" ? "page" : undefined} onClick={() => { dismissNav(); navigateFromMenu(); }}><Icon name="file" /><span>LOA</span></a></div><div className="nav-group" onMouseEnter={() => enterNav("admin")} onMouseLeave={leaveNav}>
      <div className="admin-menu-trigger"><a className="nav-link nav-group-toggle" href="#admin" aria-current={sidebarView === "admin" ? "page" : undefined} aria-expanded={(hoveredNav ?? expandedNav) === "admin"} aria-controls="admin-links" onKeyDown={event => focusFlyout(event, "admin-links", "admin")} onClick={navigateFromMenu}><Icon name="gear" /><span>Admin</span><span className="sr-only"> dashboard</span></a><button type="button" className="btn btn-quiet admin-menu-toggle" aria-label="Show admin destinations" aria-expanded={(hoveredNav ?? expandedNav) === "admin"} aria-controls="admin-links" onClick={() => { const open = (hoveredNav ?? expandedNav) === "admin"; setHoveredNav(null); setExpandedNav(open ? null : "admin"); }}><Icon name="chevron" /></button></div>
      <SidebarFlyout id="admin-links" hidden={(hoveredNav ?? expandedNav) !== "admin"} layoutKey={`${menuOpen}:${sidebarCollapsed}`} onDismiss={dismissNav} onEnter={() => enterNav("admin")} onLeave={leaveNav}>{ADMIN_PAGES.map(item => <a className="nav-link admin-destination" key={item.id} href={item.id === "google-admin" ? item.url : `#${item.id}`} target={item.id === "google-admin" ? "_blank" : undefined} rel={item.id === "google-admin" ? "noopener noreferrer" : undefined} aria-current={route.view === item.id ? "page" : undefined} onClick={navigateFromMenu}><span>{item.label}<small>{item.detail}</small></span></a>)}</SidebarFlyout>
    </div><div className="sidebar-bottom-link"><a className="nav-link" href="#knowledge-center" aria-current={sidebarView === "knowledge-center" ? "page" : undefined} onClick={() => { dismissNav(); navigateFromMenu(); }}><Icon name="file" /><span>Knowledge Center</span></a></div><a className="signout-link" href="/sign-out" target="_top">Sign out</a><p className="sidebar-note">Legacy Agency Partners<br />Private recruiting workspace</p></div></aside>{menuOpen && <button className="mobile-backdrop" onClick={closeMenu} aria-label="Close navigation" tabIndex={-1} />}<div className="workspace without-topbar" inert={menuOpen}>{/* Floating gold arrows reopen the navigation: a collapsed sidebar on desktop, the slide-out menu on phones. */}<button type="button" className="sidebar-fab sidebar-fab-desktop" ref={desktopMenuRef} hidden={!sidebarCollapsed} aria-label="Expand sidebar" aria-controls="main-sidebar" aria-expanded={false} onClick={() => { setSidebarCollapsed(false); requestAnimationFrame(() => sidebarCloseRef.current?.focus()); }}><Icon name="forward" /></button><button type="button" className="sidebar-fab sidebar-fab-mobile" ref={menuRef} aria-label="Open navigation" aria-controls="main-sidebar" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon name="forward" /></button>{!(route.view === "today" && !route.id) && statusBar}{((!hubspotTool && !leaderboardView && !embeddedView && !pathPage) || error?.signInPath) && error && <DismissibleNotice className={`connection-alert ${data ? "stale-alert" : ""}`} role="alert"><strong>{data ? "Showing previously loaded data" : "Live data unavailable"}</strong><p>{error.message}{data && ` Last successful refresh: ${updatedLabel(data.fetchedAt)}.`}</p>{error.retryAt && <p>Try again after {new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(error.retryAt))}.</p>}{error.signInPath && <a className="btn btn-primary" href={error.signInPath} target="_top">Sign in</a>}</DismissibleNotice>}{!demoMode && data?.customRecruitSync?.status && !["synced", "busy"].includes(data.customRecruitSync.status) && <DismissibleNotice className="connection-alert" role="status"><strong>Recruit sync needs attention</strong><p>Some HubSpot Recruit updates are waiting for confirmation or review. Check the recruit profile for its current sync status.</p></DismissibleNotice>}{stageSavingId && <DismissibleNotice className="save-notice" role="status">Saving stage to HubSpot…</DismissibleNotice>}{stageSaveError && <DismissibleNotice className="connection-alert" role="alert"><strong>Stage change needs attention</strong><p>{stageSaveError.message}</p><p>{stageSaveError.retryWithoutRefresh ? "Review the recruit and drag again. Its data will refresh automatically." : "Use Refresh to load the latest record before another attempt."}</p></DismissibleNotice>}{saveNotice && <DismissibleNotice className="save-notice" role="status"><span>{saveNotice}</span></DismissibleNotice>}{!hubspotTool && !leaderboardView && !embeddedView && !pathPage && data?.partial && <DismissibleNotice className="partial-notice" role="status">Showing {data.loadedCount} of {data.total} recruiting records. Counts and filters below cover the loaded records.</DismissibleNotice>}{!hubspotTool && !leaderboardView && !embeddedView && !pathPage && unmapped.length > 0 && <DismissibleNotice className="connection-alert" role="status"><strong>{unmapped.length} recruiting record{unmapped.length === 1 ? " has" : "s have"} an unrecognized stage</strong><p>These records use a retired or unrecognized stage. Review their path and stage in HubSpot before moving them.</p><div className="unmapped-record-links">{unmapped.map(recruit => <a className="text-link" href={`#recruit/${recruit.id}`} key={recruit.id}>Review {recruit.name}</a>)}</div></DismissibleNotice>}<main id="main" className={route.view === "today" && !route.id ? "content dashboard-content" : route.view === "sales" || route.view === "calls" ? "content sales-calls-content" : "content"} ref={mainRef} tabIndex={-1} aria-busy={leaderboardView || embeddedView ? undefined : loading}>{route.view === "today" && !route.id && <div className="dashboard-toolbar">{statusBar}<ExpandCollapseControls /></div>}{content()}{recruitHover.card}</main></div></div></RingCentralPanel></RecruitEmailProvider>;
}




