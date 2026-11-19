"use client";
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { RecruitHoverCard, type HoverAnchor, type PipelineRecruit } from "./recruit-pipeline";
import { AddActivityButtons } from "./recruit-quick-actions";

const nameOf = (recruit: PipelineRecruit) => [recruit.firstName, recruit.lastName].filter(Boolean).join(" ") || recruit.name || `Recruit ${recruit.id}`;
const anchorFor = (element: HTMLElement, id: string): HoverAnchor => {
  const box = element.getBoundingClientRect();
  return { id, top: box.top, bottom: box.bottom, left: box.left, right: box.right };
};

/**
 * The pipeline's recruit details card for names elsewhere, such as the Recruits page: spread bind(recruit) on a name
 * and render card once. It opens beside the name on hover or keyboard focus, stays while the pointer is on it, and
 * closes on scroll, Escape or leaving. canAdd adds the five Add buttons for live recruits; the card stays open while
 * one of their pop-ups is in use.
 */
export function useRecruitHoverCard({ now, canAdd }: { now: number; canAdd: boolean }) {
  const id = useId();
  const [hovered, setHovered] = useState<{ recruit: PipelineRecruit; anchor: HoverAnchor } | null>(null);
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
    // Opening a recruit or another page removes the name, so the card goes with it.
    window.addEventListener("scroll", hide, true); window.addEventListener("resize", hide); window.addEventListener("blur", hide); window.addEventListener("hashchange", hide); document.addEventListener("keydown", escape);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); window.removeEventListener("blur", hide); window.removeEventListener("hashchange", hide); document.removeEventListener("keydown", escape); };
  }, [hovered, hide]);
  const pin = (open: boolean) => {
    pinnedRef.current = open; window.clearTimeout(timerRef.current);
    if (!open && !document.getElementById(id)?.matches(":hover")) setHovered(null);
  };
  const bind = (recruit: PipelineRecruit) => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch") return;
      const element = event.currentTarget;
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setHovered({ recruit, anchor: anchorFor(element, recruit.id) }), 180);
    },
    onPointerLeave: scheduleHide,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.matches(":focus-visible")) return;
      window.clearTimeout(timerRef.current); setHovered({ recruit, anchor: anchorFor(event.currentTarget, recruit.id) });
    },
    onBlur: hide,
    "aria-describedby": hovered?.recruit.id === recruit.id ? id : undefined,
  });
  const recruit = hovered?.recruit;
  const card = hovered && recruit ? <RecruitHoverCard recruit={recruit} anchor={hovered.anchor} id={id} now={now} stageLabel={recruit.stage || "Not recorded"} hint="" onPointerEnter={keep} onPointerLeave={scheduleHide}
    actions={canAdd && !recruit.isDemo ? <AddActivityButtons recruitId={recruit.id} recruitName={nameOf(recruit)} onOpenChange={pin} /> : undefined} /> : null;
  return { bind, card };
}
