"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { communicationCommand, RINGCENTRAL_ORIGIN, ringCentralStatus, ringCentralUrl } from "./ringcentral-bridge.mjs";

import FloatingLauncher, { FloatingActions } from "./floating-launcher";

type Intent = { action: "call" | "text"; phone: string; name: string };
type Communications = { configured: boolean; open: (intent: Intent) => void };
const Context = createContext<Communications>({ configured: false, open: () => {} });
export const useRingCentral = () => useContext(Context);

export default function RingCentralPanel({ clientId, isDemo, children }: { clientId: string; isDemo: boolean; children: ReactNode }) {
  const src = ringCentralUrl(clientId);
  const frame = useRef<HTMLIFrameElement>(null);
  const whatsAppWindow = useRef<Window | null>(null);
  const [whatsAppExpanded, setWhatsAppExpanded] = useState(false);
  const [whatsAppBlocked, setWhatsAppBlocked] = useState(false);
  const policyTekLauncher = useRef<HTMLButtonElement>(null);
  const policyTekHeading = useRef<HTMLHeadingElement>(null);
  const [policyTekLoaded, setPolicyTekLoaded] = useState(false);
  const [policyTekExpanded, setPolicyTekExpanded] = useState(false);
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

  useEffect(() => { if (policyTekExpanded) policyTekHeading.current?.focus(); }, [policyTekExpanded]);

  function reveal(next?: Intent) {
    if (!src || isDemo || next?.action === "text") return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPolicyTekExpanded(false);
    setLoaded(true); setExpanded(true); setIntent(next ?? null); setNotice("");
    // No queued action after sign-in: the user explicitly prepares the number below.
  }
  useEffect(() => {
    if (!whatsAppExpanded) return;
    const poll = window.setInterval(() => {
      if (whatsAppWindow.current?.closed) setWhatsAppExpanded(false);
    }, 1000);
    return () => window.clearInterval(poll);
  }, [whatsAppExpanded]);
  function collapseWhatsApp() {
    whatsAppWindow.current?.close();
    whatsAppWindow.current = null;
    setWhatsAppExpanded(false);
  }
  function expandRingCentral() {
    if (!loaded) { reveal(); return; }
    setPolicyTekExpanded(false);
    setExpanded(true);
  }
  function openWhatsApp() {
    if (whatsAppWindow.current && !whatsAppWindow.current.closed) {
      whatsAppWindow.current.focus();
      setWhatsAppExpanded(true);
      setWhatsAppBlocked(false);
      return;
    }
    const popup = window.open("about:blank", "legacy-whatsapp", "popup=yes,width=1100,height=800,resizable=yes,scrollbars=yes");
    setWhatsAppBlocked(!popup);
    if (!popup) return;
    popup.opener = null;
    popup.location.replace("https://web.whatsapp.com/");
    whatsAppWindow.current = popup;
    setWhatsAppExpanded(true);
    popup.focus();
  }
  function openPolicyTek() {
    setExpanded(false);
    setPolicyTekLoaded(true);
    setPolicyTekExpanded(true);
  }
  function minimizePolicyTek() {
    setPolicyTekExpanded(false);
    policyTekLauncher.current?.focus();
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
    <FloatingActions><div id="legacy-bot-dock" className="floating-actions-ai" /><div className="floating-actions-communications"><FloatingLauncher className="legacy-bot-launcher whatsapp-launcher" expanded={whatsAppExpanded} onExpand={openWhatsApp} onCollapse={collapseWhatsApp} aria-label={whatsAppExpanded ? "Close WhatsApp window" : "Open WhatsApp in a separate window"}><span className="launcher-brand-icon" aria-hidden="true" style={{ backgroundImage: "url(/launcher-icons/whatsapp.ico)" }} /><span>WhatsApp</span></FloatingLauncher><FloatingLauncher ref={policyTekLauncher} className="legacy-bot-launcher policytek-launcher" onExpand={openPolicyTek} onCollapse={minimizePolicyTek} aria-label={policyTekExpanded ? "Collapse PolicyTek dialer" : "Open PolicyTek dialer"} expanded={policyTekExpanded} aria-controls="policytek-panel"><span className="launcher-brand-icon" aria-hidden="true" style={{ backgroundImage: "url(/launcher-icons/policytek.ico)" }} /><span>PolicyTek</span></FloatingLauncher>{/* Same pill as the Legacy Bot button beside it: gold outline, black fill, icon and name. */}{src && <FloatingLauncher className="legacy-bot-launcher rc-launcher" hidden={isDemo} onExpand={expandRingCentral} onCollapse={minimize} expanded={expanded} aria-label={expanded ? "Collapse RingCentral" : "Open RingCentral"} aria-controls="ringcentral-panel"><span className="launcher-brand-icon" aria-hidden="true" style={{ backgroundImage: "url(/launcher-icons/ringcentral.ico)" }} /><span>RingCentral{loggedIn ? " · Signed in" : ""}</span></FloatingLauncher>}</div></FloatingActions>
      {whatsAppBlocked && <div className="whatsapp-popup-notice" role="alert">Allow popups to open WhatsApp in a separate window, or <a href="https://web.whatsapp.com/" target="_blank" rel="noopener noreferrer">open WhatsApp in a new tab</a>.<button type="button" className="btn btn-quiet" aria-label="Dismiss WhatsApp notice" onClick={() => setWhatsAppBlocked(false)}>×</button></div>}
      {policyTekLoaded && <section id="policytek-panel" className="rc-panel policytek-panel" hidden={!policyTekExpanded} aria-labelledby="policytek-title" onKeyDown={event => { if (event.key === "Escape") minimizePolicyTek(); }}>
        <header className="rc-panel-header"><div><h2 id="policytek-title" ref={policyTekHeading} tabIndex={-1}>PolicyTek</h2><p>Sign in with your PolicyTek account below</p></div><button type="button" className="btn btn-quiet" onClick={minimizePolicyTek} aria-label="Minimize PolicyTek">−</button></header>
        <iframe title="PolicyTek dialer" src="https://dialer.policytek.com" allow="autoplay; microphone https://dialer.policytek.com" className="rc-frame policytek-frame" />
      </section>}
      {src && loaded && <section id="ringcentral-panel" className="rc-panel" hidden={!expanded || isDemo} aria-labelledby="rc-title" onKeyDown={event => { if (event.key === "Escape") minimize(); }}>
        <header className="rc-panel-header"><div><h2 id="rc-title" ref={heading} tabIndex={-1}>RingCentral</h2><p role="status">{loggedIn ? "Signed in to RingCentral" : "Sign in with your RingCentral account below"}</p></div><button type="button" className="btn btn-quiet" onClick={minimize} aria-label="Minimize RingCentral">−</button></header>
        {intent && <div className="rc-recipient"><strong>{intent.name}</strong><span>{intent.phone}</span><button className="btn btn-primary" disabled={!loggedIn || (intent.action === "call" && !ready)} onClick={prepare}>{intent.action === "call" ? "Prepare call" : "Open text conversation"}</button>{loggedIn && intent.action === "call" && !ready && <p>Browser calling is not ready. Check your RingCentral line and microphone permissions.</p>}{notice && <p role="status">{notice}</p>}</div>}
        <iframe ref={frame} title="RingCentral phone" src={src} allow="autoplay; microphone https://apps.ringcentral.com" className="rc-frame" />
        <p className="rc-panel-footnote">Call history is logged by RingCentral’s HubSpot Activity Sync. Matching calls appear on the linked contact’s recruit profile after HubSpot updates. Recordings and transcripts appear when provided. Texting is paused.</p>
      </section>}
  </Context.Provider>;
}
