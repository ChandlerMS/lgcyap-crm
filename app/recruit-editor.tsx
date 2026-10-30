"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { EDIT_FIELDS } from "@/lib/recruit-edit-config.mjs";

type EditField = { property: string; label: string; type: "text" | "select" | "date"; options?: { value: string; label: string }[]; required?: boolean; maxLength?: number };
const fields = EDIT_FIELDS as EditField[];
export type EditableRecruit = { id: string; name: string; updatedAt: string | null; editValues?: Record<string, string> };
type Props<T extends EditableRecruit> = { recruit: T; canEdit: boolean; writeAccessPending: boolean; embedded?: boolean; onClose: () => void; onSaved: (recruit: T, replayed: boolean) => void; onReload: () => Promise<T | null>; onUnauthorized: () => void };
type SaveResult<T> = { status?: string; recruit?: T; requestId?: string; replayed?: boolean; error?: { code?: string; message?: string }; retryAfterSeconds?: number };
type Phase = "edit" | "review" | "discard" | "reload";

function valuesFor(recruit: EditableRecruit) {
  return Object.fromEntries(fields.map(field => [field.property, String(recruit.editValues?.[field.property] ?? "")]));
}
function changedValues(draft: Record<string, string>, baseline: Record<string, string>) {
  return Object.fromEntries(fields.map(field => [field.property, field.type === "text" ? draft[field.property].trim() : draft[field.property]]).filter(([property, value]) => value !== baseline[property]));
}
function displayValue(field: EditField, value: string) {
  if (!value) return "Not recorded";
  return field.options?.find(option => option.value === value)?.label ?? value;
}
function validate(changes: Record<string, string>) {
  for (const field of fields) {
    if (!Object.hasOwn(changes, field.property)) continue;
    const value = changes[field.property];
    if (field.required && !value) return `${field.label} cannot be empty.`;
    if (field.type === "text" && value.length > (field.maxLength ?? 180)) return `${field.label} is too long.`;
    if (field.type === "select" && !field.options?.some(option => option.value === value)) return `Choose a valid ${field.label.toLowerCase()}.`;
    if (field.type === "date" && value) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) return `Choose a valid ${field.label.toLowerCase()}.`;
      const [, y, m, d] = match.map(Number);
      if (y < 1000 || m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return `Choose a real ${field.label.toLowerCase()}.`;
    }
  }
  return null;
}

export default function RecruitEditor<T extends EditableRecruit>({ recruit, canEdit, writeAccessPending, embedded = false, onClose, onSaved, onReload, onUnauthorized }: Props<T>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [base, setBase] = useState(recruit);
  const [draft, setDraft] = useState(() => valuesFor(recruit));
  const [phase, setPhase] = useState<Phase>("edit");
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const busyRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const baseline = valuesFor(base);
  const changes = changedValues(draft, baseline);
  const dirty = Object.keys(changes).length > 0;
  const busy = saving || reloading;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!embedded) {
      dialog?.showModal();
      dialog?.querySelector<HTMLElement>("input,select")?.focus();
    } else sectionRef.current?.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      requestRef.current?.abort();
      if (dialog?.open) dialog.close();
      if (!embedded) {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
        else document.getElementById("page-title")?.focus({ preventScroll: true });
      }
    };
  }, [embedded]);
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAt]);
  useEffect(() => {
    const container = embedded ? sectionRef.current : dialogRef.current;
    container?.querySelector<HTMLElement>("[data-phase-heading]")?.focus({ preventScroll: true });
  }, [embedded, phase]);

  function requestClose() {
    if (busyRef.current) return;
    if (dirty) setPhase("discard");
    else onClose();
  }
  function review(event: FormEvent) {
    event.preventDefault();
    const issue = validate(changes);
    if (issue) { setError(issue); return; }
    if (!dirty || blocked) return;
    setError(null); setPhase("review");
  }
  async function reloadLatest() {
    if (busyRef.current || retryAt > 0) return;
    busyRef.current = true; setReloading(true);
    try {
      const latest = await onReload();
      if (!latest?.editValues) { setError("The latest record could not be loaded. Your draft is still here."); setPhase("edit"); return; }
      setBase(latest); setDraft(valuesFor(latest)); setBlocked(false); setError(null); requestIdRef.current = null; setPhase("edit");
    } finally { busyRef.current = false; setReloading(false); }
  }
  async function save() {
    if (busyRef.current || !canEdit || blocked || retryAt > 0 || !dirty || !base.updatedAt) return;
    const issue = validate(changes); if (issue) { setError(issue); setPhase("edit"); return; }
    busyRef.current = true; setSaving(true); setError(null);
    const requestId = requestIdRef.current ?? crypto.randomUUID(); requestIdRef.current = requestId;
    const controller = new AbortController(); requestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const expectedValues = Object.fromEntries(Object.keys(changes).map(property => [property, baseline[property]]));
      const response = await fetch(`/api/recruits/${encodeURIComponent(base.id)}`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: base.updatedAt, requestId, changes, expectedValues }), signal: controller.signal });
      let result: SaveResult<T>;
      try { result = await response.json() as SaveResult<T>; }
      catch { throw new Error("Save response could not be confirmed"); }
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) {
        const retry = Number(result.retryAfterSeconds ?? response.headers.get("Retry-After"));
        // Deadline is captured after an async Save click, never while rendering.
        // eslint-disable-next-line react-hooks/purity
        if (Number.isFinite(retry) && retry > 0) setRetryAt(Date.now() + Math.min(retry, 86400) * 1000);
        setBlocked(true);
        if (result.error?.code === "RECORD_CHANGED") setError("This recruit changed in HubSpot after you opened it. Reload the latest record before saving. Your draft has been kept.");
        else if (result.error?.code === "SAVE_UNCERTAIN" || response.status >= 500) setError("Save outcome unconfirmed. Refresh and check the record before trying again. Your draft has been kept.");
        else setError(result.error?.message ?? "The changes were not saved. Reload the latest record before trying again.");
        return;
      }
      if (result.status !== "saved" || result.requestId !== requestId || result.recruit?.id !== base.id || !result.recruit.editValues || typeof result.recruit.updatedAt !== "string") throw new Error("Save result could not be confirmed");
      onSaved(result.recruit, result.replayed === true);
    } catch {
      setBlocked(true); setError("Save outcome unconfirmed. Refresh and check the record before trying again. Your draft has been kept.");
    } finally { window.clearTimeout(timer); requestRef.current = null; busyRef.current = false; setSaving(false); }
  }

  const permissionNote = !canEdit ? writeAccessPending ? "This workspace is read-only. Saving has not been enabled." : "Editing is unavailable for this account." : null;
  const reviewedFields = fields.filter(field => Object.hasOwn(changes, field.property));
  const content = <>
    <div className="dialog-header"><div><h2 id="edit-title" tabIndex={-1}>{phase === "review" ? "Review your changes" : phase === "discard" ? "Discard this draft?" : phase === "reload" ? "Reload the latest record?" : "Edit recruit"}</h2><p className="editor-recruit-name">{base.name}</p></div><button className="btn btn-quiet" type="button" aria-label="Close editor" disabled={busy} onClick={requestClose}>×</button></div>
    <div className="dialog-body">
      <p id="edit-description" className="helper">Changes are sent to HubSpot only when you choose Save to HubSpot.</p>
      {embedded && <p className="helper">Save or cancel editing before opening another profile or stage page.</p>}
      {permissionNote && <p className="editor-permission" role="status">{permissionNote}</p>}
      {!base.updatedAt && <p className="editor-error" role="alert">The record&apos;s update time is missing. Reload it before saving.</p>}
      {error && <div className="editor-error" role="alert"><p>{error}</p>{retryAt > 0 && <p>Wait until {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(retryAt))} before trying again.</p>}{blocked && <button className="btn btn-secondary" type="button" disabled={busy || retryAt > 0} onClick={() => setPhase("reload")}>Reload latest record</button>}</div>}
      {phase === "discard" ? <section><h3 data-phase-heading tabIndex={-1} className="editor-phase-heading">Close this local draft?</h3><p className="muted">{blocked ? "If a save outcome was unconfirmed, check the record in HubSpot before trying again." : "Discarding closes this draft and leaves the HubSpot record as it is."}</p></section> : phase === "reload" ? <section><h3 data-phase-heading tabIndex={-1} className="editor-phase-heading">Replace this draft with the latest HubSpot values?</h3><p className="muted">Review the current record before starting another save.</p></section> : phase === "review" ? <section><h3 data-phase-heading tabIndex={-1} className="editor-phase-heading">{reviewedFields.length} field{reviewedFields.length === 1 ? "" : "s"} will change</h3><div className="editor-review-wrap"><table className="editor-review-table"><thead><tr><th>Field</th><th>Current value</th><th>New value</th></tr></thead><tbody>{reviewedFields.map(field => <tr key={field.property}><th scope="row">{field.label}</th><td>{displayValue(field, baseline[field.property])}</td><td>{displayValue(field, changes[field.property])}</td></tr>)}</tbody></table></div><p className="editor-workflow-note">Saving may trigger your existing HubSpot workflows. Review stage and progress changes carefully.</p></section> : <form id="recruit-edit-form" onSubmit={review} noValidate><h3 data-phase-heading tabIndex={-1} className="sr-only">Recruit fields</h3><div className="form-grid">{fields.map((field, index) => <label className={`field ${index === 7 ? "editor-progress-start" : ""}`} key={field.property}><span>{field.label}</span>{field.type === "select" ? <select value={draft[field.property]} disabled={busy} aria-required={field.required || undefined} onChange={event => setDraft(value => ({ ...value, [field.property]: event.target.value }))}>{!field.options?.some(option => option.value === draft[field.property]) && <option value={draft[field.property]}>Current value: {draft[field.property] || "Not recorded"}</option>}{field.options?.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select> : <input type={field.type === "date" ? "date" : "text"} value={draft[field.property]} maxLength={field.maxLength ?? 180} disabled={busy} aria-required={field.required || undefined} autoComplete="off" onChange={event => setDraft(value => ({ ...value, [field.property]: event.target.value }))} />}</label>)}</div><p className="helper editor-field-help">Recruit name and ticket name are separate fields. Intake status is not license verification; appointment creation is not carrier approval.</p></form>}
    </div>
    <div className="dialog-actions editor-actions">{phase === "discard" ? <><button className="btn btn-secondary" type="button" onClick={() => setPhase("edit")}>Keep editing</button><button className="btn btn-primary" type="button" onClick={onClose}>Discard changes</button></> : phase === "reload" ? <><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setPhase("edit")}>Keep draft</button><button className="btn btn-primary" type="button" disabled={busy || retryAt > 0} onClick={() => void reloadLatest()}>{reloading ? "Loading…" : "Reload latest record"}</button></> : phase === "review" ? <><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setPhase("edit")}>Back to edit</button><button className="btn btn-primary" type="button" disabled={busy || !canEdit || blocked || !base.updatedAt || retryAt > 0} onClick={() => void save()}>{saving ? "Saving to HubSpot…" : "Save to HubSpot"}</button></> : <><button className="btn btn-secondary" type="button" disabled={busy} onClick={requestClose}>Cancel</button><button className="btn btn-primary" type="submit" form="recruit-edit-form" disabled={busy || !dirty || blocked}>Review changes</button></>}</div>
  </>;
  return embedded
    ? <section ref={sectionRef} className="recruit-editor embedded-editor" aria-labelledby="edit-title" aria-describedby="edit-description">{content}</section>
    : <dialog ref={dialogRef} className="modal recruit-editor" aria-labelledby="edit-title" aria-describedby="edit-description" onCancel={event => { event.preventDefault(); requestClose(); }}>{content}</dialog>;
}

