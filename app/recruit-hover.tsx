"use client";
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import RecruitCommunications from "./recruit-communications";
import { RecruitHoverCard, type HoverAnchor, type PipelineRecruit } from "./recruit-pipeline";
import RecruitQuickActions, { AddActivityButtons } from "./recruit-quick-actions";

const nameOf = (recruit: PipelineRecruit) => [recruit.firstName, recruit.lastName].filter(Boolean).join(" ") || recruit.name || `Recruit ${recruit.id}`;
const anchorFor = (element: HTMLElement, id: string): HoverAnchor => {
  const box = element.getBoundingClientRect();
  return { id, top: box.top, bottom: box.bottom, left: box.left, right: box.right };
};

/**
 * A hover card's small quick links in one row: Note, Task, Meeting and Calendar (for accounts that can save to
 * HubSpot), then Call, Text and Email. onOpenChange keeps the card open while one of their pop-ups is in use.
 */
export function MiniActionBar({ recruit, canAdd, onOpenChange }: { recruit: PipelineRecruit; canAdd: boolean; onOpenChange?: (open: boolean) => void }) {
  const name = nameOf(recruit);
  return <div className="mini-actions" role="group" aria-label={`Quick actions for ${name}`}>
    {canAdd && <RecruitQuickActions recruitId={recruit.id} recruitName={name} kinds={["note", "task", "meeting"]} trigger="mini" onOpenChange={onOpenChange} />}
    {canAdd && <RecruitQuickActions recruitId={recruit.id} recruitName={name} kinds={["meeting"]} meetingLabel="Add to Calendar" trigger="mini" onOpenChange={onOpenChange} />}
    <RecruitCommunications mini recruitName={name} recruitId={recruit.id} phone={recruit.phone} hubspotUrl={recruit.hubspotUrl ?? ""} isDemo={recruit.isDemo} />
  </div>;
}

// More for one name's card: extra content below the details (built only when the card opens), replacement rows when
// only a few details are known, and actions: false for someone with no recruiting record to save to.
export type HoverExtras = { extra?: () => ReactNode; rows?: [string, string][]; actions?: boolean };

/**
 * The pipeline's recruit details card for names elsewhere, such as the Recruits page: spread bind(recruit) on a name
 * and render card once. It opens beside the name on hover or keyboard focus, stays while the pointer is on it, and
 * closes on page scroll, Escape or leaving. canAdd adds the Add buttons for live recruits; the card stays open while
 * one of their pop-ups is in use. mini swaps those buttons and the Call, Text and Email row for one row of small
 * quick links (as in Event Attendance).
 */
export function useRecruitHoverCard({ now, canAdd, mini = false }: { now: number; canAdd: boolean; mini?: boolean }) {
  const id = useId();
  const [hovered, setHovered] = useState<{ recruit: PipelineRecruit; anchor: HoverAnchor; extras?: HoverExtras } | null>(null);
  const timerRef = useRef(0);
  const pinnedRef = useRef(false);
  const hide = useCallback(() => { if (pinnedRef.current) return; window.clearTimeout(timerRef.current); setHovered(null); }, []);
  // A short grace period lets the pointer travel from the name into the card to use its buttons.
  const scheduleHide = useCallback(() => { window.clearTimeout(timerRef.current); timerRef.current = window.setTimeout(() => { if (!pinnedRef.current) setHovered(null); }, 300); }, []);
  const keep = useCallback(() => window.clearTimeout(timerRef.current), []);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  useEffect(() => {
    if (!hovered) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    // Scrolling the page moves the name away, but scrolling a long card's own answers keeps it open.
    const scroll = (event: Event) => { if (event.target instanceof Node && document.getElementById(id)?.contains(event.target)) return; hide(); };
    // Opening a recruit or another page removes the name, so the card goes with it.
    window.addEventListener("scroll", scroll, true); window.addEventListener("resize", hide); window.addEventListener("blur", hide); window.addEventListener("hashchange", hide); document.addEventListener("keydown", escape);
    return () => { window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", hide); window.removeEventListener("blur", hide); window.removeEventListener("hashchange", hide); document.removeEventListener("keydown", escape); };
  }, [hovered, hide, id]);
  const pin = (open: boolean) => {
    pinnedRef.current = open; window.clearTimeout(timerRef.current);
    if (!open && !document.getElementById(id)?.matches(":hover")) setHovered(null);
  };
  // Spread on the name, or on an element around it: keyboard focus on the name inside also opens the card.
  const bind = (recruit: PipelineRecruit, extras?: HoverExtras) => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch") return;
      const element = event.currentTarget;
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setHovered({ recruit, anchor: anchorFor(element, recruit.id), extras }), 180);
    },
    onPointerLeave: scheduleHide,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (!(event.target instanceof HTMLElement) || !event.target.matches(":focus-visible")) return;
      window.clearTimeout(timerRef.current); setHovered({ recruit, anchor: anchorFor(event.currentTarget, recruit.id), extras });
    },
    onBlur: hide,
    "aria-describedby": hovered?.recruit.id === recruit.id ? id : undefined,
  });
  const recruit = hovered?.recruit;
  const extras = hovered?.extras;
  const live = Boolean(recruit && !recruit.isDemo && extras?.actions !== false);
  const card = hovered && recruit ? <RecruitHoverCard recruit={recruit} anchor={hovered.anchor} id={id} now={now} stageLabel={recruit.stage || (extras?.rows ? "" : "Not recorded")} hint="" onPointerEnter={keep} onPointerLeave={scheduleHide}
    rows={extras?.rows} extra={extras?.extra?.()}
    communications={mini ? live ? <MiniActionBar recruit={recruit} canAdd={canAdd} onOpenChange={pin} /> : null : undefined}
    actions={!mini && canAdd && live ? <AddActivityButtons recruitId={recruit.id} recruitName={nameOf(recruit)} onOpenChange={pin} /> : undefined} /> : null;
  return { bind, card };
}
