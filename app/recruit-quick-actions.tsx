"use client";
import { useRef, useState, type FormEvent } from "react";

type Kind = "note" | "task" | "follow-up";
type Done = { message: string; url?: string };
// Tasks and Follow up listen for this to reload after a task or follow-up is added.
export const TASKS_CHANGED_EVENT = "crm:tasks-changed";
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const LONG = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const addDays = (day: string, days: number) => { const time = Date.parse(`${day}T12:00:00Z`); return Number.isFinite(time) ? new Date(time + days * 86_400_000).toISOString().slice(0, 10) : ""; };
const dayLabel = (day: string) => { const time = Date.parse(`${day}T12:00:00Z`); return Number.isFinite(time) ? LONG.format(time) : ""; };
const PRESETS = [{ id: "1", label: "Tomorrow", days: 1 }, { id: "3", label: "In 3 days", days: 3 }, { id: "7", label: "Next week", days: 7 }, { id: "date", label: "Pick a date", days: 0 }] as const;
const TITLES: Record<Kind, string> = { note: "Quick note", task: "Add task", "follow-up": "Follow up" };
const newId = () => crypto.randomUUID();

function Glyph({ kind }: { kind: Kind }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "note"
    ? <><path d="M4 4h12l4 4v12H4z" /><path d="M8 10h8M8 14h8M8 18h5" /></>
    : kind === "task" ? <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="m8 12 3 3 5-6" /></>
    : <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></>}</svg>;
}

// Note, Task and Follow up for one recruit. Each saves a HubSpot note or a task assigned to you.
export default function RecruitQuickActions({ recruitId, recruitName }: { recruitId: string; recruitName: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [requestId, setRequestId] = useState("");
  const [today, setToday] = useState("");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [preset, setPreset] = useState<string>("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);

  const open = (next: Kind) => {
    const day = TODAY.format(new Date());
    setKind(next); setRequestId(newId()); setToday(day); setBody(""); setSubject(""); setDueDate(addDays(day, 1)); setPreset("1"); setError(""); setDone(null);
    dialogRef.current?.showModal();
  };
  const close = () => { if (busy) return; dialogRef.current?.close(); setKind(null); };
  // Only meaningful once a dialog is open and has set today.
  const followUpDate = !today ? "" : preset === "date" ? dueDate : addDays(today, PRESETS.find(item => item.id === preset)?.days ?? 1);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!kind || busy) return;
    setBusy(true); setError("");
    const payload = { requestId, kind, ...(body.trim() ? { body } : {}), ...(kind === "task" ? { subject, dueDate } : kind === "follow-up" ? { dueDate: followUpDate } : {}) };
    try {
      const response = await fetch(`/api/recruits/${encodeURIComponent(recruitId)}/actions`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.status === "saved") {
        if (kind !== "note") window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
        setDone({ message: kind === "note" ? "Note saved to HubSpot." : kind === "task" ? `Task saved, due ${dayLabel(dueDate)}, assigned to you.` : `Follow-up set for ${dayLabel(followUpDate)}, assigned to you.`, url: result.hubspotUrl });
        return;
      }
      setError(result?.error?.message ?? "This could not be saved. Try again.");
      // A definite rejection gets a fresh request; an unconfirmed outcome keeps it, so trying again cannot save twice.
      if (response.status >= 400 && response.status < 500 && response.status !== 409) setRequestId(newId());
    } catch {
      setError("The connection dropped. Try again: it will not be saved twice.");
    } finally { setBusy(false); }
  }

  return <>
    <div className="recruit-quick-actions" role="group" aria-label={`Notes and tasks for ${recruitName}`}>
      {(["note", "task", "follow-up"] as const).map(item => <button key={item} type="button" className="quick-action-button" onClick={() => open(item)} title={`${TITLES[item]} for ${recruitName}`}>
        <Glyph kind={item} /><span>{item === "note" ? "Note" : item === "task" ? "Task" : "Follow up"}</span><span className="sr-only"> for {recruitName}</span>
      </button>)}
    </div>
    <dialog ref={dialogRef} className="modal quick-action-dialog" aria-labelledby={`quick-${recruitId}-title`} onCancel={event => { event.preventDefault(); close(); }}>
      {kind && <form onSubmit={event => void submit(event)} noValidate={false}>
        <div className="dialog-header"><h2 id={`quick-${recruitId}-title`}>{TITLES[kind]} <span className="muted">· {recruitName}</span></h2><button type="button" className="btn btn-quiet" aria-label="Close" disabled={busy} onClick={close}>×</button></div>
        <div className="dialog-body form-grid">
          {done ? <p className="quick-action-done" role="status">{done.message}{done.url && <> <a className="text-link" href={done.url} target="_blank" rel="noopener noreferrer">Open the recruit in HubSpot<span className="sr-only"> (opens in a new tab)</span></a></>}</p> : <>
            {kind === "task" && <>
              <label className="field"><span>Task title *</span><input required maxLength={200} autoFocus value={subject} disabled={busy} onChange={event => setSubject(event.target.value)} placeholder={`Call ${recruitName.split(" ")[0]}`} /></label>
              <label className="field"><span>Due date *</span><input type="date" required min={today} value={dueDate} disabled={busy} onChange={event => setDueDate(event.target.value)} /></label>
            </>}
            {kind === "follow-up" && <fieldset className="field quick-action-when" disabled={busy}><legend>When *</legend>
              <div className="quick-action-presets">{PRESETS.map(item => <label key={item.id}><input type="radio" name={`when-${recruitId}`} value={item.id} checked={preset === item.id} onChange={() => setPreset(item.id)} />{item.label}{item.days ? <span className="muted"> · {dayLabel(addDays(today, item.days))}</span> : null}</label>)}</div>
              {preset === "date" && <input type="date" required min={today} value={dueDate} aria-label="Follow-up date" onChange={event => setDueDate(event.target.value)} />}
              <p className="helper">Creates the task “Follow up with {recruitName}”, assigned to you.</p>
            </fieldset>}
            <label className="field"><span>{kind === "note" ? "Note *" : "Notes (optional)"}</span><textarea required={kind === "note"} maxLength={5000} rows={kind === "note" ? 6 : 3} autoFocus={kind === "note"} value={body} disabled={busy} onChange={event => setBody(event.target.value)} /></label>
          </>}
          {error && <p className="quick-action-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">{done ? <button type="button" className="btn btn-primary" onClick={close}>Done</button> : <>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : kind === "note" ? "Save note" : kind === "task" ? "Save task" : "Set follow-up"}</button>
        </>}</div>
      </form>}
    </dialog>
  </>;
}
