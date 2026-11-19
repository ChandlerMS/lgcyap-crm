"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function SummaryPreview({ id, heading, children, enabled }: { id: string; heading: ReactNode; children: ReactNode; enabled: boolean }) {
  const anchor = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 360 });
  const show = () => { if (timer.current) clearTimeout(timer.current); if (enabled) setOpen(true); };
  const hide = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { if (!panel.current?.contains(document.activeElement) && !anchor.current?.contains(document.activeElement)) setOpen(false); }, 200); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = anchor.current?.getBoundingClientRect(); if (!rect) return;
      const width = Math.min(360, innerWidth - 24), height = panel.current?.offsetHeight ?? 250;
      const below = rect.bottom + 4;
      setPosition({ width, left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), top: Math.max(12, below + height <= innerHeight - 12 ? below : rect.top - height - 4) });
    };
    measure(); const observer = new ResizeObserver(measure); if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open]);
  return <div className="summary-chips-heading" ref={anchor} onMouseEnter={show} onMouseLeave={hide} onFocus={event => { if (!panel.current?.contains(event.relatedTarget)) show(); }} onBlur={event => { if (!panel.current?.contains(event.relatedTarget) && !anchor.current?.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === "Escape") { setOpen(false); event.stopPropagation(); }
    if (event.key === "ArrowDown" && enabled) { event.preventDefault(); show(); requestAnimationFrame(() => panel.current?.querySelector<HTMLAnchorElement>("a")?.focus()); }
  }}>
    {heading}
    {open && createPortal(<div id={id} ref={panel} className="summary-preview" style={{ display: "block", position: "fixed", ...position, left: `max(12px, min(${position.left}px, calc(100vw - 372px)))`, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100dvh - 24px)", overflowY: "auto", zIndex: 95 }} onMouseEnter={show} onMouseLeave={hide} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); anchor.current?.querySelector<HTMLAnchorElement>("a")?.focus(); } }}>{children}</div>, document.body)}
  </div>;
}
