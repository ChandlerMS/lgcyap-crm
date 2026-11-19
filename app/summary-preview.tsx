"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// width is the pop-up's width when the window allows (460px; Calendar's calendar asks for more).
export default function SummaryPreview({ id, heading, children, enabled, width: wanted = 460, persist = false, keepOpen = false }: { id: string; heading: ReactNode; children: ReactNode; enabled: boolean; width?: number; persist?: boolean; keepOpen?: boolean }) {
  const anchor = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState(false);
  const keepOpenRef = useRef(keepOpen);
  useEffect(() => { keepOpenRef.current = keepOpen; }, [keepOpen]);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 360 });
  const show = () => { if (timer.current) clearTimeout(timer.current); if (enabled) { setShown(true); setOpen(true); } };
  // Leaving the title and the pop-up closes it after a short pause (time to move from one to the other). A pop-up
  // opened from inside, such as Add Task, keeps it until that closes.
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(function check() {
      if (panel.current?.hidden) return;
      // So does a date box whose picker is open (Calendar's Go to date); choosing a date leaves the box.
      const picking = document.activeElement instanceof HTMLInputElement && document.activeElement.type === "date" && panel.current?.contains(document.activeElement);
      if (keepOpenRef.current || panel.current?.querySelector("dialog[open]") || picking) { timer.current = setTimeout(check, 300); return; }
      if (panel.current?.matches(":hover") || anchor.current?.matches(":hover")) return;
      setOpen(false);
    }, 200);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = anchor.current?.getBoundingClientRect(); if (!rect) return;
      const width = Math.min(wanted, innerWidth - 24), height = panel.current?.offsetHeight ?? 250;
      const below = rect.bottom + 4;
      setPosition({ width, left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), top: Math.max(12, below + height <= innerHeight - 12 ? below : rect.top - height - 4) });
    };
    measure(); const observer = new ResizeObserver(measure); if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, wanted]);
  return <div className="summary-chips-heading" ref={anchor} onMouseEnter={show} onMouseLeave={hide} onFocus={event => { if (!panel.current?.contains(event.relatedTarget)) show(); }} onBlur={event => { if (!keepOpen && !panel.current?.contains(event.relatedTarget) && !anchor.current?.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === "Escape") { setOpen(false); event.stopPropagation(); }
    if (event.key === "ArrowDown" && enabled) { event.preventDefault(); show(); requestAnimationFrame(() => panel.current?.querySelector<HTMLAnchorElement>("a")?.focus()); }
  }}>
    {heading}
    {shown && (open || persist) && createPortal(<div id={id} ref={panel} className="summary-preview" hidden={!open} style={{ display: open ? "block" : "none", position: "fixed", ...position, left: `max(12px, min(${position.left}px, calc(100vw - ${wanted + 12}px)))`, maxWidth: "calc(100vw - 24px)", maxHeight: "min(72dvh, 680px)", overflowY: "auto", overscrollBehavior: "contain", zIndex: 95 }} onMouseEnter={show} onMouseLeave={hide} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); anchor.current?.querySelector<HTMLAnchorElement>("a")?.focus(); setOpen(false); } }}>{persist && <button type="button" className="text-link summary-preview-close" onClick={() => { anchor.current?.querySelector<HTMLAnchorElement>("a")?.focus(); setOpen(false); }}>Close preview</button>}{children}</div>, document.body)}
  </div>;
}
