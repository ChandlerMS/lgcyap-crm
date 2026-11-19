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
  const policyTekWindow = useRef<Window | null>(null);
  const [policyTekBlocked, setPolicyTekBlocked] = useState(false);
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
    if (!src || isDemo || next?.action === "text") return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLoaded(true); setExpanded(true); setIntent(next ?? null); setNotice("");
    // No queued action after sign-in: the user explicitly prepares the number below.
  }
  function openPolicyTek() {
    if (policyTekWindow.current && !policyTekWindow.current.closed) {
      policyTekWindow.current.focus();
      return;
    }
    // Open directly from the click so browsers can allow the dialer popup.
    const popup = window.open("about:blank", "policytek-dialer", "popup=yes,width=440,height=760,resizable=yes,scrollbars=yes");
    setPolicyTekBlocked(!popup);
    if (!popup) return;
    popup.opener = null;
    popup.location.replace("https://dialer.policytek.com");
    policyTekWindow.current = popup;
    popup.focus();
  }
  function minimize() { setExpanded(false); trigger.current?.focus(); }
  function prepare() {
    if (!intent || intent.action !== "call" || !loggedIn || isDemo || !ready) return;
    const command = communicationCommand(intent.action, intent.phone, isDemo);
    if (!command || !frame.current?.contentWindow) return;
    frame.current.contentWindow.postMessage(command, RINGCENTRAL_ORIGIN);
    setNotice("Call preparation requested. Review the number and calling status in RingCentral before dialing.");
  }
  return <Context.Provider value={{ configured: Boolean(src) && !isDemo, open: reveal }}>
    {children}
    <div className="floating-actions"><div id="legacy-bot-dock" /><button type="button" className="legacy-bot-launcher policytek-launcher" onClick={openPolicyTek} aria-label="Open PolicyTek dialer in a floating window"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.09 4.2 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.79a2 2 0 0 1-.45 2.11L8.06 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.34 1.83.58 2.79.7A2 2 0 0 1 22 16.92z" /></svg><span>PolicyTek</span></button>{/* Same pill as the Legacy Bot button beside it: gold outline, black fill, icon and name. */}{src && <button type="button" className="legacy-bot-launcher rc-launcher" hidden={isDemo || expanded} onClick={() => reveal()} aria-expanded={expanded} aria-controls="ringcentral-panel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.09 4.2 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.79a2 2 0 0 1-.45 2.11L8.06 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.34 1.83.58 2.79.7A2 2 0 0 1 22 16.92z" /></svg><span>RingCentral{loggedIn ? " · Signed in" : ""}</span></button>}</div>
      {policyTekBlocked && <div className="policytek-popup-notice" role="alert">Allow popups to open the PolicyTek dialer, or <a href="https://dialer.policytek.com" target="_blank" rel="noopener noreferrer">open PolicyTek in a new tab</a>.<button type="button" className="btn btn-quiet" aria-label="Dismiss PolicyTek notice" onClick={() => setPolicyTekBlocked(false)}>×</button></div>}
      {src && loaded && <section id="ringcentral-panel" className="rc-panel" hidden={!expanded || isDemo} aria-labelledby="rc-title" onKeyDown={event => { if (event.key === "Escape") minimize(); }}>
        <header className="rc-panel-header"><div><h2 id="rc-title" ref={heading} tabIndex={-1}>RingCentral</h2><p role="status">{loggedIn ? "Signed in to RingCentral" : "Sign in with your RingCentral account below"}</p></div><button type="button" className="btn btn-quiet" onClick={minimize} aria-label="Minimize RingCentral">−</button></header>
        {intent && <div className="rc-recipient"><strong>{intent.name}</strong><span>{intent.phone}</span><button className="btn btn-primary" disabled={!loggedIn || (intent.action === "call" && !ready)} onClick={prepare}>{intent.action === "call" ? "Prepare call" : "Open text conversation"}</button>{loggedIn && intent.action === "call" && !ready && <p>Browser calling is not ready. Check your RingCentral line and microphone permissions.</p>}{notice && <p role="status">{notice}</p>}</div>}
        <iframe ref={frame} title="RingCentral phone" src={src} allow="autoplay; microphone https://apps.ringcentral.com" className="rc-frame" />
        <p className="rc-panel-footnote">Call history is logged by RingCentral’s HubSpot Activity Sync. Matching calls appear on the linked contact’s recruit profile after HubSpot updates. Recordings and transcripts appear when provided. Texting is paused.</p>
      </section>}
  </Context.Provider>;
}
