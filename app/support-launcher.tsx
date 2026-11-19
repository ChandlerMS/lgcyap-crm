"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FloatingLauncher from "./floating-launcher";

const SUPPORT_URL = "https://50894788.hs-sites.com/legacy-partners-knowledge/kb-tickets/new";

export default function SupportLauncher() {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (expanded) title.current?.focus(); }, [expanded]);
  const close = () => { setExpanded(false); launcher.current?.focus({ preventScroll: true }); };
  return <>
    <FloatingLauncher ref={launcher} className="legacy-bot-launcher support-launcher" title="Support" expanded={expanded} onExpand={() => { setLoaded(true); setExpanded(true); }} onCollapse={close} aria-controls="support-panel" aria-label={expanded ? "Collapse Support" : "Open Support"}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /><path d="m5 5 4.2 4.2M14.8 14.8 19 19M5 19l4.2-4.2M14.8 9.2 19 5" /></svg>
      <span className="sr-only">Support</span>
    </FloatingLauncher>
    {loaded && createPortal(<section id="support-panel" className="rc-panel support-panel" role="dialog" aria-labelledby="support-title" hidden={!expanded} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <header className="support-header"><h2 ref={title} id="support-title" tabIndex={-1}>Support</h2><a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">Open in new tab ↗</a><button type="button" className="btn btn-quiet" aria-label="Close Support" onClick={close}>×</button></header>
      <iframe src={SUPPORT_URL} title="Legacy Agency Partners support ticket" />
    </section>, document.body)}
  </>;
}
