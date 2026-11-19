"use client";
import { useEffect, useState } from "react";
import InboxWorkspace from "./inbox-workspace";
const noop = () => {};
type Connection = { canRead: boolean; mailbox?: string; webAppEmail?: string; hubspotIdentity?: string; connection?: string };
const SETTINGS = "https://app.hubspot.com/settings/50894788/inbox/inboxes";
const connectionLabels: Record<string, string> = { connected: "Connected", "connection-required": "Mailbox not connected", "authorization-required": "Google authorization required", "private-inbox-required": "Private inbox setup required", ambiguous: "Multiple connections need review", unavailable: "Unable to verify connection" };
const connectionLabel = (value?: string) => connectionLabels[value ?? "unavailable"] ?? "Checking connection";
export default function PrivateEmailPanel({ onUnauthorized = noop, compact = true, disabled = false, refreshKey = 0 }: { onUnauthorized?: () => void; compact?: boolean; disabled?: boolean; refreshKey?: number }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    void (async () => {
      setChecking(true);
      try {
        const response = await fetch("/api/email?connection=1", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
        if (response.status === 401) { onUnauthorized(); return; }
        const result = await response.json();
        if (!response.ok) throw Error();
        if (!controller.signal.aborted) { setConnection(result); setError(""); }
      } catch { if (!controller.signal.aborted) setError("Email connection could not be checked. Try again."); }
      finally { if (!controller.signal.aborted) setChecking(false); }
    })();
    return () => controller.abort();
  }, [disabled, onUnauthorized, refreshKey, attempt]);
  if (disabled) return <p className="helper">Received email is unavailable in demo mode.</p>;
  if (connection?.canRead === false) return <p className="helper">Received email is private to the connected mailbox owner. Recruit recipients are available in the other tab.</p>;
  const Heading = compact ? "h3" : "h2";
  return <div className="email-received">
    <div className="email-connection-card" aria-label="Email connection">
      <div className="email-connection-heading"><Heading>Email connection</Heading><button type="button" className="btn btn-secondary" disabled={checking} onClick={() => setAttempt(value => value + 1)}>{checking ? "Checking…" : "Check connection"}</button></div>
      {error && <p role="alert">{error}</p>}
      {connection?.canRead ? <>
        <dl><div><dt>Signed into the app</dt><dd>{connection.webAppEmail ?? connection.mailbox}</dd></div><div><dt>HubSpot user</dt><dd>{connection.hubspotIdentity === "matched" ? "Email matches your HubSpot user" : connection.hubspotIdentity === "missing" ? "Matching HubSpot user not found" : connection.hubspotIdentity === "ambiguous" ? "Multiple matching users need review" : "Unable to verify user"}</dd></div><div><dt>Received mailbox</dt><dd role="status">{connectionLabel(connection.connection)}</dd></div></dl>
        {connection.connection !== "connected" && <p>Google sign-in does not connect your mailbox. Connect your email to a dedicated HubSpot Conversations Inbox restricted to you, then complete Google authorization. Your CRM administrator can then finish connecting the private inbox to this app.</p>}
        <a className="text-link" href={SETTINGS} target="_blank" rel="noopener noreferrer">{connection.connection === "connected" ? "Manage HubSpot mailbox" : "Set up HubSpot mailbox"} ↗</a>
      </> : !error && <p role="status">Checking your email connection…</p>}
    </div>
    {connection?.canRead && connection.connection === "connected" && <InboxWorkspace compact onUnauthorized={onUnauthorized} endpoint="/api/email" label="Received email" headingLevel={compact ? 3 : 2} showCompose={false} showSectionToggle={false} refreshKey={refreshKey + attempt} />}
  </div>;
}
