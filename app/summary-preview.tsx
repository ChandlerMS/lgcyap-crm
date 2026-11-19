"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// width is the pop-up's width when the window allows (460px; Calendar's calendar asks for more).
export default function SummaryPreview({ id, heading, children, enabled, width: wanted = 460, persist = false, onClose, tall = false }: { id: string; heading: ReactNode; children: ReactNode; enabled: boolean; width?: number; persist?: boolean; onClose?: () => void; tall?: boolean }) {
  const anchor = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 360 });
  const show = () => { if (timer.current) clearTimeout(timer.current); if (enabled) { setShown(true); setOpen(true); } };
  const close = () => { setOpen(false); onClose?.(); };
  // A short grace period lets the pointer travel between the title and its popup.
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(function check() {
      if (panel.current?.hidden) return;
      // A separately opened modal must finish before its host can unmount.
      if (panel.current?.querySelector("dialog[open]")) { timer.current = setTimeout(check, 300); return; }
      if (panel.current?.matches(":hover") || anchor.current?.matches(":hover")) return;
      close();
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
  }, [open, wanted, tall]);
  return <div className="summary-chips-heading" ref={anchor} onMouseEnter={show} onMouseLeave={hide} onFocus={event => { if (!panel.current?.contains(event.relatedTarget)) show(); }} onBlur={event => { if (!panel.current?.contains(event.relatedTarget) && !anchor.current?.contains(event.relatedTarget)) close(); }} onKeyDown={event => {
    if (event.key === "Escape") { close(); event.stopPropagation(); }
    if (event.key === "ArrowDown" && enabled) { event.preventDefault(); show(); requestAnimationFrame(() => panel.current?.querySelector<HTMLAnchorElement>("a")?.focus()); }
  }}>
    {heading}
    {shown && (open || persist) && createPortal(<div id={id} ref={panel} className="summary-preview" hidden={!open} style={{ display: open ? tall ? "flex" : "block" : "none", flexDirection: tall ? "column" : undefined, height: tall ? "calc(100dvh - 24px)" : undefined, position: "fixed", ...position, left: `max(12px, min(${position.left}px, calc(100vw - ${wanted + 12}px)))`, maxWidth: "calc(100vw - 24px)", maxHeight: tall ? "calc(100dvh - 24px)" : "min(72dvh, 680px)", overflowY: tall ? "hidden" : "auto", overscrollBehavior: "contain", zIndex: 95 }} onMouseEnter={show} onMouseLeave={hide} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); anchor.current?.querySelector<HTMLAnchorElement>("a")?.focus(); close(); } }}>{persist && <button type="button" className="text-link summary-preview-close" onClick={() => { anchor.current?.querySelector<HTMLAnchorElement>("a")?.focus(); close(); }}>Close preview</button>}{children}</div>, document.body)}
  </div>;
}
