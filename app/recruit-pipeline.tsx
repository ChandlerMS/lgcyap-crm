"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LICENSE_ROUTES, RECRUITING_PATHS } from "../lib/recruiting-flow.mjs";
import RecruitCommunications from "./recruit-communications";
import RecruitStageControls, { type StageFlowChanges } from "./recruit-stage-controls";
import { stageSnapshotAvailable } from "./recruit-stage-save.mjs";
import { besideAnchorPosition, pipelineAge, pipelineDropChoice, popoutPosition, sortPipelineRecruits } from "./recruit-pipeline-actions.mjs";
import styles from "./recruit-pipeline.module.css";

export type PipelineRecruit = {
  isDemo?: boolean;
  id: string; name?: string; stageId?: string; stageKey?: string; stage?: string;
  firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null;
  recruitingPath?: string | null; licenseRoute?: string | null; office?: string | null;
  recruiter?: string | null; createdAt?: string | null; enteredStageAt?: string | null;
  recruiterStatus?: string; intake?: string | null; recruitType?: string | null; orientationDate?: string | null;
  lastContactedAt?: string | null; hubspotUrl?: string; updatedAt?: string | null; editValues?: Record<string, string>;
};
export type PipelineStage = { id: string; key?: string; stageId?: string; label: string };
type Props = {
  records: readonly PipelineRecruit[]; stages: readonly PipelineStage[]; partial?: boolean;
  now?: number; canEdit?: boolean; disabled?: boolean; blockedIds?: readonly string[]; pendingId?: string | null;
  onNavigate?: (view: string) => void;
  onStageChange?: (recruit: PipelineRecruit, stageId: string, flowChanges?: StageFlowChanges) => void;
};
type Key = "hiring-event" | "application" | "phone-interview" | "offer" | "licensing-reminders" | "licensed-npn" | "contracting" | "training" | "completed" | "withdrawn";
type Target = { stageId: string; recruitingPath?: string; licenseRoute?: string; allowDrop?: boolean };
type Item = { recruit: PipelineRecruit; key: string };
type CardOptions = { titleLabel?: string; nodeKey?: string; path?: string; route?: string; records?: PipelineRecruit[]; view?: string; subtitle?: string; allowDrop?: boolean };
const LABELS: Record<Key, string> = {
  "hiring-event": "Hiring Event", application: "Application", "phone-interview": "Phone Interview", offer: "Offer",
  "licensing-reminders": "Licensing Reminders", "licensed-npn": "Licensed w/ NPN", contracting: "Contracting", training: "Training", completed: "Completed", withdrawn: "Withdrawn",
};
const PRE_OFFER = new Set<string>(["hiring-event", "application", "phone-interview"]);
const KNOWN = new Set<string>(Object.keys(LABELS));
const SORT_FIELDS = [["firstName", "First name"], ["lastName", "Last name"], ["phone", "Phone"], ["email", "Email"], ["recruiter", "Recruiter"], ["stage", "Stage"], ["timeInStage", "Time in stage"], ["lastContactedAt", "Last contacted"]];
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
function canonicalKey(value: string | undefined) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  return key === "licensed-with-npn" ? "licensed-npn" : key;
}
function dateLabel(value: string | null | undefined) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? DATE_FORMAT.format(timestamp) : "Not recorded";
}
function recordHref(record: PipelineRecruit) {
  return typeof record.id === "string" && /^[1-9]\d{0,29}$/.test(record.id) ? `#recruit/${encodeURIComponent(record.id)}` : "#today";
}
function recruitName(recruit: PipelineRecruit) {
  return [recruit.firstName, recruit.lastName].filter(Boolean).join(" ") || recruit.name || `Recruit ${recruit.id}`;
}
function recruiterLabel(recruit: PipelineRecruit) {
  return recruit.recruiter || (recruit.recruiterStatus === "unassigned" ? "Not assigned" : recruit.recruiterStatus === "unavailable" || recruit.recruiterStatus === "not-found" ? "Unavailable" : "Not recorded");
}
const PATH_NAMES: Record<string, string> = RECRUITING_PATHS;
const ROUTE_NAMES: Record<string, string> = LICENSE_ROUTES;
type HoverAnchor = { id: string; top: number; right: number; bottom: number; left: number };

/** Details and quick contact actions for one recruit, shown beside its name on hover or keyboard focus. */
function RecruitHoverCard({ recruit, anchor, id, now, stageLabel, hint, onPointerEnter, onPointerLeave }: { recruit: PipelineRecruit; anchor: HoverAnchor; id: string; now: number; stageLabel: string; hint: string; onPointerEnter: () => void; onPointerLeave: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    setPosition(besideAnchorPosition(anchor, { width: card.offsetWidth, height: card.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }));
  }, [anchor]);
  const name = recruitName(recruit);
  const path = recruit.recruitingPath ? PATH_NAMES[recruit.recruitingPath] ?? "Not recorded" : "Not recorded";
  const route = recruit.licenseRoute ? ROUTE_NAMES[recruit.licenseRoute] ?? "Not chosen" : "Not chosen";
  const rows: [string, string][] = [
    ["Phone", recruit.phone || "Not recorded"],
    ["Email", recruit.email || "Not recorded"],
    ["Recruiter", recruiterLabel(recruit)],
    ["Office", recruit.office || "Not recorded"],
    ["Recruiting path", path],
    ["Licensing branch", route],
    ...(recruit.intake ? [["License at intake", recruit.intake] as [string, string]] : []),
    ["Time in stage", pipelineAge(recruit.enteredStageAt, now)],
    ["Entered stage", dateLabel(recruit.enteredStageAt)],
    ["Last contacted", dateLabel(recruit.lastContactedAt)],
    ["Added", dateLabel(recruit.createdAt)],
  ];
  return createPortal(<div ref={cardRef} id={id} role="group" aria-label={`Details for ${name}`} className={styles.hoverCard} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}
    style={position ? { top: position.top, left: position.left } : { top: anchor.top, left: anchor.right + 12, visibility: "hidden" }}>
    <p className={styles.hoverName}>{name}</p>
    <p className={styles.hoverStage}><span>{recruit.stage || stageLabel}</span>{recruit.recruitingPath ? <span>{path}</span> : <span className={styles.hoverWarning}>Path not recorded</span>}</p>
    <div className={styles.hoverActions}><RecruitCommunications labeled recruitName={name} recruitId={recruit.id} phone={recruit.phone} hubspotUrl={recruit.hubspotUrl ?? ""} isDemo={recruit.isDemo} /></div>
    <dl className={styles.hoverDetails}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {hint && <p className={styles.hoverHint}>{hint}</p>}
  </div>, document.body);
}
/**
 * A floating, non-modal panel with a stage's recruits in a large grid. It follows its stage while the
 * page scrolls and closes when the window loses focus, on Escape, on an outside click, or on navigation.
 */
function StagePopout({ id, anchor, toggle, title, subtitle, count, columns, tools, onClose, children }: {
  id: string; anchor: HTMLElement; toggle: HTMLElement | null; title: string; subtitle?: string; count: number; columns: number;
  tools: ReactNode; onClose: (returnFocus: boolean) => void; children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const titleId = `${id}-title`;
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      const panel = panelRef.current;
      if (!anchor.isConnected) { onClose(false); return; }
      if (!panel) return;
      setPosition(popoutPosition(anchor.getBoundingClientRect(), { width: panel.offsetWidth, height: panel.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }));
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    place();
    const observer = new ResizeObserver(schedule);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("scroll", schedule, true); window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); };
  }, [anchor, onClose]);
  // The panel is hidden until it is measured and placed, and a hidden element cannot take focus.
  const placed = position !== null;
  useEffect(() => { if (placed) panelRef.current?.focus({ preventScroll: true }); }, [placed]);
  useEffect(() => {
    const lostFocus = () => onClose(false);
    const hidden = () => { if (document.visibilityState === "hidden") onClose(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(true); } };
    // A press on this stage itself is left to its own click handler, which toggles the panel closed.
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !anchor.contains(target)) onClose(false);
    };
    window.addEventListener("blur", lostFocus); window.addEventListener("hashchange", lostFocus);
    document.addEventListener("visibilitychange", hidden); document.addEventListener("keydown", escape); document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("blur", lostFocus); window.removeEventListener("hashchange", lostFocus);
      document.removeEventListener("visibilitychange", hidden); document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside, true);
    };
  }, [anchor, onClose]);
  const width = columns * 280 + (columns - 1) * 16 + 48;
  return createPortal(<div ref={panelRef} id={id} role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1} className={styles.popout}
    style={{ width: `min(${width}px, calc(100vw - 32px))`, ...(position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: "hidden" }) }}>
    <header className={styles.popoutHeader}>
      <div className={styles.popoutHeading}><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <span className={styles.popoutCount}>{count} recruit{count === 1 ? "" : "s"}</span>
      <div className={styles.popoutTools}>{tools}<button type="button" className={styles.popoutClose} aria-label={`Close ${title}`} onClick={() => onClose(Boolean(toggle))}>×</button></div>
    </header>
    <div className={styles.popoutBody}>{children}</div>
  </div>, document.body);
}

function stageAtPoint(x: number, y: number): { target: Target; key: string } | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pipeline-stage-target]");
  if (!element || element.closest("[inert]")) return null;
  return { key: element.dataset.targetKey ?? "", target: { stageId: element.dataset.stageId ?? "", allowDrop: element.dataset.allowDrop !== "false", ...(element.dataset.recruitingPath ? { recruitingPath: element.dataset.recruitingPath } : {}), ...(element.dataset.licenseRoute ? { licenseRoute: element.dataset.licenseRoute } : {}) } };
}

function RecruitStack({ children }: { children: ReactNode }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const resize = () => {
      const entries = [...list.children] as HTMLElement[];
      if (entries.length <= 10) { list.style.maxHeight = "360px"; return; }
      const first = entries[0].getBoundingClientRect(), tenth = entries[9].getBoundingClientRect();
      list.style.maxHeight = `${Math.min(360, Math.ceil(tenth.bottom - first.top + 2))}px`;
    };
    const observer = new ResizeObserver(resize);
    [...list.children].slice(0, 10).forEach(child => observer.observe(child));
    resize();
    return () => observer.disconnect();
  }, [children]);
  return <div ref={listRef} className={styles.recruits}>{children}</div>;
}

function PipelineConnectors() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => {
    const flow = svgRef.current?.parentElement;
    if (!flow) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = flow.getBoundingClientRect();
        const scale = bounds.width / flow.offsetWidth || 1;
        const nodes = new Map([...flow.querySelectorAll<HTMLElement>("[data-stage-view]")].map(node => [node.dataset.stageView, node.querySelector("header")?.getBoundingClientRect()]));
        const edges = [
          ["genpop-hiring-event", "genpop-application"], ["genpop-application", "genpop-phone-interview"], ["genpop-phone-interview", "offer"],
          ["mass-application", "mass-phone-interview"], ["mass-phone-interview", "mass-hiring-event"], ["mass-hiring-event", "offer"],
          ["offer", "licensed-branch"], ["licensed-branch", "licensed-contracting"], ["offer", "licensing-reminders"], ["licensing-reminders", "licensed-npn"],
          ["licensed-npn", "unlicensed-contracting"], ["licensed-contracting", "training"], ["unlicensed-contracting", "training"],
          ["training", "completed"],
        ];
        setPaths(edges.flatMap(([from, to]) => {
          const a = nodes.get(from), b = nodes.get(to);
          if (!a || !b) return [];
          const x1 = (a.right - bounds.left) / scale, y1 = (a.top + a.height / 2 - bounds.top) / scale;
          const x2 = (b.left - bounds.left) / scale, y2 = (b.top + b.height / 2 - bounds.top) / scale;
          const middle = (x1 + x2) / 2;
          return [`M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`];
        }));
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(flow);
    flow.querySelectorAll("[data-stage-view]").forEach(node => observer.observe(node));
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", measure); };
  }, []);
  return <svg ref={svgRef} className={styles.connectors} aria-hidden="true">{paths.map((path, i) => <path key={i} d={path} />)}</svg>;
}

/** Responsive stage rows preserve recruiting paths and validated recruit moves. */
export default function RecruitPipeline({ records, stages, partial = false, now = 0, canEdit = false, disabled = false, blockedIds = [], pendingId = null, onNavigate, onStageChange }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ pointerId: number; x: number; y: number; scroll: number; moved: boolean } | null>(null);
  const recordDragRef = useRef<{ pointerId: number; id: string; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const pipelineId = useId();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sorts, setSorts] = useState<Record<string, { key: string; direction: "asc" | "desc" }>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null);
  const [dropHover, setDropHover] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [hovered, setHovered] = useState<HoverAnchor | null>(null);
  const hoverTimerRef = useRef(0);
  const hoverCardId = `${pipelineId}-recruit-details`;
  const [popout, setPopout] = useState<{ key: string; anchor: HTMLElement; toggle: HTMLElement | null } | null>(null);
  const popoutId = `${pipelineId}-stage-popout`;
  const closePopout = useCallback((returnFocus: boolean) => {
    const toggle = popout?.toggle;
    setPopout(null);
    if (returnFocus && toggle?.isConnected) toggle.focus({ preventScroll: true });
  }, [popout]);
  useEffect(() => () => window.clearTimeout(hoverTimerRef.current), []);
  useEffect(() => {
    if (!hovered) return;
    const hide = () => setHovered(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    window.addEventListener("scroll", hide, true); window.addEventListener("resize", hide); window.addEventListener("blur", hide); document.addEventListener("keydown", escape);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); window.removeEventListener("blur", hide); document.removeEventListener("keydown", escape); };
  }, [hovered]);
  useEffect(() => {
    if (!draggedId || !canEdit || disabled || pendingId || blockedIds.includes(draggedId)) return;
    let frame = 0;
    const tick = () => {
      const drag = recordDragRef.current, viewport = viewportRef.current;
      const recruit = records.find(record => record.id === draggedId);
      if (!drag || !viewport || !recruit) return;
      const bounds = viewport.getBoundingClientRect();
      const control = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>("[data-carousel-scroll]")?.dataset.carouselScroll;
      const direction = control === "-1" ? -1 : control === "1" ? 1 : drag.y >= bounds.top && drag.y <= bounds.bottom ? drag.x < bounds.left + 55 ? -1 : drag.x > bounds.right - 55 ? 1 : 0 : 0;
      if (direction) {
        viewport.scrollLeft += direction * 12;
        const destination = stageAtPoint(drag.x, drag.y);
        setDropHover(destination && pipelineDropChoice(recruit, destination.target) ? destination.key : null);
      }
      const verticalDirection = drag.y < 100 ? -1 : drag.y > window.innerHeight - 80 ? 1 : 0;
      if (verticalDirection) {
        window.scrollBy(0, verticalDirection * 12);
        const destination = stageAtPoint(drag.x, drag.y);
        setDropHover(destination && pipelineDropChoice(recruit, destination.target) ? destination.key : null);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draggedId, canEdit, disabled, pendingId, blockedIds, records]);
  const unique = [...new Map(records.map(record => [record.id, record])).values()];
  const items: Item[] = unique.map(recruit => {
    const stage = stages.find(item => item.stageId && item.stageId === recruit.stageId);
    return { recruit, key: canonicalKey(stage ? stage.key ?? stage.id : recruit.stageKey) };
  });
  const label = (key: Key) => stages.find(stage => canonicalKey(stage.key ?? stage.id) === key)?.label ?? LABELS[key];
  const stageId = (key: Key) => stages.find(stage => canonicalKey(stage.key ?? stage.id) === key)?.stageId ?? "";
  const inStage = (key: Key) => items.filter(item => item.key === key).map(item => item.recruit);
  const unassignedPreOffer = items.filter(item => PRE_OFFER.has(item.key) && !["genpop", "mass_recruiting"].includes(item.recruit.recruitingPath ?? ""));
  const unrecognized = items.filter(item => !KNOWN.has(item.key));
  const unassignedContracting = inStage("contracting").filter(record => !["licensed", "not_licensed"].includes(record.licenseRoute ?? ""));
  const dragged = unique.find(record => record.id === draggedId);
  const hoveredItem = hovered ? items.find(item => item.recruit.id === hovered.id) : undefined;
  const editable = (recruit: PipelineRecruit) => Boolean(canEdit && !disabled && !pendingId && onStageChange && !blockedIds.includes(recruit.id) && stageSnapshotAvailable(recruit));
  const navigate = (event: MouseEvent<HTMLAnchorElement>, view: string) => {
    if (onNavigate && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault(); onNavigate(view);
    }
  };
  const togglePopout = (key: string, anchor: HTMLElement | null, toggle: HTMLElement | null) => {
    if (popout?.key === key || !anchor) { closePopout(false); return; }
    hideDetails(); setPopout({ key, anchor, toggle });
  };
  // The pop-out is portaled out of its stage; React still bubbles its events here, so ignore them.
  const outsideBoard = (event: { currentTarget: EventTarget; target: EventTarget }) => !(event.currentTarget as Node).contains(event.target as Node);
  const toggleFromBlock = (event: MouseEvent<HTMLElement>, key: string) => {
    if (outsideBoard(event) || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || (event.target as HTMLElement).closest("[data-recruit-card],a,button,input,select,textarea,summary,[role=button]")) return;
    event.preventDefault();
    togglePopout(key, event.currentTarget, event.currentTarget.querySelector<HTMLElement>("[data-popout-toggle]"));
  };
  const unrecordedPath = (recruit: PipelineRecruit) => !recruit.recruitingPath && PRE_OFFER.has(canonicalKey(recruit.stageKey));
  const destinationLabel = (choice: { label?: string; flowChanges?: { recruiting_path?: string } }) => choice.flowChanges?.recruiting_path
    ? `${PATH_NAMES[choice.flowChanges.recruiting_path] ?? "the chosen path"} · ${choice.label ?? "the chosen stage"}` : choice.label ?? "the chosen stage";
  const hideDetails = () => { window.clearTimeout(hoverTimerRef.current); setHovered(null); };
  // A short grace period lets the pointer travel from the name into the card to use its quick actions.
  const scheduleHideDetails = () => { window.clearTimeout(hoverTimerRef.current); hoverTimerRef.current = window.setTimeout(() => setHovered(null), 300); };
  const keepDetails = () => window.clearTimeout(hoverTimerRef.current);
  const anchorFor = (element: HTMLElement, id: string): HoverAnchor => {
    const row = (element.closest<HTMLElement>("[data-recruit-card]") ?? element).getBoundingClientRect(), name = element.getBoundingClientRect();
    return { id, top: name.top, bottom: name.bottom, left: row.left, right: row.right };
  };
  const hoverName = (event: PointerEvent<HTMLAnchorElement>, recruit: PipelineRecruit) => {
    if (event.pointerType === "touch" || recordDragRef.current?.moved) return;
    const element = event.currentTarget;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => setHovered(anchorFor(element, recruit.id)), 180);
  };
  const focusName = (event: FocusEvent<HTMLAnchorElement>, recruit: PipelineRecruit) => {
    if (!event.currentTarget.matches(":focus-visible")) return;
    window.clearTimeout(hoverTimerRef.current); setHovered(anchorFor(event.currentTarget, recruit.id));
  };
  const finishRecordDrag = () => { recordDragRef.current = null; setDraggedId(null); setDragOrigin(null); setDropHover(null); };
  const beginRecordDrag = (event: PointerEvent<HTMLElement>, recruit: PipelineRecruit) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !editable(recruit)) return;
    event.stopPropagation(); suppressClickRef.current = false;
    const surface = event.currentTarget.closest<HTMLElement>("[data-pipeline-carousel]");
    if (!surface) return;
    recordDragRef.current = { pointerId: event.pointerId, id: recruit.id, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
  };
  const dropRecord = (id: string, destination: { key: string; target: Target } | null) => {
    const recruit = unique.find(record => record.id === id);
    const choice = recruit && editable(recruit) ? pipelineDropChoice(recruit, destination?.target ?? null) : null;
    finishRecordDrag();
    if (recruit && choice && onStageChange) {
      setAnnouncement(recruit.isDemo ? `Updating ${recruit.name || "recruit"} locally to ${destinationLabel(choice)}. HubSpot will not change.` : `Saving ${recruit.name || "recruit"} to ${destinationLabel(choice)} in HubSpot.`);
      onStageChange(recruit, choice.stageId, choice.flowChanges);
    } else setAnnouncement("That move is unavailable. Choose a highlighted stage on this recruit’s path.");
  };
  const panStart = (event: PointerEvent<HTMLDivElement>) => {
    if (outsideBoard(event)) return;
    suppressClickRef.current = false;
    if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
    if (event.button !== 0 || draggedId) return;
    const element = event.target as HTMLElement;
    if (element.closest("[data-recruit-card],button,input,select,textarea") || element.closest("a:not([data-pipeline-background])")) return;
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scroll: event.currentTarget.scrollLeft, moved: false };
  };
  const panMove = (event: PointerEvent<HTMLDivElement>) => {
    const recordDrag = recordDragRef.current;
    if (recordDrag && recordDrag.pointerId === event.pointerId) {
      const recruit = unique.find(record => record.id === recordDrag.id);
      if (!recruit || !editable(recruit)) { finishRecordDrag(); return; }
      recordDrag.x = event.clientX; recordDrag.y = event.clientY;
      if (!recordDrag.moved && Math.hypot(event.clientX - recordDrag.startX, event.clientY - recordDrag.startY) < 6) return;
      event.preventDefault();
      if (!recordDrag.moved) {
        recordDrag.moved = true; event.currentTarget.setPointerCapture(event.pointerId); setDraggedId(recordDrag.id); setDragOrigin({ x: event.clientX, y: event.clientY }); hideDetails(); closePopout(false);
        setAnnouncement(unrecordedPath(recruit)
          ? `Moving ${recruit.name || "recruit"}. Drop on a highlighted Referrals or Recruiters stage to record their path.`
          : `Moving ${recruit.name || "recruit"}. Hold near the top or bottom of the window to scroll. Drop on a highlighted stage to move directly forward or backward.`);
      }
      if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`;
      const destination = stageAtPoint(event.clientX, event.clientY);
      setDropHover(destination && pipelineDropChoice(recruit, destination.target) ? destination.key : null);
      return;
    }
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const delta = event.clientX - pan.x;
    if (!pan.moved && Math.abs(delta) < 6) return;
    if (!pan.moved && Math.abs(event.clientY - pan.y) > Math.abs(delta)) { panRef.current = null; return; }
    if (!pan.moved) { pan.moved = true; setPanning(true); event.currentTarget.setPointerCapture(event.pointerId); }
    event.preventDefault(); event.currentTarget.scrollLeft = pan.scroll - delta;
  };
  const panEnd = (event: PointerEvent<HTMLDivElement>) => {
    const recordDrag = recordDragRef.current;
    if (recordDrag && recordDrag.pointerId === event.pointerId) {
      if (recordDrag.moved) {
        event.preventDefault(); suppressClickRef.current = true;
        dropRecord(recordDrag.id, stageAtPoint(event.clientX, event.clientY));
      } else finishRecordDrag();
      return;
    }
    const pan = panRef.current;
    if (pan?.moved) suppressClickRef.current = true;
    panRef.current = null; setPanning(false);
  };
  const cancelPointerGesture = () => { finishRecordDrag(); panRef.current = null; setPanning(false); };
  const shiftCarousel = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollBy({ left: direction * Math.max(290, viewport.clientWidth * .75), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const recruitCard = (recruit: PipelineRecruit, stageLabel: string, details = true) => {
    const name = recruitName(recruit);
    return <article key={recruit.id} data-recruit-card className={`${styles.recruit} ${draggedId === recruit.id ? styles.draggingRecruit : ""}`} aria-label={name}>
      {editable(recruit) && <button className={styles.grip} type="button" aria-label={`Drag ${name} to a stage`} title={unrecordedPath(recruit) ? "Drag onto a highlighted Referrals or Recruiters stage to record this recruit’s path, or use the stage menu." : "Drag to a highlighted stage. Hold near the top or bottom to scroll, or use the stage menu."} onPointerDown={event => { hideDetails(); beginRecordDrag(event, recruit); }} onClick={() => setAnnouncement("Open this stage with its arrow button and use the stage menu to move a recruit with your keyboard.")}>⠿</button>}
      <div className={`${styles.recruitSummary} ${editable(recruit) ? styles.draggableSummary : ""}`}><a href={recordHref(recruit)} draggable={false} className={editable(recruit) ? styles.draggableName : undefined}
        onPointerDown={event => { hideDetails(); beginRecordDrag(event, recruit); }} onPointerEnter={event => hoverName(event, recruit)} onPointerLeave={scheduleHideDetails} onFocus={event => focusName(event, recruit)} onBlur={hideDetails}>{name}</a><RecruitCommunications recruitName={name} recruitId={recruit.id} phone={recruit.phone} hubspotUrl={recruit.hubspotUrl ?? ""} isDemo={recruit.isDemo} /></div>
      {details && <dl className={styles.recruitDetails}>
        <div><dt>First name</dt><dd><a href={recordHref(recruit)} draggable={false}>{recruit.firstName || "Not recorded"}</a></dd></div>
        <div><dt>Last name</dt><dd><a href={recordHref(recruit)} draggable={false}>{recruit.lastName || "Not recorded"}</a></dd></div>
        <div><dt>Phone</dt><dd>{recruit.phone || "Not recorded"}</dd></div>
        <div><dt>Email</dt><dd>{recruit.email || "Not recorded"}</dd></div>
        <div><dt>Recruiter</dt><dd>{recruiterLabel(recruit)}</dd></div>
        <div><dt>Stage</dt><dd>{canEdit && onStageChange ? <RecruitStageControls recruit={{ ...recruit, name, stageId: recruit.stageId ?? "", recruitingPath: recruit.recruitingPath ?? "", licenseRoute: recruit.licenseRoute ?? "", updatedAt: recruit.updatedAt ?? null }} mode="select" canEdit={canEdit} disabled={disabled || Boolean(pendingId) || blockedIds.includes(recruit.id)} onChange={(id, changes) => onStageChange(recruit, id, changes)} /> : recruit.stage || stageLabel}</dd></div>
        <div><dt>Time in stage</dt><dd>{pipelineAge(recruit.enteredStageAt, now)}</dd></div>
        <div><dt>Last contacted</dt><dd>{dateLabel(recruit.lastContactedAt)}</dd></div>
      </dl>}
    </article>;
  };
  const popoutCard = (recruit: PipelineRecruit, stageLabel: string) => {
    const name = recruitName(recruit);
    const path = recruit.recruitingPath ? PATH_NAMES[recruit.recruitingPath] : null;
    const stageControl = canEdit && onStageChange
      ? <RecruitStageControls recruit={{ ...recruit, name, stageId: recruit.stageId ?? "", recruitingPath: recruit.recruitingPath ?? "", licenseRoute: recruit.licenseRoute ?? "", updatedAt: recruit.updatedAt ?? null }} mode="select" canEdit={canEdit} disabled={disabled || Boolean(pendingId) || blockedIds.includes(recruit.id)} onChange={(id, changes) => onStageChange(recruit, id, changes)} />
      : recruit.stage || stageLabel;
    return <article key={recruit.id} className={`${styles.popoutRecruit} ${pendingId === recruit.id ? styles.popoutSaving : ""}`} aria-label={name}>
      <div className={styles.popoutRecruitHead}>
        <a className={styles.popoutName} href={recordHref(recruit)}>{name}</a>
        {path ? <span className={styles.popoutChip}>{path}</span> : unrecordedPath(recruit) ? <span className={`${styles.popoutChip} ${styles.popoutWarning}`}>Path not recorded</span> : null}
      </div>
      <RecruitCommunications labeled recruitName={name} recruitId={recruit.id} phone={recruit.phone} hubspotUrl={recruit.hubspotUrl ?? ""} isDemo={recruit.isDemo} />
      <dl className={styles.popoutDetails}>
        <div><dt>Phone</dt><dd>{recruit.phone || "Not recorded"}</dd></div>
        <div><dt>Email</dt><dd>{recruit.email || "Not recorded"}</dd></div>
        <div><dt>Recruiter</dt><dd>{recruiterLabel(recruit)}</dd></div>
        <div><dt>Office</dt><dd>{recruit.office || "Not recorded"}</dd></div>
        <div><dt>Time in stage</dt><dd>{pipelineAge(recruit.enteredStageAt, now)}</dd></div>
        <div><dt>Last contacted</dt><dd>{dateLabel(recruit.lastContactedAt)}</dd></div>
        <div className={styles.popoutStage}><dt>Stage</dt><dd>{stageControl}</dd></div>
      </dl>
    </article>;
  };
  const card = (key: Key, options: CardOptions = {}) => {
    const { path, route } = options;
    const recruits = options.records ?? inStage(key).filter(record => (!path || record.recruitingPath === path) && (!route || record.licenseRoute === route));
    const title = options.titleLabel ?? label(key), view = options.view ?? (path ? `${path === "genpop" ? "genpop" : "mass"}-${key}` : key);
    const target: Target = { stageId: stageId(key), allowDrop: options.allowDrop, ...(path ? { recruitingPath: path } : {}), ...(route ? { licenseRoute: route } : {}) };
    const targetKey = options.nodeKey ?? `${view}-${options.records ? "unassigned" : "stage"}`;
    const open = popout?.key === targetKey;
    const sort = sorts[targetKey] ?? { key: "firstName", direction: "asc" as const };
    const sorted = sortPipelineRecruits(recruits, sort.key, sort.direction) as PipelineRecruit[];
    const validDrop = dragged && editable(dragged) && pipelineDropChoice(dragged, target);
    const subtitle = options.subtitle ?? (path ? PATH_NAMES[path] : options.records && options.allowDrop === false && PRE_OFFER.has(key) ? "Path not recorded" : undefined);
    const stagePopout = open && popout && <StagePopout key={targetKey} id={popoutId} anchor={popout.anchor} toggle={popout.toggle} title={title} subtitle={subtitle} count={recruits.length} columns={Math.min(4, Math.max(2, recruits.length))} onClose={closePopout}
      tools={<>
        <label className={styles.popoutSort}><span>Sort by</span><select aria-label={`Sort ${title}${subtitle ? ` ${subtitle}` : ""}`} value={sort.key} onChange={event => setSorts(value => ({ ...value, [targetKey]: { ...sort, key: event.target.value } }))}>{SORT_FIELDS.map(([field, text]) => <option key={field} value={field}>{text}</option>)}</select></label>
        <button type="button" className={styles.popoutButton} aria-label={`${sort.direction === "asc" ? "Sort descending" : "Sort ascending"} in ${title}`} onClick={() => setSorts(value => ({ ...value, [targetKey]: { ...sort, direction: sort.direction === "asc" ? "desc" : "asc" } }))}>{sort.direction === "asc" ? "A → Z" : "Z → A"}</button>
        <a className={styles.popoutButton} href={`#${view}`} onClick={event => { closePopout(false); navigate(event, view); }}>Open stage page</a>
      </>}>
      {sorted.length ? <div className={styles.popoutGrid}>{sorted.map(record => popoutCard(record, title))}</div> : <p className={styles.popoutEmpty}>No recruits in this stage.</p>}
    </StagePopout>;
    return <section key={targetKey} className={`${styles.stage} ${open ? styles.popoutOpen : ""} ${Object.keys(LABELS).indexOf(key) % 2 ? styles.warm : styles.cool} ${recruits.length ? styles.occupied : ""} ${validDrop ? styles.dropAvailable : ""} ${dropHover === targetKey && validDrop ? styles.dropHover : ""}`} aria-label={`${title}${subtitle ? `, ${subtitle}` : ""}: ${recruits.length} recruits`}
      onClick={event => toggleFromBlock(event, targetKey)} data-stage-view={options.nodeKey ?? (options.records && options.allowDrop === false ? undefined : view)} data-pipeline-stage-target data-target-key={targetKey} data-stage-id={target.stageId} data-recruiting-path={path} data-license-route={route} data-allow-drop={target.allowDrop !== false}>
      {validDrop && <span className={styles.dropHint}>Drop here</span>}
      <header className={styles.stageHeading}><h4><span className={styles.stageToggle}><a className={styles.stageTitle} href={`#${view}`} onClick={event => navigate(event, view)}>{title}{options.subtitle && <small>{options.subtitle}</small>}</a><span className={styles.count}>{recruits.length}</span><button type="button" className={styles.expandButton} data-popout-toggle aria-label={`${open ? "Close" : "Open"} ${title}${subtitle ? ` ${subtitle}` : ""} in a larger view`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popoutId : undefined}
        onClick={event => togglePopout(targetKey, event.currentTarget.closest<HTMLElement>("[data-pipeline-stage-target]"), event.currentTarget)}><span aria-hidden="true">{open ? "⌃" : "⌄"}</span></button></span></h4></header>
      <div className={styles.stageContent}>
        {sorted.length ? <RecruitStack>{sorted.map(record => recruitCard(record, title, false))}</RecruitStack> : null}
      </div>
      {stagePopout}
    </section>;
  };
  const arrow = <span className={styles.arrow} aria-hidden="true">→</span>;
  const panels = [
    <div className={styles.entryPaths} key="paths">
      <section className={styles.entryPath} aria-label="Referrals recruiting path"><h3>Referrals</h3><div className={styles.stageRow}>{card("hiring-event", { path: "genpop" })}{arrow}{card("application", { path: "genpop" })}{arrow}{card("phone-interview", { path: "genpop" })}</div></section>
      <section className={styles.entryPath} aria-label="Recruiters recruiting path"><h3>Recruiters</h3><div className={styles.stageRow}>{card("application", { path: "mass_recruiting" })}{arrow}{card("phone-interview", { path: "mass_recruiting" })}{arrow}{card("hiring-event", { path: "mass_recruiting" })}</div></section>
      {unassignedPreOffer.length > 0 && <section className={styles.entryPath} aria-label="Recruiting path not recorded"><h3>Path not recorded</h3>{unassignedPreOffer.some(item => editable(item.recruit)) && <p className={styles.pathHint}>Drag a recruit onto a Referrals or Recruiters stage to record their path in HubSpot.</p>}<div className={styles.stageRow}>{(["hiring-event", "application", "phone-interview"] as Key[]).map(key => card(key, { records: unassignedPreOffer.filter(item => item.key === key).map(item => item.recruit), allowDrop: false }))}</div></section>}
    </div>,
    <div className={styles.singleStage} key="offer">{card("offer")}</div>,
    <div className={styles.licensePaths} key="licensing">
      <section className={styles.licensingRoute} aria-label="Licensed"><h3><a href="#licensed-contracting" draggable={false} onClick={event => navigate(event, "licensed-contracting")}>Licensed</a></h3><div className={styles.stageRow}>{card("contracting", { route: "licensed", view: "licensed-contracting", nodeKey: "licensed-branch", titleLabel: "Licensed", subtitle: "Branch to Contracting", allowDrop: false })}{arrow}{card("contracting", { route: "licensed", view: "licensed-contracting", subtitle: "Licensed" })}</div></section>
      <section className={styles.licensingRoute} aria-label="Not Licensed"><h3><a href="#licensing-reminders" draggable={false} onClick={event => navigate(event, "licensing-reminders")}>Not Licensed</a></h3><div className={styles.stageRow}>{card("licensing-reminders", { route: "not_licensed", records: inStage("licensing-reminders") })}{arrow}{card("licensed-npn", { route: "not_licensed", records: inStage("licensed-npn") })}{arrow}{card("contracting", { route: "not_licensed", view: "unlicensed-contracting", subtitle: "Not Licensed" })}</div></section>
      {unassignedContracting.length > 0 && card("contracting", { records: unassignedContracting, subtitle: "Branch not recorded", allowDrop: false })}
    </div>,
    <div className={styles.singleStage} key="training">{card("training")}</div>,
    <div className={styles.outcomes} key="outcomes">{card("completed")}{unrecognized.length > 0 && <section className={styles.stage} aria-label="Stage not recognized"><header className={styles.stageHeading}><h4><button type="button" className={styles.stageToggle} aria-expanded={expanded.unrecognized === true} aria-controls={`${pipelineId}-unrecognized`} onClick={() => setExpanded(value => ({ ...value, unrecognized: !value.unrecognized }))}><span>Stage not recognized</span><span className={styles.count}>{unrecognized.length}</span><span className={styles.chevron} aria-hidden="true">{expanded.unrecognized ? "⌃" : "⌄"}</span></button></h4></header><div id={`${pipelineId}-unrecognized`} hidden={!expanded.unrecognized}>{expanded.unrecognized && <RecruitStack>{unrecognized.map(item => recruitCard(item.recruit, "Not recorded"))}</RecruitStack>}</div></section>}</div>,
  ];
  return <section className={styles.pipeline} aria-label="Recruiting stages">
    {partial && <p className={styles.partial} role="status">Counts cover loaded records only.</p>}
    <div ref={viewportRef} data-pipeline-carousel className={`${styles.slider} ${panning || draggedId ? styles.dragging : ""}`} role="region" aria-label="Recruiting stages by path. Drag a recruit’s name or grip to a highlighted stage to move directly forward or backward." tabIndex={0}
      onPointerDown={panStart} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={cancelPointerGesture} onLostPointerCapture={event => { if (event.target === event.currentTarget) cancelPointerGesture(); }}
      onKeyDown={event => { if (event.target === event.currentTarget && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); shiftCarousel(event.key === "ArrowRight" ? 1 : -1); } }}
      onClickCapture={event => { if (suppressClickRef.current) { suppressClickRef.current = false; if (event.detail > 0) { event.preventDefault(); event.stopPropagation(); } } }}>
      <div className={styles.flow}><PipelineConnectors />{panels[0]}{panels[1]}{panels[2]}{panels[3]}{panels[4]}</div>
    </div>
    {hovered && hoveredItem && !draggedId && <RecruitHoverCard recruit={hoveredItem.recruit} anchor={hovered} id={hoverCardId} now={now} stageLabel={KNOWN.has(hoveredItem.key) ? label(hoveredItem.key as Key) : "Stage not recognized"} onPointerEnter={keepDetails} onPointerLeave={scheduleHideDetails}
      hint={!editable(hoveredItem.recruit) ? "" : unrecordedPath(hoveredItem.recruit)
        ? `Drag onto a Referrals or Recruiters stage to record this path.${hoveredItem.recruit.isDemo ? " Demo changes stay in this app." : " Saves to HubSpot."}`
        : `Drag to another stage to move this recruit.${hoveredItem.recruit.isDemo ? " Demo changes stay in this app." : " Each move saves to HubSpot."}`} />}
    {dragged && dragOrigin && <div ref={ghostRef} className={styles.dragGhost} style={{ transform: `translate3d(${dragOrigin.x + 14}px, ${dragOrigin.y + 14}px, 0)` }} aria-hidden="true">{dragged.name || "Recruit"}</div>}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>;
}
