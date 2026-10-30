"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import RecruitCommunications from "./recruit-communications";
import RecruitStageControls, { type StageFlowChanges } from "./recruit-stage-controls";
import { stageSnapshotAvailable } from "./recruit-stage-save.mjs";
import { pipelineAge, pipelineDropChoice, sortPipelineRecruits } from "./recruit-pipeline-actions.mjs";
import styles from "./recruit-pipeline.module.css";

export type PipelineRecruit = {
  isDemo?: boolean;
  id: string; name?: string; stageId?: string; stageKey?: string; stage?: string;
  firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null;
  recruitingPath?: string | null; licenseRoute?: string | null; office?: string | null;
  recruiter?: string | null; createdAt?: string | null; enteredStageAt?: string | null;
  recruiterStatus?: string;
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
type CardOptions = { path?: string; route?: string; records?: PipelineRecruit[]; view?: string; subtitle?: string; allowDrop?: boolean };
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
function stageAtPoint(x: number, y: number): { target: Target; key: string } | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pipeline-stage-target]");
  if (!element || element.closest("[inert]")) return null;
  return { key: element.dataset.targetKey ?? "", target: { stageId: element.dataset.stageId ?? "", allowDrop: element.dataset.allowDrop !== "false", ...(element.dataset.recruitingPath ? { recruitingPath: element.dataset.recruitingPath } : {}), ...(element.dataset.licenseRoute ? { licenseRoute: element.dataset.licenseRoute } : {}) } };
}

/** The horizontal viewport preserves the graph; recruit dragging chooses validated edges. */
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
  const editable = (recruit: PipelineRecruit) => Boolean(canEdit && !disabled && !pendingId && onStageChange && !blockedIds.includes(recruit.id) && stageSnapshotAvailable(recruit));
  const navigate = (event: MouseEvent<HTMLAnchorElement>, view: string) => {
    if (onNavigate && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault(); onNavigate(view);
    }
  };
  const toggleFromBlock = (event: MouseEvent<HTMLElement>, key: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || (event.target as HTMLElement).closest("[data-recruit-card],a,button,input,select,textarea,summary,[role=button]")) return;
    event.preventDefault();
    setExpanded(value => ({ ...value, [key]: !value[key] }));
  };
  const finishRecordDrag = () => { recordDragRef.current = null; setDraggedId(null); setDragOrigin(null); setDropHover(null); };
  const beginRecordDrag = (event: PointerEvent<HTMLButtonElement>, recruit: PipelineRecruit) => {
    if (event.button !== 0 || !editable(recruit)) return;
    event.preventDefault(); event.stopPropagation(); suppressClickRef.current = false;
    const surface = event.currentTarget.closest<HTMLElement>("[data-pipeline-carousel]");
    if (!surface) return;
    recordDragRef.current = { pointerId: event.pointerId, id: recruit.id, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
    surface.setPointerCapture(event.pointerId);
  };
  const dropRecord = (id: string, destination: { key: string; target: Target } | null) => {
    const recruit = unique.find(record => record.id === id);
    const choice = recruit && editable(recruit) ? pipelineDropChoice(recruit, destination?.target ?? null) : null;
    finishRecordDrag();
    if (recruit && choice && onStageChange) {
      if (destination) setExpanded(value => ({ ...value, [destination.key]: true }));
      setAnnouncement(recruit.isDemo ? `Updating ${recruit.name || "recruit"} locally to ${choice.label}. HubSpot will not change.` : `Saving ${recruit.name || "recruit"} to ${choice.label}.`);
      onStageChange(recruit, choice.stageId, choice.flowChanges);
    } else setAnnouncement("That move is unavailable. Choose a connected step or use the recruit’s stage menu.");
  };
  const panStart = (event: PointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false;
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
        recordDrag.moved = true; setDraggedId(recordDrag.id); setDragOrigin({ x: event.clientX, y: event.clientY });
        setAnnouncement(`Moving ${recruit.name || "recruit"}. Hold at an edge or over Previous or Next to scroll. Highlighted stages are connected steps.`);
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
  const recruitCard = (recruit: PipelineRecruit, stageLabel: string) => {
    const name = recruit.name || `Recruit ${recruit.id}`;
    return <article key={recruit.id} data-recruit-card className={`${styles.recruit} ${draggedId === recruit.id ? styles.draggingRecruit : ""}`} aria-label={name}>
      {editable(recruit) && <button className={styles.grip} type="button" aria-label={`Drag ${name} to a connected stage`} title="Drag to a highlighted stage. Hold at an edge or over the arrows to scroll, or use the stage menu." onPointerDown={event => beginRecordDrag(event, recruit)} onClick={() => setAnnouncement("Use the lifecycle stage menu on this card to move a recruit with your keyboard.")}>⠿</button>}
      <dl className={styles.recruitDetails}>
        <div><dt>First name</dt><dd><a href={recordHref(recruit)} draggable={false}>{recruit.firstName || "Not recorded"}</a></dd></div>
        <div><dt>Last name</dt><dd><a href={recordHref(recruit)} draggable={false}>{recruit.lastName || "Not recorded"}</a></dd></div>
        <div><dt>Phone</dt><dd>{recruit.phone || "Not recorded"}</dd></div>
        <div><dt>Email</dt><dd>{recruit.email || "Not recorded"}</dd></div>
        <div><dt>Recruiter</dt><dd>{recruit.recruiter || (recruit.recruiterStatus === "unassigned" ? "Not assigned" : recruit.recruiterStatus === "unavailable" || recruit.recruiterStatus === "not-found" ? "Unavailable" : "Not recorded")}</dd></div>
        <div><dt>Stage</dt><dd>{canEdit && onStageChange ? <RecruitStageControls recruit={{ ...recruit, name, stageId: recruit.stageId ?? "", recruitingPath: recruit.recruitingPath ?? "", licenseRoute: recruit.licenseRoute ?? "", updatedAt: recruit.updatedAt ?? null }} mode="select" canEdit={canEdit} disabled={disabled || Boolean(pendingId) || blockedIds.includes(recruit.id)} onChange={(id, changes) => onStageChange(recruit, id, changes)} /> : recruit.stage || stageLabel}</dd></div>
        <div><dt>Time in stage</dt><dd>{pipelineAge(recruit.enteredStageAt, now)}</dd></div>
        <div><dt>Last contacted</dt><dd>{dateLabel(recruit.lastContactedAt)}</dd></div>
      </dl>
      <div className={styles.cardFooter}><RecruitCommunications recruitName={name} recruitId={recruit.id} hubspotUrl={recruit.hubspotUrl ?? ""} isDemo={recruit.isDemo} /></div>
    </article>;
  };
  const card = (key: Key, options: CardOptions = {}) => {
    const { path, route } = options;
    const recruits = options.records ?? inStage(key).filter(record => (!path || record.recruitingPath === path) && (!route || record.licenseRoute === route));
    const title = label(key), view = options.view ?? (path ? `${path === "genpop" ? "genpop" : "mass"}-${key}` : key);
    const target: Target = { stageId: stageId(key), allowDrop: options.allowDrop, ...(path ? { recruitingPath: path } : {}), ...(route ? { licenseRoute: route } : {}) };
    const targetKey = `${view}-${options.records ? "unassigned" : "stage"}`;
    const open = expanded[targetKey] === true, contentId = `${pipelineId}-${targetKey}`;
    const sort = sorts[targetKey] ?? { key: "firstName", direction: "asc" as const };
    const sorted = sortPipelineRecruits(recruits, sort.key, sort.direction) as PipelineRecruit[];
    const validDrop = dragged && editable(dragged) && pipelineDropChoice(dragged, target);
    return <section key={targetKey} className={`${styles.stage} ${recruits.length ? styles.occupied : ""} ${validDrop ? styles.dropAvailable : ""} ${dropHover === targetKey && validDrop ? styles.dropHover : ""}`} aria-label={`${title}${options.subtitle ? `, ${options.subtitle}` : path ? `, ${path === "genpop" ? "Referrals" : "Recruiters"}` : ""}: ${recruits.length} recruits`}
      onClick={event => toggleFromBlock(event, targetKey)} data-pipeline-stage-target data-target-key={targetKey} data-stage-id={target.stageId} data-recruiting-path={path} data-license-route={route} data-allow-drop={target.allowDrop !== false}>
      {validDrop && <span className={styles.dropHint}>Drop here</span>}
      <header className={styles.stageHeading}><h4><button type="button" className={styles.stageToggle} aria-expanded={open} aria-controls={contentId} onClick={() => setExpanded(value => ({ ...value, [targetKey]: !value[targetKey] }))}><span>{title}{options.subtitle && <small>{options.subtitle}</small>}</span><span className={styles.count}>{recruits.length}</span><span className={styles.chevron} aria-hidden="true">{open ? "⌃" : "⌄"}</span></button></h4></header>
      <div id={contentId} className={styles.stageContent} hidden={!open}>{open && <>
        <div className={styles.stageToolbar}><a href={`#${view}`} className={styles.stagePageLink} onClick={event => navigate(event, view)}>Open stage page</a><label className={styles.sort}><span className="sr-only">Sort {title}{options.subtitle ? ` ${options.subtitle}` : path ? ` ${path === "genpop" ? "Referrals" : "Recruiters"}` : ""}</span><select aria-label={`Sort ${title}${options.subtitle ? ` ${options.subtitle}` : path ? ` ${path === "genpop" ? "Referrals" : "Recruiters"}` : ""}`} value={sort.key} onChange={event => setSorts(value => ({ ...value, [targetKey]: { ...sort, key: event.target.value } }))}>{SORT_FIELDS.map(([field, text]) => <option key={field} value={field}>{text}</option>)}</select></label><button type="button" className={styles.sortDirection} aria-label={`${sort.direction === "asc" ? "Sort descending" : "Sort ascending"} in ${title}`} onClick={() => setSorts(value => ({ ...value, [targetKey]: { ...sort, direction: sort.direction === "asc" ? "desc" : "asc" } }))}>{sort.direction === "asc" ? "↑" : "↓"}</button></div>
        {sorted.length ? <div className={styles.recruits}>{sorted.map(record => recruitCard(record, title))}</div> : <p className={styles.empty}>No recruits</p>}
      </>}</div>
    </section>;
  };
  const arrow = <span className={styles.arrow} aria-hidden="true">→</span>;
  const panels = [
    <div className={styles.entryPaths} key="paths">
      <section className={styles.entryPath} aria-label="Referrals recruiting path"><h3>Referrals</h3><div className={styles.stageRow}>{card("hiring-event", { path: "genpop" })}{arrow}{card("application", { path: "genpop" })}{arrow}{card("phone-interview", { path: "genpop" })}</div></section>
      <section className={styles.entryPath} aria-label="Recruiters recruiting path"><h3>Recruiters</h3><div className={styles.stageRow}>{card("application", { path: "mass_recruiting" })}{arrow}{card("phone-interview", { path: "mass_recruiting" })}{arrow}{card("hiring-event", { path: "mass_recruiting" })}</div></section>
      {unassignedPreOffer.length > 0 && <section className={styles.entryPath} aria-label="Recruiting path not recorded"><h3>Path not recorded</h3><div className={styles.stageRow}>{(["hiring-event", "application", "phone-interview"] as Key[]).map(key => card(key, { records: unassignedPreOffer.filter(item => item.key === key).map(item => item.recruit), allowDrop: false }))}</div></section>}
    </div>,
    <div className={styles.singleStage} key="offer">{card("offer")}</div>,
    <div className={styles.licensePaths} key="licensing">
      <section className={styles.licensingRoute} aria-label="Licensed"><h3><a href="#licensed-contracting" draggable={false} onClick={event => navigate(event, "licensed-contracting")}>Licensed</a></h3><div className={styles.directRoute}><span>Offer</span>{arrow}{card("contracting", { route: "licensed", view: "licensed-contracting", subtitle: "Licensed" })}</div></section>
      <section className={styles.licensingRoute} aria-label="Not Licensed"><h3><a href="#licensing-reminders" draggable={false} onClick={event => navigate(event, "licensing-reminders")}>Not Licensed</a></h3><div className={styles.stageRow}>{card("licensing-reminders", { route: "not_licensed", records: inStage("licensing-reminders") })}{arrow}{card("licensed-npn", { route: "not_licensed", records: inStage("licensed-npn") })}{arrow}{card("contracting", { route: "not_licensed", view: "unlicensed-contracting", subtitle: "Not Licensed" })}</div></section>
      {unassignedContracting.length > 0 && card("contracting", { records: unassignedContracting, subtitle: "Branch not recorded", allowDrop: false })}
    </div>,
    <div className={styles.singleStage} key="training">{card("training")}</div>,
    <div className={styles.outcomes} key="outcomes">{card("completed")}{card("withdrawn")}{unrecognized.length > 0 && <section className={styles.stage} aria-label="Stage not recognized"><header className={styles.stageHeading}><h4><button type="button" className={styles.stageToggle} aria-expanded={expanded.unrecognized === true} aria-controls={`${pipelineId}-unrecognized`} onClick={() => setExpanded(value => ({ ...value, unrecognized: !value.unrecognized }))}><span>Stage not recognized</span><span className={styles.count}>{unrecognized.length}</span><span className={styles.chevron} aria-hidden="true">{expanded.unrecognized ? "⌃" : "⌄"}</span></button></h4></header><div id={`${pipelineId}-unrecognized`} hidden={!expanded.unrecognized}>{expanded.unrecognized && <div className={styles.recruits}>{unrecognized.map(item => recruitCard(item.recruit, "Not recorded"))}</div>}</div></section>}</div>,
  ];
  return <section className={styles.pipeline} aria-labelledby="recruit-pipeline-title">
    <div className={styles.heading}><h2 id="recruit-pipeline-title">Recruiting pipeline</h2><div className={styles.carouselControls} aria-label="Pipeline slider controls"><button type="button" data-carousel-scroll="-1" aria-label="Previous pipeline stages" title={draggedId ? "Hold the recruit here to scroll left" : "Slide left"} onClick={() => shiftCarousel(-1)}>←</button><button type="button" data-carousel-scroll="1" aria-label="Next pipeline stages" title={draggedId ? "Hold the recruit here to scroll right" : "Slide right"} onClick={() => shiftCarousel(1)}>→</button></div></div>
    {partial && <p className={styles.partial} role="status">Counts cover loaded records only.</p>}
    <div ref={viewportRef} data-pipeline-carousel className={`${styles.slider} ${panning || draggedId ? styles.dragging : ""}`} role="region" aria-roledescription="carousel" aria-label="Recruiting logic tree. Drag empty space to slide left or right. Expand a stage to see prospects; drag a recruit’s grip to a highlighted connected stage." tabIndex={0}
      onPointerDown={panStart} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={cancelPointerGesture} onLostPointerCapture={event => { if (event.target === event.currentTarget) cancelPointerGesture(); }}
      onKeyDown={event => { if (event.target === event.currentTarget && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); shiftCarousel(event.key === "ArrowRight" ? 1 : -1); } }}
      onClickCapture={event => { if (suppressClickRef.current) { suppressClickRef.current = false; if (event.detail > 0) { event.preventDefault(); event.stopPropagation(); } } }}>
      <div className={styles.flow}>{panels[0]}<span className={styles.merge} aria-hidden="true" />{panels[1]}{arrow}{panels[2]}<span className={styles.merge} aria-hidden="true" />{panels[3]}<span className={styles.split} aria-hidden="true" />{panels[4]}</div>
    </div>
    {dragged && dragOrigin && <div ref={ghostRef} className={styles.dragGhost} style={{ transform: `translate3d(${dragOrigin.x + 14}px, ${dragOrigin.y + 14}px, 0)` }} aria-hidden="true">{dragged.name || "Recruit"}</div>}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>;
}
