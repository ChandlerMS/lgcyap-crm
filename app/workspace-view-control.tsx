"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Keep this beside the app shell, outside both its hidden chrome and mobile inert region.
export default function WorkspaceViewControl({ onHideChrome }: { onHideChrome: () => void }) {
  const [fullscreen, setFullscreen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const html = document.documentElement;
    if (fullscreen) html.dataset.workspaceFullscreen = "true";
    else delete html.dataset.workspaceFullscreen;
    if (!fullscreen) return;
    const restore = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || target !== document.body && target !== button.current && !target.closest(".app-shell")) return;
      event.preventDefault();
      setFullscreen(false);
      button.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", restore);
    return () => { delete html.dataset.workspaceFullscreen; window.removeEventListener("keydown", restore); };
  }, [fullscreen]);

  const label = fullscreen ? "Restore sidebar and title bar" : "Hide sidebar and title bar";
  return <button ref={button} type="button" className="workspace-view-control" aria-label={label} title={label} aria-controls="main-sidebar crm-workspace-chrome" aria-pressed={fullscreen} aria-expanded={!fullscreen} onClick={() => {
    if (!fullscreen) onHideChrome();
    setFullscreen(value => !value);
    button.current?.focus({ preventScroll: true });
  }}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={fullscreen ? "M12 5v14m-6-6 6 6 6-6" : "M12 19V5m-6 6 6-6 6 6"} /></svg></button>;
}
