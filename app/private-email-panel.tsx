"use client";
import { useEffect, useRef, useState } from "react";
const noop = () => {};
type Connection = { available: boolean; connected: boolean; email: string; inboxUrl: string; draftsUrl: string; error?: string };
const gmailLink = (value: string) => {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "mail.google.com" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
};
export default function PrivateEmailPanel({ onUnauthorized = noop, compact = true, disabled = false, refreshKey = 0, active = true }: { onUnauthorized?: () => void; compact?: boolean; disabled?: boolean; refreshKey?: number; active?: boolean }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [authorizationFailed, setAuthorizationFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState<"connect" | "disconnect" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const mutation = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    if (disabled || !active) return;
    const controller = new AbortController();
    void (async () => {
      setConnection(null); setChecking(true); setWorking(null); setError("");
      setAuthorizationFailed(new URL(window.location.href).searchParams.get("gmail") === "error");
      try {
        const response = await fetch("/api/gmail", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
        if (controller.signal.aborted || current !== generation.current) return;
        if (response.status === 401) { onUnauthorized(); return; }
        const result = await response.json();
        if (!response.ok) throw Error(result.error || "Gmail connection could not be checked. Try again.");
        if (!controller.signal.aborted && current === generation.current) setConnection(result);
      } catch (e) { if (!controller.signal.aborted && current === generation.current) setError(e instanceof Error ? e.message : "Gmail connection could not be checked. Try again."); }
      finally { if (!controller.signal.aborted && current === generation.current) setChecking(false); }
    })();
    return () => { controller.abort(); generation.current = current + 1; };
  }, [disabled, active, onUnauthorized, refreshKey, attempt]);
  const changeConnection = async (action: "connect" | "disconnect") => {
    if (mutation.current || !connection?.available || disabled) return;
    const current = generation.current;
    mutation.current = true; setWorking(action); setError("");
    try {
      const response = await fetch("/api/gmail", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }), signal: AbortSignal.timeout(45000) });
      if (current !== generation.current) return;
      if (response.status === 401) { onUnauthorized(); return; }
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Gmail connection could not be updated. Try again.");
      if (current !== generation.current) return;
      if (action === "disconnect") setConnection(previous => previous ? { ...previous, connected: false, error: undefined } : null);
      else {
        const url = new URL(result.url);
        if (url.protocol !== "https:" || url.hostname !== "accounts.google.com") throw Error("Gmail authorization is unavailable.");
        window.location.assign(url.href);
      }
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Gmail connection could not be updated. Try again."); }
    finally { mutation.current = false; if (current === generation.current) setWorking(null); }
  };
  if (disabled) return <p className="helper">Email is unavailable in demo mode.</p>;
  const Heading = compact ? "h3" : "h2";
  const inboxUrl = gmailLink(connection?.inboxUrl || "");
  const draftsUrl = gmailLink(connection?.draftsUrl || "");
  return <div className="email-received gmail-native-email">
    <div className="email-connection-card" aria-label="Gmail connection">
      <div className="email-connection-heading"><Heading>Gmail</Heading>{connection?.available !== false && <button type="button" className="btn btn-secondary" disabled={checking || Boolean(working)} onClick={() => setAttempt(value => value + 1)}>{checking ? "Checking…" : "Check connection"}</button>}</div>
      {error && <p role="alert">{error}</p>}
      {authorizationFailed && <p role="alert">Gmail authorization was not completed. Try connecting again with the Google account shown below.</p>}
      {connection ? <>
        <p>Signed in as <strong>{connection.email}</strong>.</p>
        {!connection.available ? <p role="status">Gmail drafts are not enabled for this account. Ask your administrator to finish Gmail setup.</p> : <>
          <p>Open Gmail to read received email. New Email prepares a draft for your final review and Send in Gmail.</p>
          <div className="gmail-email-actions">{inboxUrl && <a className="btn btn-primary" href={inboxUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open Gmail inbox</a>}{draftsUrl && <a className="btn btn-secondary" href={draftsUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open Gmail Drafts folder</a>}</div>
          <p role="status">{connection.connected ? "Gmail is connected for drafts." : "Gmail is not connected for drafts."}</p>
          <p className="helper">Google’s draft permission includes sending. This app only creates drafts; you send in Gmail. The app does not read your inbox.</p>
          <button type="button" className="btn btn-secondary" disabled={Boolean(working) || checking} onClick={() => void changeConnection(connection.connected ? "disconnect" : "connect")}>{working === "connect" ? "Connecting…" : working === "disconnect" ? "Disconnecting…" : connection.connected ? "Disconnect Gmail drafts" : "Connect Gmail drafts"}</button>
          {connection.connected && <p className="helper">Disconnect removes only this app’s Gmail draft connection.</p>}
          {connection.error && <p role="alert">{connection.error}</p>}
        </>}
      </> : !error && <p role="status">Checking your Gmail connection…</p>}
    </div>
  </div>;
}
