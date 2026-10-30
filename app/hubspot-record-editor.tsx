"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { hubspotDateTimeInput, hubspotDateTimeToIso, hubspotEditBaseline, hubspotEditChanges, hubspotRecordSnapshotAvailable, HubspotRecordSaveError, saveHubspotRecordSnapshot, validateHubspotEditChanges } from "./hubspot-record-edit.mjs";

export type HubspotEditField = { property: string; label: string; type: "text" | "email" | "tel" | "select" | "date" | "datetime" | "textarea"; options?: { value: string; label: string }[]; required?: boolean; maxLength?: number };
export type EditableHubspotRecord = { id: string; title: string; updatedAt?: string | null; editValues?: Record<string, string> };
type Props<T extends EditableHubspotRecord> = { record: T; fields: HubspotEditField[]; endpoint: string; canEdit: boolean; onClose: () => void; onSaved: (record: T, replayed: boolean) => void; onReload: () => Promise<T | null>; onUnauthorized: () => void; onBusyChange?: (busy: boolean) => void };
type Phase = "edit" | "review" | "discard" | "reload";
function display(field: HubspotEditField, value: string) { return value ? field.options?.find(option => option.value === value)?.label ?? value : "Not recorded"; }

export default function HubSpotRecordEditor<T extends EditableHubspotRecord>({ record, fields, endpoint, canEdit, onClose, onSaved, onReload, onUnauthorized, onBusyChange }: Props<T>) {
  const [base, setBase] = useState(record);
  const [draft, setDraft] = useState<Record<string, string>>(() => hubspotEditBaseline(record, fields));
  const [dateTimeDraft, setDateTimeDraft] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [phase, setPhase] = useState<Phase>("edit");
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const busyRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const baseline = hubspotEditBaseline(base, fields);
  const changes = hubspotEditChanges(draft, baseline, fields);
  const dirty = Object.keys(changes).length > 0;
  const snapshotReady = hubspotRecordSnapshotAvailable(base, fields);

  useEffect(() => { sectionRef.current?.querySelector<HTMLElement>("[data-phase-heading]")?.focus(); }, [phase]);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
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
  function close() { if (busyRef.current) return; if (dirty) setPhase("discard"); else onClose(); }
  function review(event: FormEvent) {
    event.preventDefault();
    const issue = Object.values(fieldErrors).find(Boolean) ?? validateHubspotEditChanges(changes, fields, baseline);
    if (issue) { setError(issue); return; }
    if (!dirty || !snapshotReady || blocked || busyRef.current) return;
    setError(null); setPhase("review");
  }
  async function reload() {
    if (busyRef.current || retryAt > 0) return;
    busyRef.current = true; setBusy(true); onBusyChange?.(true);
    try {
      const latest = await onReload();
      if (!latest || !hubspotRecordSnapshotAvailable(latest, fields)) { setError("The latest record could not be loaded. Your draft is still here."); setPhase("edit"); return; }
      setBase(latest); setDraft(hubspotEditBaseline(latest, fields)); setDateTimeDraft({}); setFieldErrors({}); setBlocked(false); setError(null); requestIdRef.current = null; setPhase("edit");
    } catch { setError("The latest record could not be loaded. Your draft is still here."); setPhase("edit"); }
    finally { busyRef.current = false; setBusy(false); onBusyChange?.(false); }
  }
  async function save() {
    if (busyRef.current || !canEdit || !snapshotReady || blocked || retryAt > 0 || !dirty) return;
    const issue = validateHubspotEditChanges(changes, fields, baseline); if (issue) { setError(issue); setPhase("edit"); return; }
    busyRef.current = true; setBusy(true); onBusyChange?.(true); setError(null);
    const controller = new AbortController(); requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    const requestId = requestIdRef.current ?? crypto.randomUUID(); requestIdRef.current = requestId;
    try {
      const saved = await saveHubspotRecordSnapshot({ endpoint, record: base, fields, changes, requestId, signal: controller.signal });
      onSaved(saved.record as T, saved.replayed);
    } catch (caught) {
      if (caught instanceof HubspotRecordSaveError && caught.status === 401) { onUnauthorized(); return; }
      setBlocked(true);
      setError(caught instanceof Error ? caught.message : "The save outcome could not be confirmed. Reload and check the record before trying again.");
      if (caught instanceof HubspotRecordSaveError && caught.retryAfterSeconds) {
        // Captured after a deliberate Save event, not during render.
        // eslint-disable-next-line react-hooks/purity
        setRetryAt(Date.now() + caught.retryAfterSeconds * 1000);
      }
    } finally { window.clearTimeout(timeout); requestRef.current = null; busyRef.current = false; setBusy(false); onBusyChange?.(false); }
  }
  const reviewedFields = fields.filter(field => Object.hasOwn(changes, field.property));
  return <section ref={sectionRef} className="recruit-editor embedded-editor" aria-labelledby="hubspot-edit-title" aria-describedby="hubspot-edit-description" aria-busy={busy}>
    <div className="dialog-header"><div><h2 id="hubspot-edit-title" data-phase-heading tabIndex={-1}>{phase === "review" ? "Review your changes" : phase === "discard" ? "Discard this draft?" : phase === "reload" ? "Reload the latest record?" : "Edit record"}</h2><p className="editor-recruit-name">{base.title}</p></div><button className="btn btn-quiet" type="button" disabled={busy} onClick={close} aria-label="Close editor">×</button></div>
    <div className="dialog-body"><p id="hubspot-edit-description" className="helper">Review your changes before selecting Save to HubSpot. Save or cancel editing before leaving this record.</p>
      {!snapshotReady && <p className="editor-error" role="alert">The record&apos;s editing snapshot is missing. Reload the record before saving.</p>}
      {!canEdit && <p className="editor-permission" role="status">Editing is unavailable for this account or workspace.</p>}
      {error && <div className="editor-error" role="alert"><p>{error}</p>{retryAt > 0 && <p>Wait until {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(retryAt))} before reloading.</p>}{blocked && <button className="btn btn-secondary" type="button" disabled={busy || retryAt > 0} onClick={() => setPhase("reload")}>Reload latest record</button>}</div>}
      {phase === "discard" ? <p className="muted">{blocked ? "Check the record in HubSpot if a save outcome was unconfirmed. Discarding closes only this local draft." : "Discarding closes this local draft without saving its changes."}</p>
        : phase === "reload" ? <p className="muted">Replace this draft with the latest values from HubSpot, then review the record before another save.</p>
          : phase === "review" ? <><div className="editor-review-wrap"><table className="editor-review-table"><thead><tr><th>Field</th><th>Current value</th><th>New value</th></tr></thead><tbody>{reviewedFields.map(field => <tr key={field.property}><th scope="row">{field.label}</th><td>{display(field, baseline[field.property])}</td><td>{display(field, changes[field.property])}</td></tr>)}</tbody></table></div><p className="editor-workflow-note">Saving may trigger your existing HubSpot workflows.</p></>
            : <form id="hubspot-record-edit-form" onSubmit={review} noValidate><div className="form-grid">{fields.map(field => <label className="field" key={field.property}><span>{field.label}</span>{field.type === "select" ? <select value={draft[field.property]} disabled={busy || blocked} aria-required={field.required || undefined} onChange={event => setDraft(value => ({ ...value, [field.property]: event.target.value }))}>{!field.options?.some(option => option.value === draft[field.property]) && <option value={draft[field.property]}>Current value: {draft[field.property] || "Not recorded"}</option>}{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === "textarea" ? <textarea value={draft[field.property]} disabled={busy || blocked} maxLength={field.maxLength ?? 250} autoComplete="off" onChange={event => setDraft(value => ({ ...value, [field.property]: event.target.value }))} /> : <input type={field.type === "datetime" ? "datetime-local" : field.type} value={field.type === "datetime" ? dateTimeDraft[field.property] ?? hubspotDateTimeInput(draft[field.property]) : draft[field.property]} maxLength={field.maxLength ?? 250} disabled={busy || blocked} aria-required={field.required || undefined} autoComplete="off" aria-invalid={Boolean(fieldErrors[field.property]) || undefined} onChange={event => { if (field.type === "datetime") { const local = event.target.value; setDateTimeDraft(value => ({ ...value, [field.property]: local })); const converted = hubspotDateTimeToIso(local, baseline[field.property]); setFieldErrors(value => ({ ...value, [field.property]: converted.error })); setDraft(value => ({ ...value, [field.property]: converted.value })); } else setDraft(value => ({ ...value, [field.property]: event.target.value })); }} />}{field.type === "datetime" && <span className="helper">Eastern time</span>}{fieldErrors[field.property] && <span className="error-text" role="alert">{fieldErrors[field.property]}</span>}</label>)}</div></form>}
    </div>
    <div className="dialog-actions editor-actions">{phase === "discard" ? <><button className="btn btn-secondary" type="button" onClick={() => setPhase("edit")}>Keep editing</button><button className="btn btn-primary" type="button" onClick={onClose}>Discard changes</button></> : phase === "reload" ? <><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setPhase("edit")}>Keep draft</button><button className="btn btn-primary" type="button" disabled={busy || retryAt > 0} onClick={() => void reload()}>Reload latest record</button></> : phase === "review" ? <><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setPhase("edit")}>Back to edit</button><button className="btn btn-primary" type="button" disabled={busy || blocked || !canEdit || !snapshotReady || retryAt > 0} onClick={() => void save()}>{busy ? "Saving…" : "Save to HubSpot"}</button></> : <><button className="btn btn-secondary" type="button" disabled={busy} onClick={close}>Cancel</button><button className="btn btn-primary" type="submit" form="hubspot-record-edit-form" disabled={busy || blocked || !canEdit || !snapshotReady || !dirty}>Review changes</button></>}</div>
  </section>;
}
