"use client";

import { CONTRACT_AGENT_CREATE_FIELDS, validateContractAgent } from "@/lib/contract-agent-input.mjs";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { HubspotEditField } from "./hubspot-record-editor";
const fields: HubspotEditField[] = CONTRACT_AGENT_CREATE_FIELDS;

type Props = { onClose: () => void; onCreated: (replayed: boolean) => void; onUnauthorized: () => void; onBusyChange: (busy: boolean) => void };

export default function ContractAgentCreate({ onClose, onCreated, onUnauthorized, onBusyChange }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const busyRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dirty = Object.values(draft).some(value => value.trim());
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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || blocked || retryAt) return;
    if (!review) {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      try { const validated = validateContractAgent({ requestId: crypto.randomUUID(), properties: values }); setReview(validated.properties); setDraft(values as Record<string, string>); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Review the agent fields.'); }
      return;
    }
    busyRef.current = true; setBusy(true); onBusyChange(true); setError(null);
    const requestId = requestIdRef.current ?? crypto.randomUUID(); requestIdRef.current = requestId;
    const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch("/api/contract-agents", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, properties: review }), signal: controller.signal });
      const result = await response.json();
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) {
        setError(typeof result.error?.message === "string" ? result.error.message : "The agent could not be saved. Check HubSpot before trying again.");
        const uncertain = result.uncertain === true || response.status >= 500 || response.status === 409;
        setBlocked(uncertain);
        if (!uncertain) requestIdRef.current = null;
        const seconds = Number(result.retryAfterSeconds);
        if (Number.isFinite(seconds) && seconds > 0) setRetryAt(Date.now() + Math.min(seconds, 86400) * 1000);
        return;
      }
      if (result.status !== "created" || result.requestId !== requestId || (!result.replayed && !/^[1-9]\d{0,19}$/.test(result.agent?.id ?? ""))) throw new Error("Unconfirmed creation");
      onCreated(result.replayed === true);
    } catch {
      setBlocked(true); setError("The agent may have been created. Check Contract Agents or HubSpot before starting another agent.");
    } finally { window.clearTimeout(timer); busyRef.current = false; setBusy(false); onBusyChange(false); }
  }

  function close() {
    if (busyRef.current) return;
    if (!blocked && dirty && !window.confirm("Discard this contract agent draft?")) return;
    onClose();
  }

  return <section aria-labelledby="new-contract-agent-title">
    <div className="page-heading"><h1 id="new-contract-agent-title" className="page-title">New Contract Agent</h1><p className="helper">Create a Contract Agent in HubSpot. Full name is required; other fields are optional. Assign an owner after creation using Edit record.</p></div>
    <form onSubmit={save}>
      {review ? <div className="editor-review-wrap"><h2>Review new agent</h2><dl>{fields.map(field => <div key={field.property}><dt>{field.label}</dt><dd>{review[field.property] || "Not recorded"}</dd></div>)}</dl><p className="helper">Saving may trigger your existing HubSpot workflows.</p></div> : <div className="form-grid">
        {fields.map((field, index) => <label className="field" key={field.property}><span>{field.label}{field.required ? " *" : ""}</span>{field.type === "select" ? <select name={field.property} disabled={busy || blocked} value={draft[field.property] ?? ""} onChange={event => setDraft(value => ({ ...value, [field.property]: event.target.value }))}>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input ref={index === 0 ? titleRef : undefined} name={field.property} type={field.type} required={field.required} maxLength={field.maxLength} value={draft[field.property] ?? ""} disabled={busy || blocked} onChange={event => setDraft(value => ({ ...value, [field.property]: event.target.value }))} />}</label>)}
      </div>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {retryAt > 0 && <p className="helper" role="status">Please wait before submitting again.</p>}
      <div className="profile-actions" style={{ marginTop: 24 }}><button className="btn btn-primary" type="submit" disabled={busy || blocked || retryAt > 0}>{busy ? "Saving to HubSpot…" : review ? "Save to HubSpot" : "Review new agent"}</button>{review && !blocked && <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setReview(null)}>Back to edit</button>}<button className="btn btn-secondary" type="button" disabled={busy} onClick={close}>{blocked ? "Back to Contract Agents" : "Cancel"}</button></div>
    </form>
  </section>;
}
