"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Portaling outside the scrollable sidebar prevents its overflow from clipping the flyout.
export default function SidebarFlyout({ id, hidden, layoutKey, onDismiss, onEnter, onLeave, children }: { id: string; hidden: boolean; layoutKey: string; onDismiss: () => void; onEnter: () => void; onLeave: () => void; children: ReactNode }) {
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
      const left = sidebar.offsetWidth;
      const width = Math.min(300, window.innerWidth - left - 8);
      const height = panelRef.current?.offsetHeight ?? 160;
      setPosition({ left, width, top: Math.max(8, Math.min(rect.top, window.innerHeight - height - 8)) });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(sidebar);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const escape = (event: KeyboardEvent) => { if (!panelRef.current || getComputedStyle(panelRef.current).visibility !== "visible") return; if (event.key === "Escape" || event.key === "ArrowLeft" && panelRef.current?.contains(document.activeElement)) { event.preventDefault(); event.stopPropagation(); onDismiss(); trigger.focus(); } };
    const outside = (event: PointerEvent) => { if (!trigger.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) onDismiss(); };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", outside);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); document.removeEventListener("keydown", escape, true); document.removeEventListener("pointerdown", outside); };
  }, [id, hidden, layoutKey, onDismiss]);
  if (hidden || typeof document === "undefined") return null;
  return createPortal(<div id={id} ref={panelRef} className="nav-group-pages sidebar-flyout" onMouseEnter={onEnter} onMouseLeave={onLeave} style={position ? { ...position, visibility: "visible" } : { visibility: "hidden" }} onClick={event => { if ((event.target as HTMLElement).closest("a")) onDismiss(); }}>{children}</div>, document.body);
}
