"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Props = { onClose: () => void; onCreated: (replayed: boolean) => void; onUnauthorized: () => void; onBusyChange: (busy: boolean) => void };

export default function SupportTicketCreate({ onClose, onCreated, onUnauthorized, onBusyChange }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const busyRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dirty = Boolean(title.trim() || description.trim());
  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAt]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || blocked || retryAt) return;
    if (!title.trim()) { setError("Enter a ticket title."); titleRef.current?.focus(); return; }
    busyRef.current = true; setBusy(true); onBusyChange(true); setError(null);
    const requestId = requestIdRef.current ?? crypto.randomUUID(); requestIdRef.current = requestId;
    const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch("/api/support-tickets", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, title, description, priority }), signal: controller.signal });
      const result = await response.json();
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) {
        setError(typeof result.error?.message === "string" ? result.error.message : "The ticket could not be saved. Check HubSpot before trying again.");
        const uncertain = result.uncertain === true || response.status >= 500 || response.status === 409;
        setBlocked(uncertain);
        if (!uncertain) requestIdRef.current = null;
        const seconds = Number(result.retryAfterSeconds);
        if (Number.isFinite(seconds) && seconds > 0) setRetryAt(Date.now() + Math.min(seconds, 86400) * 1000);
        return;
      }
      if (result.status !== "created" || result.requestId !== requestId || (!result.replayed && !/^[1-9]\d{0,19}$/.test(result.ticket?.id ?? ""))) throw new Error("Unconfirmed creation");
      onCreated(result.replayed === true);
    } catch {
      setBlocked(true); setError("The ticket may have been created. Check Help Desk or HubSpot before starting another ticket.");
    } finally { window.clearTimeout(timer); busyRef.current = false; setBusy(false); onBusyChange(false); }
  }

  function close() {
    if (busyRef.current) return;
    if (!blocked && dirty && !window.confirm("Discard this support ticket draft?")) return;
    onClose();
  }

  return <section aria-labelledby="new-support-ticket-title">
    <div className="page-heading"><h1 id="new-support-ticket-title" className="page-title">New Support Ticket</h1><p className="helper">Saved to HubSpot’s Support Pipeline with a new, open status.</p></div>
    <form onSubmit={save}>
      <div className="form-grid">
        <label className="field"><span>Ticket title</span><input ref={titleRef} required maxLength={200} value={title} disabled={busy || blocked} onChange={event => setTitle(event.target.value)} /></label>
        <label className="field"><span>Priority</span><select value={priority} disabled={busy || blocked} onChange={event => setPriority(event.target.value)}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label>
        <label className="field"><span>Description</span><textarea maxLength={4000} rows={6} value={description} disabled={busy || blocked} onChange={event => setDescription(event.target.value)} /></label>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {retryAt > 0 && <p className="helper" role="status">Please wait before submitting again.</p>}
      <div className="profile-actions" style={{ marginTop: 24 }}><button className="btn btn-primary" type="submit" disabled={busy || blocked || retryAt > 0}>{busy ? "Saving to HubSpot…" : "Create Support Ticket"}</button><button className="btn btn-secondary" type="button" disabled={busy} onClick={close}>{blocked ? "Back to Help Desk" : "Cancel"}</button></div>
    </form>
  </section>;
}
