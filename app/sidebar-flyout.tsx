"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Portaling outside the scrollable sidebar prevents its overflow from clipping the flyout.
export default function SidebarFlyout({ id, hidden, layoutKey, onDismiss, onEnter, onLeave, children }: { id: string; hidden: boolean; layoutKey: string; onDismiss: () => void; onEnter: () => void; onLeave: () => void; children: ReactNode }) {
  const hoverOffset = useRef<number | null>(null);
  useEffect(() => {
    const hover = (event: MouseEvent) => {
      const trigger = document.querySelector<HTMLElement>(`[aria-controls="${id}"]`);
      if (trigger?.closest(".nav-group")?.contains(event.target as Node)) hoverOffset.current = event.clientY - trigger.getBoundingClientRect().top;
    };
    const keyboard = () => { hoverOffset.current = null; };
    // Capture the entry position before React opens the menu. Keyboard openings use the row itself.
    document.addEventListener("mouseover", hover, true);
    document.addEventListener("keydown", keyboard, true);
    return () => { document.removeEventListener("mouseover", hover, true); document.removeEventListener("keydown", keyboard, true); };
  }, [id]);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (hidden) return;
    const trigger = document.querySelector<HTMLElement>(`[aria-controls="${id}"]`);
    const sidebar = trigger?.closest<HTMLElement>(".sidebar");
    if (!trigger || !sidebar) return;
    const measure = () => {
      const rect = trigger.getBoundingClientRect();
      if (!rect.width || getComputedStyle(sidebar).visibility === "hidden") { setPosition(null); return; }
      const width = Math.min(300, window.innerWidth - 16);
      const left = Math.max(8, Math.min(sidebar.getBoundingClientRect().right, window.innerWidth - width - 8));
      const height = panelRef.current?.offsetHeight ?? 160;
      setPosition({ left, width, top: Math.max(8, Math.min(rect.top + (hoverOffset.current ?? 0), window.innerHeight - height - 8)) });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(sidebar);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const escape = (event: KeyboardEvent) => { if (!panelRef.current || getComputedStyle(panelRef.current).visibility !== "visible") return; if (event.key === "Escape" || event.key === "ArrowLeft" && panelRef.current?.contains(document.activeElement)) { event.preventDefault(); event.stopPropagation(); onDismiss(); trigger.focus(); } };
    const group = trigger.closest(".nav-group") ?? trigger;
    const within = (target: EventTarget | null) => target instanceof window.Node && (group.contains(target) || Boolean(panelRef.current?.contains(target)));
    const focused = (event: FocusEvent) => { if (!within(event.target)) onDismiss(); };
    const unfocused = (event: FocusEvent) => { if (!event.relatedTarget) onDismiss(); };
    const lostWindow = () => onDismiss();
    const hiddenPage = () => { if (document.hidden) onDismiss(); };
    const outside = (event: PointerEvent) => { if (!within(event.target)) onDismiss(); };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focused);
    document.addEventListener("focusout", unfocused);
    document.addEventListener("visibilitychange", hiddenPage);
    window.addEventListener("blur", lostWindow);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); document.removeEventListener("keydown", escape, true); document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", focused); document.removeEventListener("focusout", unfocused); document.removeEventListener("visibilitychange", hiddenPage); window.removeEventListener("blur", lostWindow); };
  }, [id, hidden, layoutKey, onDismiss]);
  if (hidden || typeof document === "undefined") return null;
  return createPortal(<div id={id} ref={panelRef} className="nav-group-pages sidebar-flyout" onMouseEnter={onEnter} onMouseLeave={onLeave} style={position ? { ...position, visibility: "visible" } : { visibility: "hidden" }} onClick={event => { if ((event.target as HTMLElement).closest("a")) onDismiss(); }}>{children}</div>, document.body);
}
