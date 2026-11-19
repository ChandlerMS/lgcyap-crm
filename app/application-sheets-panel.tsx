"use client";
import { useEffect, useState } from "react";
import styles from "./applications-page.module.css";

type Connection = { owner: string; canConnect: boolean; connected: boolean; available: boolean; lastSuccessAt: string | null; error: string | null; current: { title: string; url: string; syncedAt: string | null } | null };
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
export default function ApplicationSheetsPanel() {
  const [hidden, setHidden] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let pending = false;
    const url = new URL(window.location.href);
    const result = url.searchParams.get("application_sheets");
    let callbackHandled = false;
    if (result) {
      url.searchParams.delete("application_sheets");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/applications/sheets", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Google Sheets status is unavailable.");
        if (active) {
          if (data.visible === false) { setHidden(true); return; }
          setConnection(data); setLoadError("");
          if (result && !callbackHandled) {
            callbackHandled = true;
            if (result === "connected") setNotice("Google Sheets connected. The first monthly sync is starting.");
            else setError("Google Sheets authorization was not completed. Connect again and choose chandler@lgcyap.com, allowing file access.");
          }
        }
      } catch { if (active) setLoadError("Google Sheets status is unavailable. Reload the page to try again."); }
      finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, []);
  const act = async (action: "connect" | "sync") => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/applications/sheets", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Google Sheets is unavailable.");
      if (action === "connect") { window.location.assign(result.url); return; }
      setConnection(previous => ({ ...result, available: previous?.available ?? true }));
      setNotice(result.result.status === "busy" ? "A sync is already running. This page will update when it finishes." : result.result.status === "synced" ? "Monthly application Sheets are up to date." : "Connect Google Sheets in the production CRM to enable syncing.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Google Sheets is unavailable."); }
    finally { setBusy(false); }
  };
  if (hidden) return null;
  return <aside className={styles.sheetsPanel} aria-label="Monthly application Google Sheets">
    <div>
      <h2>Monthly application Sheets</h2>
      <p>One Sheet each month, with Monday–Sunday weekly tabs. New submissions are checked every minute after they appear in HubSpot. A full refresh runs daily at 9 am Eastern.</p>
      {connection && <p>{connection.connected ? `Connected to ${connection.owner}.` : `Connect ${connection.owner} to enable automatic updates.`}{connection.lastSuccessAt && ` Last checked ${WHEN.format(new Date(connection.lastSuccessAt))}.`}</p>}
      {connection?.current && <a className="text-link" href={connection.current.url} target="_blank" rel="noopener noreferrer">Open {connection.current.title} ↗</a>}
      {connection?.error && <p role="alert">The last sync failed. Automatic retries continue; reconnect Google Sheets if access was revoked.</p>}
      {connection && !connection.available && <p>Automatic Sheets are available in the production CRM.</p>}
      {!connection && !error && !loadError && <p role="status">Checking Google Sheets connection…</p>}
      {notice && <p role="status">{notice}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    {connection?.canConnect && connection.available && <div className={styles.sheetsActions}>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void act("connect")}>{connection.connected ? "Reconnect Google Sheets" : "Connect Google Sheets"}</button>
      {connection.connected && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void act("sync")}>{busy ? "Working…" : "Sync now"}</button>}
    </div>}
  </aside>;
}
