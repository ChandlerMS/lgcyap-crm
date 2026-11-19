"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { easternInput, easternLocalToIso, repeatedOccurrence, validateClass, TRAINING_ZONE } from "../lib/training-classes.mjs";
import styles from "./training-classes.module.css";

type TrainingClass = { id: string; name: string; startAt: string; endAt: string; trainer: string; location: string; meetingUrl: string; notes: string; status: "scheduled" | "canceled"; version: number };
type Props = { onUnauthorized?: () => void; onDirtyChange?: (value: boolean) => void; onBusyChange?: (value: boolean) => void };
const date = new Intl.DateTimeFormat("en-US", { timeZone: TRAINING_ZONE, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

export default function TrainingClassesPage({ onUnauthorized, onDirtyChange, onBusyChange }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [classes, setClasses] = useState<TrainingClass[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"upcoming" | "past">("upcoming");
  const [draft, setDraft] = useState<TrainingClass | "new" | null>(null);
  const [cancelTarget, setCancelTarget] = useState<TrainingClass | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<TrainingClass | null>(null);
  const createId = useRef("");
  const [uncertain, setUncertain] = useState(false);
  const unauthorized = useRef(onUnauthorized);
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const cancelHeading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => { unauthorized.current = onUnauthorized; }, [onUnauthorized]);
  useEffect(() => { onDirtyChange?.(draft !== null || cancelTarget !== null); return () => onDirtyChange?.(false); }, [draft, cancelTarget, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { if (cancelTarget) cancelHeading.current?.focus(); }, [cancelTarget]);
  useEffect(() => {
    if (!draft && !cancelTarget && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, cancelTarget, busy]);
  useEffect(() => { if (draft) formHeading.current?.focus(); }, [draft]);

  const refresh = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/training-classes", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (response.status === 401) unauthorized.current?.();
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load training classes.");
      if (!Array.isArray(data.classes)) throw new Error("Could not load training classes.");
      if (controller.signal.aborted) return;
      setClasses(data.classes); setCanManage(data.canManage === true); setLoaded(true); setUncertain(false);
      return data.classes as TrainingClass[];
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load training classes. Refresh to try again.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => { clearTimeout(timer); clearInterval(clock); abort.current?.abort(); };
  }, [refresh]);

  function dismissDraft() { setDraft(null); setSaveError(""); setConflict(false); setLatest(null); (trigger.current ?? addButton.current)?.focus(); }
  async function persist(input: Record<string, unknown>) {
    if (inFlight.current || loading || uncertain || conflict) return;
    inFlight.current = true; setBusy(true); setSaveError(""); setNotice("");
    try {
      const response = await fetch("/api/training-classes", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (response.status === 401) unauthorized.current?.();
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) { setConflict(true); setLatest(null); if (input.action === "cancel") { setCancelTarget(null); setConflict(false); } }
        if (response.status >= 500) setUncertain(true);
        throw new Error(data.error || "Could not save the class.");
      }
      if (!data.class?.id) { setUncertain(true); throw new Error("The save could not be confirmed. Refresh the schedule before trying again."); }
      const saved: TrainingClass = data.class;
      setClasses(current => [...current.filter(item => item.id !== saved.id), saved]);
      setDraft(null); setCancelTarget(null); setUncertain(false); setConflict(false); setLatest(null);
      setView(Date.parse(saved.endAt) <= Date.now() ? "past" : "upcoming");
      setNotice(saved.status === "canceled" ? "Class canceled." : "Class saved.");
      addButton.current?.focus();
    } catch (caught) {
      if (caught instanceof TypeError || caught instanceof SyntaxError) { setUncertain(true); setSaveError("The save could not be confirmed. Refresh the schedule and check the class before trying again."); }
      else setSaveError(caught instanceof Error ? caught.message : "Could not save the class. Refresh before trying again.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || busy || uncertain || conflict) return;
    const data = new window.FormData(event.currentTarget);
    try {
      const values = validateClass({ name: data.get("name"), startAt: easternLocalToIso(data.get("start"), String(data.get("startOccurrence"))), endAt: easternLocalToIso(data.get("end"), String(data.get("endOccurrence"))), trainer: data.get("trainer"), location: data.get("location"), meetingUrl: data.get("meetingUrl"), notes: data.get("notes") });
      void persist({ action: "save", ...values, ...(draft && draft !== "new" ? { id: draft.id, version: draft.version } : { createId: createId.current }) });
    } catch (caught) { setSaveError(caught instanceof Error ? caught.message : "Check the class details."); }
  }
  const current = draft && draft !== "new" ? draft : null;
  const visible = classes.filter(item => view === "past" ? Date.parse(item.endAt) <= now : Date.parse(item.endAt) > now).sort((a, b) => view === "past" ? b.startAt.localeCompare(a.startAt) : a.startAt.localeCompare(b.startAt));
  return <section className={styles.page} aria-labelledby="page-title">
    <div className="page-head"><div><h1 id="page-title" className="page-title" tabIndex={-1}>Training Classes</h1><p className="subheading">Class schedule · All times shown in Eastern Time</p></div><div className="header-actions"><button type="button" className="btn btn-secondary" disabled={loading || busy} onClick={() => void refresh()}>{loading ? "Loading…" : "Refresh schedule"}</button>{canManage && <button ref={addButton} type="button" className="btn btn-primary" disabled={uncertain || loading || busy || Boolean(draft || cancelTarget)} onClick={() => { trigger.current = addButton.current; createId.current = window.crypto.randomUUID(); setConflict(false); setLatest(null); setDraft("new"); setSaveError(""); setNotice(""); }}>Add class</button>}</div></div>
    {error && <div className="connection-alert" role="alert"><p>{error}</p>{loaded && <p>Showing the previously loaded schedule.</p>}</div>}
    {uncertain && <p className="helper" role="status">Refresh the schedule to resolve the previous save before making further changes.</p>}
    {notice && <p className="save-notice" role="status">{notice}</p>}
    {saveError && <div className="connection-alert" role="alert"><p>{saveError}</p>{uncertain && <p>Refresh the schedule and check the class before saving again.</p>}</div>}
    {conflict && draft && draft !== "new" && <section className={styles.confirm}>
      <p>Your draft is preserved. Load the latest saved class and review it before applying these edits.</p>
      <button type="button" className="btn btn-secondary" disabled={loading} onClick={async () => { const rows = await refresh(); const value = rows?.find(item => item.id === draft.id); if (value) setLatest(value); }}>Review latest class</button>
      {latest && <div aria-label="Latest saved class"><h2>{latest.name}</h2><p>{date.format(new Date(latest.startAt))} – {date.format(new Date(latest.endAt))}</p><p>Trainer: {latest.trainer || "To be announced"} · Location: {latest.location || "To be announced"}</p><p>{latest.meetingUrl}</p><p className={styles.classNotes}>{latest.notes}</p><p>{latest.status === "canceled" ? "This class was canceled. Discard the draft to return to the schedule." : "Using the latest version keeps your entered fields and allows them to replace the saved details after your review."}</p>{latest.status === "scheduled" && <button type="button" className="btn btn-secondary" onClick={() => { setDraft(previous => previous && previous !== "new" ? { ...previous, version: latest.version } : previous); setConflict(false); setLatest(null); setSaveError(""); }}>Use latest version for these edits</button>}</div>}
    </section>}
    {draft && canManage && <form className={styles.form} key={current?.id ?? "new"} onSubmit={submit}>
      <h2 ref={formHeading} tabIndex={-1}>{current ? "Edit class" : "Add training class"}</h2>
      <fieldset disabled={busy || loading}><div className={styles.fields}>
        <label>Class name<input name="name" required maxLength={160} defaultValue={current?.name ?? ""} /></label>
        <label>Trainer<input name="trainer" maxLength={160} defaultValue={current?.trainer ?? ""} /></label>
        <label>Starts (Eastern Time)<input type="datetime-local" name="start" required min="2000-01-01T00:00" max="2100-12-31T23:59" defaultValue={current ? easternInput(current.startAt) : ""} /></label>
        <label>Ends (Eastern Time)<input type="datetime-local" name="end" required min="2000-01-01T00:00" max="2100-12-31T23:59" defaultValue={current ? easternInput(current.endAt) : ""} /></label>
        <label>Location<input name="location" maxLength={240} defaultValue={current?.location ?? ""} /></label>
        <label>Meeting link<input name="meetingUrl" type="url" placeholder="https://" maxLength={2000} defaultValue={current?.meetingUrl ?? ""} /></label>
      </div><label className={styles.notes}>Notes<textarea name="notes" rows={3} maxLength={4000} defaultValue={current?.notes ?? ""} /></label>
      <details className={styles.dst}><summary>Daylight saving time settings</summary><p>When clocks move back, an hour occurs twice. Choose which occurrence applies to each time. Other dates are unaffected.</p><div className={styles.fields}><label>Repeated start hour<select name="startOccurrence" defaultValue={current ? repeatedOccurrence(current.startAt) : "earlier"}><option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select></label><label>Repeated end hour<select name="endOccurrence" defaultValue={current ? repeatedOccurrence(current.endAt) : "earlier"}><option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select></label></div></details>
      <div className={styles.actions}><button type="submit" className="btn btn-primary" disabled={uncertain || conflict || loading}>{busy ? "Saving…" : "Save class"}</button><button type="button" className="btn btn-secondary" onClick={dismissDraft}>Discard changes</button></div></fieldset>
    </form>}
    {cancelTarget && <section className={styles.confirm} role="alertdialog" aria-labelledby="cancel-class-title" aria-describedby="cancel-class-description"><h2 id="cancel-class-title" ref={cancelHeading} tabIndex={-1}>Cancel {cancelTarget.name}?</h2><p id="cancel-class-description">The class will remain on the schedule marked as canceled.</p><div className={styles.actions}><button type="button" className="btn btn-primary" disabled={busy || uncertain || loading} onClick={() => void persist({ action: "cancel", id: cancelTarget.id, version: cancelTarget.version })}>{busy ? "Canceling…" : "Confirm cancellation"}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setCancelTarget(null); setSaveError(""); trigger.current?.focus(); }}>Keep class</button></div></section>}
    <div className={styles.tabs} role="group" aria-label="Schedule period"><button className="btn btn-secondary" type="button" aria-pressed={view === "upcoming"} onClick={() => setView("upcoming")}>Upcoming</button><button className="btn btn-secondary" type="button" aria-pressed={view === "past"} onClick={() => setView("past")}>Past</button></div>
    {!loaded && loading && <p role="status">Loading training classes…</p>}
    {loaded && !canManage && <p className="helper">You can view the schedule. Class management is read-only in this environment or for this account.</p>}
    {loaded && visible.length === 0 && <div className="empty-state"><h2>No {view} classes</h2><p>{view === "upcoming" ? "Scheduled training classes will appear here." : "Completed class dates will appear here."}</p></div>}
    <div className={styles.list}>{visible.map(item => <article key={item.id} className={styles.card}>
      <div className={styles.cardHead}><h2>{item.name}</h2><span className={item.status === "canceled" ? styles.canceled : styles.scheduled}>{item.status === "canceled" ? "Canceled" : "Scheduled"}</span></div>
      <p className={styles.time}><time dateTime={item.startAt}>{date.format(new Date(item.startAt))}</time> – <time dateTime={item.endAt}>{date.format(new Date(item.endAt))}</time></p>
      <dl className={styles.metadata}><div><dt>Trainer</dt><dd>{item.trainer || "To be announced"}</dd></div><div><dt>Location</dt><dd>{item.location || "To be announced"}</dd></div></dl>
      {item.meetingUrl && <a className="text-link" href={item.meetingUrl} target="_blank" rel="noopener noreferrer">Join class ↗</a>}
      {item.notes && <p className={styles.classNotes}>{item.notes}</p>}
      {canManage && item.status === "scheduled" && <div className={styles.actions}><button type="button" className="btn btn-secondary" disabled={uncertain || loading || busy || Boolean(draft || cancelTarget)} aria-label={`Edit ${item.name}`} onClick={event => { trigger.current = event.currentTarget; setConflict(false); setLatest(null); setDraft(item); setSaveError(""); setNotice(""); }}>Edit</button><button type="button" className="btn btn-quiet" disabled={uncertain || loading || busy || Boolean(draft || cancelTarget)} aria-label={`Cancel ${item.name}`} onClick={event => { trigger.current = event.currentTarget; setCancelTarget(item); setSaveError(""); setNotice(""); }}>Cancel class</button></div>}
    </article>)}</div>
  </section>;
}
