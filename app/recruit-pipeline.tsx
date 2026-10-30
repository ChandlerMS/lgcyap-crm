"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import RecruitCommunications from "./recruit-communications";
import RecruitStageControls, { type StageFlowChanges } from "./recruit-stage-controls";
import { stageSnapshotAvailable } from "./recruit-stage-save.mjs";
import { carouselDragSteps, carouselIndex, carouselSectionDelta, pipelineAge, pipelineDropChoice } from "./recruit-pipeline-actions.mjs";
import styles from "./recruit-pipeline.module.css";

export type PipelineRecruit = {
  id: string; name?: string; stageId?: string; stageKey?: string; stage?: string;
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
const CAROUSEL_SECTIONS = ["Recruiting paths", "Offer", "Licensing branches", "Training", "Outcomes"];
const SECTION_ANGLE = 360 / CAROUSEL_SECTIONS.length;
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

/** The 3D ring browses graph sections; recruit dragging chooses validated graph edges. */
export default function RecruitPipeline({ records, stages, partial = false, now = 0, canEdit = false, disabled = false, blockedIds = [], pendingId = null, onNavigate, onStageChange }: Props) {
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const panRef = useRef<{ pointerId: number; x: number; y: number; distance: number; moved: boolean } | null>(null);
  const recordDragRef = useRef<{ pointerId: number; id: string; x: number; y: number; moved: boolean } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const [turn, setTurn] = useState(0);
  const [rotationOffset, setRotationOffset] = useState(0);
  const [panelHeight, setPanelHeight] = useState(540);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null);
  const [hoverDirection, setHoverDirection] = useState<-1 | 1 | null>(null);
  const [dropHover, setDropHover] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const activeIndex = carouselIndex(turn, CAROUSEL_SECTIONS.length);
  const rotationAllowed = Boolean(draggedId && canEdit && !disabled && !pendingId && !blockedIds.includes(draggedId));
  useEffect(() => {
    const panel = panelRefs.current[activeIndex];
    if (!panel) return;
    const previousFocus = document.activeElement?.closest<HTMLElement>("[data-ring-panel]");
    if (previousFocus && previousFocus !== panel) panel.closest<HTMLElement>("[data-pipeline-carousel]")?.focus({ preventScroll: true });
    const observer = new ResizeObserver(entries => {
      const height = entries[0]?.borderBoxSize?.[0]?.blockSize ?? entries[0]?.contentRect.height;
      if (height) setPanelHeight(Math.ceil(height) + 28);
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [activeIndex]);
  useEffect(() => {
    if (!rotationAllowed || !hoverDirection) return;
    const timer = setTimeout(() => { setDropHover(null); setTurn(value => value + hoverDirection); }, 650);
    return () => clearTimeout(timer);
  }, [rotationAllowed, hoverDirection, turn]);
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
  const navigateFromBlock = (event: MouseEvent<HTMLElement>, view: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || (event.target as HTMLElement).closest("a,button,input,select,textarea,summary,[role=button]")) return;
    event.preventDefault();
    if (onNavigate) onNavigate(view);
    else event.currentTarget.querySelector<HTMLAnchorElement>("h4 a")?.click();
  };
  const clearHoverRotation = () => setHoverDirection(null);
  const finishRecordDrag = () => { recordDragRef.current = null; clearHoverRotation(); setDraggedId(null); setDragOrigin(null); setDropHover(null); };
  const beginRecordDrag = (event: PointerEvent<HTMLButtonElement>, recruit: PipelineRecruit) => {
    if (event.button !== 0 || !editable(recruit)) return;
    event.preventDefault(); event.stopPropagation(); suppressClickRef.current = false;
    const surface = event.currentTarget.closest<HTMLElement>("[data-pipeline-carousel]");
    if (!surface) return;
    recordDragRef.current = { pointerId: event.pointerId, id: recruit.id, x: event.clientX, y: event.clientY, moved: false };
    surface.setPointerCapture(event.pointerId);
  };
  const dropRecord = (id: string, target: Target | null) => {
    const recruit = unique.find(record => record.id === id);
    const choice = recruit && editable(recruit) ? pipelineDropChoice(recruit, target) : null;
    finishRecordDrag();
    if (recruit && choice && onStageChange) {
      setAnnouncement(`Saving ${recruit.name || "recruit"} to ${choice.label}.`);
      onStageChange(recruit, choice.stageId, choice.flowChanges);
    } else setAnnouncement("That move is unavailable. Choose a connected step or use the recruit’s stage menu.");
  };
  const panStart = (event: PointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false;
    if (event.button !== 0 || draggedId) return;
    const element = event.target as HTMLElement;
    if (element.closest("[data-recruit-card],button,input,select,textarea") || element.closest("a:not([data-pipeline-background])")) return;
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, moved: false };
  };
  const panMove = (event: PointerEvent<HTMLDivElement>) => {
    const recordDrag = recordDragRef.current;
    if (recordDrag && recordDrag.pointerId === event.pointerId) {
      const recruit = unique.find(record => record.id === recordDrag.id);
      if (!recruit || !editable(recruit)) { finishRecordDrag(); return; }
      if (!recordDrag.moved && Math.hypot(event.clientX - recordDrag.x, event.clientY - recordDrag.y) < 6) return;
      event.preventDefault();
      if (!recordDrag.moved) {
        recordDrag.moved = true; setDraggedId(recordDrag.id); setDragOrigin({ x: event.clientX, y: event.clientY });
        setAnnouncement(`Moving ${recruit.name || "recruit"}. Hover Previous or Next to rotate. Highlighted stages are connected steps.`);
      }
      if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`;
      const destination = stageAtPoint(event.clientX, event.clientY);
      setDropHover(destination && pipelineDropChoice(recruit, destination.target) ? destination.key : null);
      const rotateButton = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-carousel-rotate]");
      setHoverDirection(rotateButton?.dataset.carouselRotate === "-1" ? -1 : rotateButton?.dataset.carouselRotate === "1" ? 1 : null);
      return;
    }
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const delta = event.clientX - pan.x;
    if (!pan.moved && Math.abs(delta) < 6) return;
    if (!pan.moved && Math.abs(event.clientY - pan.y) > Math.abs(delta)) { panRef.current = null; return; }
    if (!pan.moved) { pan.moved = true; setPanning(true); event.currentTarget.setPointerCapture(event.pointerId); }
    pan.distance = delta;
    event.preventDefault(); setRotationOffset(Math.max(-144, Math.min(144, delta * .18)));
  };
  const panEnd = (event: PointerEvent<HTMLDivElement>) => {
    const recordDrag = recordDragRef.current;
    if (recordDrag && recordDrag.pointerId === event.pointerId) {
      if (recordDrag.moved) {
        event.preventDefault(); suppressClickRef.current = true;
        dropRecord(recordDrag.id, stageAtPoint(event.clientX, event.clientY)?.target ?? null);
      } else finishRecordDrag();
      return;
    }
    const pan = panRef.current;
    if (pan?.moved) { suppressClickRef.current = true; setTurn(value => value + carouselDragSteps(pan.distance)); }
    panRef.current = null; setPanning(false); setRotationOffset(0);
  };
  const cancelPointerGesture = () => { finishRecordDrag(); panRef.current = null; setPanning(false); setRotationOffset(0); };
  const shiftCarousel = (direction: -1 | 1) => {
    setDropHover(null); setTurn(value => value + direction);
  };
  const recruitCard = (recruit: PipelineRecruit, stageLabel: string) => {
    const name = recruit.name || `Recruit ${recruit.id}`;
    return <article key={recruit.id} data-recruit-card className={`${styles.recruit} ${draggedId === recruit.id ? styles.draggingRecruit : ""}`} aria-label={name}>
      <div className={styles.person}><a href={recordHref(recruit)} draggable={false}>{name}</a>{editable(recruit) && <button className={styles.grip} type="button" aria-label={`Drag ${name} to a connected stage`} title="Drag to a highlighted stage. Hold over the carousel arrows to rotate, or use the stage menu." onPointerDown={event => beginRecordDrag(event, recruit)} onClick={() => setAnnouncement("Use the lifecycle stage menu on this card to move a recruit with your keyboard.")}>⠿</button>}</div>
      <dl className={styles.recruitDetails}>
        <div><dt>Office</dt><dd>{recruit.office || "Not recorded"}</dd></div>
        <div><dt>Recruiter</dt><dd>{recruit.recruiter || (recruit.recruiterStatus === "unassigned" ? "Not assigned" : recruit.recruiterStatus === "unavailable" || recruit.recruiterStatus === "not-found" ? "Unavailable" : "Not recorded")}</dd></div>
        <div><dt>Lifecycle stage</dt><dd>{recruit.stage || stageLabel}</dd></div>
        <div><dt>Time in stage</dt><dd>{pipelineAge(recruit.enteredStageAt, now)}</dd></div>
        <div><dt>Created</dt><dd>{dateLabel(recruit.createdAt)}</dd></div>
        <div><dt>Last contacted</dt><dd>{dateLabel(recruit.lastContactedAt)}</dd></div>
      </dl>
      <div className={styles.cardFooter}><RecruitCommunications recruitName={name} recruitId={recruit.id} hubspotUrl={recruit.hubspotUrl ?? ""} /></div>
      {canEdit && onStageChange && <div className={styles.stageControl}><RecruitStageControls recruit={{ ...recruit, name, stageId: recruit.stageId ?? "", recruitingPath: recruit.recruitingPath ?? "", licenseRoute: recruit.licenseRoute ?? "", updatedAt: recruit.updatedAt ?? null }} mode="select" canEdit={canEdit} disabled={disabled || Boolean(pendingId) || blockedIds.includes(recruit.id)} onChange={(id, changes) => onStageChange(recruit, id, changes)} /></div>}
    </article>;
  };
  const card = (key: Key, options: CardOptions = {}) => {
    const { path, route } = options;
    const recruits = options.records ?? inStage(key).filter(record => (!path || record.recruitingPath === path) && (!route || record.licenseRoute === route));
    const title = label(key), view = options.view ?? (path ? `${path === "genpop" ? "genpop" : "mass"}-${key}` : key);
    const target: Target = { stageId: stageId(key), allowDrop: options.allowDrop, ...(path ? { recruitingPath: path } : {}), ...(route ? { licenseRoute: route } : {}) };
    const targetKey = `${view}-${options.records ? "unassigned" : "stage"}`;
    const validDrop = dragged && editable(dragged) && pipelineDropChoice(dragged, target);
    return <section key={targetKey} className={`${styles.stage} ${recruits.length ? styles.occupied : ""} ${validDrop ? styles.dropAvailable : ""} ${dropHover === targetKey && validDrop ? styles.dropHover : ""}`} aria-label={`${title}${options.subtitle ? `, ${options.subtitle}` : path ? `, ${path === "genpop" ? "Referrals" : "Recruiters"}` : ""}: ${recruits.length} recruits`}
      onClick={event => navigateFromBlock(event, view)} data-pipeline-stage-target data-target-key={targetKey} data-stage-id={target.stageId} data-recruiting-path={path} data-license-route={route} data-allow-drop={target.allowDrop !== false}>
      {validDrop && <span className={styles.dropHint}>Drop here</span>}
      <a href={`#${view}`} className={styles.stageBackground} data-pipeline-background draggable={false} aria-label={`Open ${title}${options.subtitle ? `, ${options.subtitle}` : path ? ` for ${path === "genpop" ? "Referrals" : "Recruiters"}` : ""}`} onClick={event => navigate(event, view)} />
      <header className={styles.stageHeading}><h4><a href={`#${view}`} draggable={false} onClick={event => navigate(event, view)}>{title}</a>{options.subtitle && <small>{options.subtitle}</small>}</h4><span className={styles.count}>{recruits.length}</span></header>
      {recruits.length ? <div className={styles.recruits}>{recruits.map(record => recruitCard(record, title))}</div> : <span className={styles.empty}>{validDrop ? "Drop recruit here" : "No recruits"}</span>}
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
    <div className={styles.outcomes} key="outcomes">{card("completed")}{card("withdrawn")}{unrecognized.length > 0 && <section className={styles.stage} aria-label="Stage not recognized"><h4>Stage not recognized <span className={styles.count}>{unrecognized.length}</span></h4><div className={styles.recruits}>{unrecognized.map(item => recruitCard(item.recruit, "Not recorded"))}</div></section>}</div>,
  ];
  return <section className={styles.pipeline} aria-labelledby="recruit-pipeline-title">
    <div className={styles.heading}><h2 id="recruit-pipeline-title">Recruiting pipeline</h2><div className={styles.carouselControls} aria-label="Pipeline carousel controls"><button type="button" data-carousel-rotate="-1" aria-label="Previous pipeline section" title={draggedId ? "Hold the recruit here to rotate back" : "Rotate back"} onClick={() => shiftCarousel(-1)}>←</button><button type="button" data-carousel-rotate="1" aria-label="Next pipeline section" title={draggedId ? "Hold the recruit here to rotate forward" : "Rotate forward"} onClick={() => shiftCarousel(1)}>→</button></div></div>
    {partial && <p className={styles.partial} role="status">Counts cover loaded records only.</p>}
    <div className={styles.sectionNavigation} role="group" aria-label="Pipeline sections">{CAROUSEL_SECTIONS.map((section, index) => <button key={section} type="button" aria-pressed={activeIndex === index} onClick={() => { setDropHover(null); setTurn(value => value + carouselSectionDelta(activeIndex, index, CAROUSEL_SECTIONS.length)); }}>{section}</button>)}</div>
    <div data-pipeline-carousel className={`${styles.carousel} ${panning ? styles.panning : ""}`} style={{ height: panelHeight, "--ring-rotation": `${-turn * SECTION_ANGLE + rotationOffset}deg` } as CSSProperties} role="region" aria-roledescription="carousel" aria-label="Recruiting logic tree. Drag empty space to rotate. Drag recruits by their grip; hover Previous or Next to rotate to another connected stage." tabIndex={0}
      onPointerDown={panStart} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={cancelPointerGesture} onLostPointerCapture={event => { if (event.target === event.currentTarget) cancelPointerGesture(); }}
      onKeyDown={event => { if (event.target === event.currentTarget && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); shiftCarousel(event.key === "ArrowRight" ? 1 : -1); } }}
      onClickCapture={event => { if (suppressClickRef.current) { event.preventDefault(); event.stopPropagation(); suppressClickRef.current = false; } }}>
      <div className={styles.ring}>{panels.map((panel, index) => <div key={CAROUSEL_SECTIONS[index]} ref={element => { panelRefs.current[index] = element; }} data-ring-panel className={`${styles.panel} ${activeIndex === index ? styles.activePanel : ""}`} style={{ "--panel-angle": `${index * SECTION_ANGLE}deg` } as CSSProperties} role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${CAROUSEL_SECTIONS.length}: ${CAROUSEL_SECTIONS[index]}`} aria-hidden={activeIndex !== index} inert={activeIndex !== index}>
        <h3 className={styles.panelTitle}>{CAROUSEL_SECTIONS[index]}</h3><div className={styles.panelScroll} tabIndex={activeIndex === index ? 0 : -1} role="region" aria-label={`${CAROUSEL_SECTIONS[index]} stage blocks`}>{panel}</div>
      </div>)}</div>
    </div>
    {dragged && dragOrigin && <div ref={ghostRef} className={styles.dragGhost} style={{ transform: `translate3d(${dragOrigin.x + 14}px, ${dragOrigin.y + 14}px, 0)` }} aria-hidden="true">{dragged.name || "Recruit"}</div>}
    <span className="sr-only" role="status" aria-live="polite">Showing {CAROUSEL_SECTIONS[activeIndex]}, section {activeIndex + 1} of {CAROUSEL_SECTIONS.length}.</span>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>;
}
