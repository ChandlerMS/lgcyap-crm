"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { communicationCommand, RINGCENTRAL_ORIGIN, ringCentralStatus, ringCentralUrl } from "./ringcentral-bridge.mjs";

type Intent = { action: "call" | "text"; phone: string; name: string };
type Communications = { configured: boolean; open: (intent: Intent) => void };
const Context = createContext<Communications>({ configured: false, open: () => {} });
export const useRingCentral = () => useContext(Context);

export default function RingCentralPanel({ clientId, isDemo, children }: { clientId: string; isDemo: boolean; children: ReactNode }) {
  const src = ringCentralUrl(clientId);
  const frame = useRef<HTMLIFrameElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const status = ringCentralStatus(event, frame.current?.contentWindow);
      if (!status) return;
      if ("loggedIn" in status) { setLoggedIn(status.loggedIn!); if (!status.loggedIn) setReady(false); }
      if ("ready" in status) setReady(status.ready!);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => { if (expanded && !isDemo) heading.current?.focus(); }, [expanded, isDemo]);

  function reveal(next?: Intent) {
    if (!src || isDemo) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLoaded(true); setExpanded(true); setIntent(next ?? null); setNotice("");
    // No queued action after sign-in: the user explicitly prepares the number below.
  }
  function minimize() { setExpanded(false); trigger.current?.focus(); }
  function prepare() {
    if (!intent || !loggedIn || isDemo || (intent.action === "call" && !ready)) return;
    const command = communicationCommand(intent.action, intent.phone, isDemo);
    if (!command || !frame.current?.contentWindow) return;
    frame.current.contentWindow.postMessage(command, RINGCENTRAL_ORIGIN);
    setNotice(intent.action === "call" ? "Number prepared. Review it and press Dial in RingCentral to call." : "Conversation opened. Write and send your message in RingCentral.");
  }
  return <Context.Provider value={{ configured: Boolean(src) && !isDemo, open: reveal }}>
    {children}
    {src && <>
      <button className="rc-launcher btn btn-secondary" hidden={isDemo || expanded} onClick={() => reveal()} aria-expanded={expanded} aria-controls="ringcentral-panel">RingCentral{loggedIn ? " · Signed in" : ""}</button>
      {loaded && <section id="ringcentral-panel" className="rc-panel" hidden={!expanded || isDemo} aria-labelledby="rc-title" onKeyDown={event => { if (event.key === "Escape") minimize(); }}>
        <header className="rc-panel-header"><div><h2 id="rc-title" ref={heading} tabIndex={-1}>RingCentral</h2><p role="status">{loggedIn ? "Signed in to RingCentral" : "Sign in with your RingCentral account below"}</p></div><button type="button" className="btn btn-quiet" onClick={minimize} aria-label="Minimize RingCentral">−</button></header>
        {intent && <div className="rc-recipient"><strong>{intent.name}</strong><span>{intent.phone}</span><button className="btn btn-primary" disabled={!loggedIn || (intent.action === "call" && !ready)} onClick={prepare}>{intent.action === "call" ? "Prepare call" : "Open text conversation"}</button>{notice && <p role="status">{notice}</p>}</div>}
        <iframe ref={frame} title="RingCentral phone and text messages" src={src} allow="autoplay; microphone https://apps.ringcentral.com" className="rc-frame" />
        <p className="rc-panel-footnote">Calls and texts use your RingEX line. HubSpot activity sync for this embedded phone is not connected yet.</p>
      </section>}
    </>}
  </Context.Provider>;
}
