"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizeRecruitIntakeRow } from "../lib/recruit-intake-input.mjs";
import { emptyRecruitDraft, MAX_INTAKE_ROWS, parseRecruitImport, recruitDraftIsBlank, recruitRowIssues } from "./recruit-intake-import.mjs";

type Draft = { firstName: string; lastName: string; phone: string; email: string };
type Field = keyof Draft;
type RecordLink = { id?: string; hubspotUrl?: string };
type RowStatus = "draft" | "submitting" | "created" | "already_exists" | "failed" | "partial" | "uncertain";
type Entry = { id: number; values: Draft; status: RowStatus; requestId?: string; sentValues?: Draft; locked?: boolean; message?: string; canResume?: boolean; contact?: RecordLink; recruit?: RecordLink; retryAt?: number; checkedHubSpot?: boolean };
type Result = { status?: string; requestId?: string; contact?: RecordLink; recruit?: RecordLink; replayed?: boolean; canResume?: boolean; retryAfterSeconds?: number; error?: { code?: string; message?: string; fieldErrors?: Partial<Record<Field, string>> } };
type Props = { canCreate: boolean; checkingAccess: boolean; onCreated: () => void; onUnauthorized: () => void; onBusyChange?: (busy: boolean) => void; onDraftChange?: (dirty: boolean) => void };
const PAGE_SIZE = 10;
const FIELDS: { key: Field; label: string; type: "text" | "tel" | "email"; max: number }[] = [
  { key: "firstName", label: "First Name", type: "text", max: 200 },
  { key: "lastName", label: "Last Name", type: "text", max: 200 },
  { key: "phone", label: "Phone Number", type: "tel", max: 80 },
  { key: "email", label: "Email", type: "email", max: 254 },
];
const definiteCodes = new Set(["INVALID_INTAKE", "INTAKE_DISABLED", "INTAKE_ACCESS_REQUIRED", "INTAKE_SEARCH_UNAVAILABLE", "INTAKE_UNAVAILABLE", "HUBSPOT_RATE_LIMITED", "CONTACT_IDENTITY_CONFLICT", "INTAKE_ALREADY_PROCESSED", "UNAUTHORIZED", "NOT_AUTHENTICATED"]);

function verifiedLink(record: RecordLink | undefined, objectType: "0-1" | "0-5") {
  if (typeof record?.id !== "string" || !/^[1-9]\d{0,19}$/.test(record.id)) return undefined;
  const expected = `https://app.hubspot.com/contacts/50894788/record/${objectType}/${record.id}`;
  if (record.hubspotUrl === undefined || record.hubspotUrl === expected) return expected;
  return undefined;
}
function stateLabel(row: Entry) {
  return row.status === "created" ? "Added to Recruits" : row.status === "already_exists" ? "Already in pipeline" : row.status === "submitting" ? "Submitting…" : row.status === "partial" ? "Setup incomplete" : row.status === "uncertain" ? "Check HubSpot" : row.status === "failed" ? "Not added" : "Ready to review";
}

export default function AddRecruits({ canCreate, checkingAccess, onCreated, onUnauthorized, onBusyChange, onDraftChange }: Props) {
  const [rows, setRows] = useState<Entry[]>(() => Array.from({ length: PAGE_SIZE }, (_, id) => ({ id, values: emptyRecruitDraft() as Draft, status: "draft" })));
  const [page, setPage] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const rowsRef = useRef(rows);
  const nextIdRef = useRef(PAGE_SIZE);
  const busyRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const busy = submitting || importing;
  const issues = recruitRowIssues(rows.map(row => row.values)) as Partial<Record<Field, string>>[];
  const unresolved = rows.some(row => row.status === "partial" || row.status === "uncertain");
  const dirty = unresolved || rows.some(row => !["created", "already_exists"].includes(row.status) && !recruitDraftIsBlank(row.values));
  const ready = rows.filter(row => (row.status === "draft" || row.status === "failed") && !recruitDraftIsBlank(row.values));
  const completedCount = rows.filter(row => row.status === "created" || row.status === "already_exists").length;
  const needsReviewCount = rows.filter(row => ["failed", "partial", "uncertain"].includes(row.status)).length;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const shown = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function replaceRows(next: Entry[]) { rowsRef.current = next; setRows(next); }
  function updateRow(id: number, patch: Partial<Entry>) { replaceRows(rowsRef.current.map(row => row.id === id ? { ...row, ...patch } : row)); }
  function blankEntry(): Entry { return { id: nextIdRef.current++, values: emptyRecruitDraft() as Draft, status: "draft" }; }
  function padRows(next: Entry[]) { while (next.length < PAGE_SIZE) next.push(blankEntry()); return next; }

  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { onDraftChange?.(dirty); return () => onDraftChange?.(false); }, [dirty, onDraftChange]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, dirty]);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAt]);
  useEffect(() => { if (error) noticeRef.current?.focus({ preventScroll: true }); }, [error]);

  function changeField(id: number, key: Field, value: string) {
    if (busyRef.current) return;
    const row = rowsRef.current.find(item => item.id === id);
    if (!row || row.locked) return;
    updateRow(id, { values: { ...row.values, [key]: value }, status: "draft", message: undefined, requestId: undefined, sentValues: undefined, canResume: false, retryAt: undefined });
  }
  function removeRow(id: number) {
    const row = rowsRef.current.find(item => item.id === id);
    if (busyRef.current || row?.locked && !["created", "already_exists"].includes(row.status) && !row.checkedHubSpot) return;
    replaceRows(padRows(rowsRef.current.filter(item => item.id !== id)));
  }
  function clearRows(kind: "draft" | "completed") {
    if (busyRef.current) return;
    const retained = rowsRef.current.filter(row => kind === "completed" ? !["created", "already_exists"].includes(row.status) : row.locked || ["created", "already_exists"].includes(row.status));
    replaceRows(padRows(retained)); setPage(1); setError(null); setNotice(null);
  }
  function addRows() {
    if (busyRef.current || rowsRef.current.length >= MAX_INTAKE_ROWS) return;
    const next = [...rowsRef.current];
    const count = Math.min(PAGE_SIZE, MAX_INTAKE_ROWS - next.length);
    for (let index = 0; index < count; index++) next.push(blankEntry());
    replaceRows(next); setPage(Math.ceil(next.length / PAGE_SIZE));
  }
  async function importFile(file: File | undefined) {
    if (!file || busyRef.current) return;
    busyRef.current = true; setImporting(true); onBusyChange?.(true); setError(null); setNotice(null);
    try {
      const imported = await parseRecruitImport(file) as Draft[];
      const filled = rowsRef.current.filter(row => !recruitDraftIsBlank(row.values)).length;
      if (filled + imported.length > MAX_INTAKE_ROWS) throw new Error("Keep at most 500 recruits in this form. Clear completed rows or split the import into smaller files.");
      const next = [...rowsRef.current]; let cursor = 0;
      for (let index = 0; index < next.length && cursor < imported.length; index++) {
        if (next[index].status === "draft" && recruitDraftIsBlank(next[index].values)) next[index] = { ...next[index], values: imported[cursor++] };
      }
      while (cursor < imported.length) next.push({ ...blankEntry(), values: imported[cursor++] });
      replaceRows(next); setPage(1); setShowIssues(true);
      setNotice(`Imported ${imported.length} row${imported.length === 1 ? "" : "s"} from ${file.name}. Review the entries below, then choose Submit.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The file could not be imported. Choose a CSV or plain .xlsx workbook."); }
    finally { busyRef.current = false; setImporting(false); onBusyChange?.(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function submitRows(event?: FormEvent, resumeId?: number) {
    event?.preventDefault();
    if (busyRef.current || !canCreate || checkingAccess || retryAt > 0) return;
    const snapshot = rowsRef.current;
    const queue = resumeId === undefined ? snapshot.filter(row => ["draft", "failed"].includes(row.status) && !recruitDraftIsBlank(row.values)) : snapshot.filter(row => row.id === resumeId && row.status === "partial" && row.canResume && row.requestId && row.sentValues);
    if (!queue.length) { setError("Enter at least one recruit before submitting."); return; }
    const validation = recruitRowIssues(snapshot.map(row => row.values)) as Partial<Record<Field, string>>[];
    const firstInvalid = snapshot.findIndex((row, index) => queue.some(item => item.id === row.id) && Object.keys(validation[index]).length > 0);
    setShowIssues(true);
    if (firstInvalid >= 0) { setPage(Math.floor(firstInvalid / PAGE_SIZE) + 1); setError("Check the highlighted details and duplicate rows before submitting. Nothing has been sent."); return; }
    busyRef.current = true; setSubmitting(true); onBusyChange?.(true); setError(null); setNotice(null);
    let success = false, stopped = false;
    try {
      for (const queued of queue) {
        const values = queued.sentValues && resumeId !== undefined ? queued.sentValues : normalizeRecruitIntakeRow(queued.values) as Draft;
        const requestId = queued.requestId ?? crypto.randomUUID();
        updateRow(queued.id, { status: "submitting", requestId, sentValues: values, locked: true, canResume: false, message: "Checking the Contact and linked recruiting record…" });
        const controller = new AbortController(); requestRef.current = controller;
        const timer = window.setTimeout(() => controller.abort(), 55_000);
        let stop = false;
        try {
          const response = await fetch("/api/recruit-intake", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, ...values }) });
          const result = await response.json() as Result;
          if (response.ok) {
            if (!["created", "already_exists"].includes(result.status ?? "") || result.requestId !== requestId || !verifiedLink(result.contact, "0-1") || !verifiedLink(result.recruit, "0-5")) throw new Error("Unconfirmed result");
            updateRow(queued.id, { status: result.status as "created" | "already_exists", message: result.status === "created" ? "Contact and linked Recruits record confirmed in HubSpot." : "A recruiting record already exists; its stage was kept.", contact: result.contact, recruit: result.recruit, locked: true });
            success = true;
          } else {
            const code = result.error?.code ?? "";
            const retry = Number(result.retryAfterSeconds ?? response.headers.get("Retry-After"));
            const waitUntil = Number.isFinite(retry) && retry > 0 ? Date.now() + Math.min(retry, 86400) * 1000 : 0;
            if (waitUntil) setRetryAt(waitUntil);
            const hasContact = Boolean(verifiedLink(result.contact, "0-1"));
            const hasReceipt = result.contact !== undefined || result.recruit !== undefined;
            const canResume = result.canResume === true && hasContact && result.requestId === requestId;
            const definite = !hasReceipt && (definiteCodes.has(code) || response.status === 401);
            updateRow(queued.id, { status: canResume ? "partial" : definite ? "failed" : "uncertain", message: canResume ? "Contact confirmed, recruiting setup incomplete. Use Finish setup to resume this same request." : typeof result.error?.message === "string" ? result.error.message : "The result could not be confirmed. Check HubSpot before trying this person again.", contact: result.contact, recruit: result.recruit, canResume, locked: !definite, requestId: definite ? undefined : requestId, retryAt: waitUntil || undefined });
            if (response.status === 401) { onUnauthorized(); stop = true; }
            if (response.status === 403 || response.status === 429 || response.status >= 500 || canResume || !definite) stop = true;
            if (stop) setError("Submission paused. Review the row status before continuing; rows not yet attempted are still editable.");
          }
        } catch {
          updateRow(queued.id, { status: "uncertain", locked: true, canResume: false, message: "The result could not be confirmed. Check HubSpot before submitting this person again. This request will not retry automatically." });
          setError("Submission paused after an unconfirmed result. Check HubSpot; the remaining rows have not been submitted."); stop = true;
        } finally { window.clearTimeout(timer); requestRef.current = null; }
        if (stop) { setPage(Math.floor(rowsRef.current.findIndex(row => row.id === queued.id) / PAGE_SIZE) + 1); stopped = true; break; }
      }
      if (!stopped) {
        const problemIndex = rowsRef.current.findIndex(row => ["partial", "uncertain", "failed"].includes(row.status));
        if (problemIndex >= 0) { setPage(Math.floor(problemIndex / PAGE_SIZE) + 1); setError("Some rows were not added. Review their row status below; confirmed rows will not be submitted again."); }
        else setNotice("Submission complete. Contacts and their recruiting records are confirmed in HubSpot.");
      }
    } finally {
      busyRef.current = false; setSubmitting(false); onBusyChange?.(false);
      if (success) onCreated();
    }
  }

  return <section className="add-recruits-page" aria-labelledby="page-title">
    <div className="page-head"><div><h1 className="page-title" id="page-title" tabIndex={-1}>Add Recruits</h1><p className="subheading">Add Contacts and start their recruiting pipeline in one place.</p></div><div className="header-actions"><input ref={fileRef} type="file" accept=".csv,.xlsx" className="sr-only" tabIndex={-1} aria-label="Import recruit CSV or Excel file" onChange={event => void importFile(event.target.files?.[0])} /><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>{importing ? "Importing…" : "Bulk import"}</button></div></div>
    <p className="intake-intro">First Name, Last Name and Phone Number are required. Email is optional. New entries create a Contact and a linked recruiting record in <strong>Recruits</strong>.</p>
    <p className="helper intake-import-help">Import CSV or Excel (.xlsx, first worksheet only), up to 500 recruits and 2 MB. Use First Name, Last Name, Phone Number and Email headers. Files are read in this browser; review the rows before Submit.</p>
    {(checkingAccess || !canCreate) && <p className="contact-access-note" role="status">{checkingAccess ? "Checking recruiting entry access…" : "Submitting is unavailable for this account or workspace. You can prepare entries while access is checked."}</p>}
    {(notice || error) && <div ref={noticeRef} tabIndex={-1} role={error ? "alert" : "status"} className={`intake-notice ${error ? "is-error" : ""}`}><p>{error ?? notice}</p>{retryAt > 0 && <p>Wait until {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(retryAt))} before continuing.</p>}</div>}
    <form onSubmit={event => void submitRows(event)} autoComplete="off" noValidate aria-busy={busy}>
      <div className="intake-toolbar"><p>{ready.length} ready to submit · {completedCount} confirmed{needsReviewCount > 0 ? ` · ${needsReviewCount} need review` : ""}</p><div><button type="button" className="text-link" disabled={busy} onClick={() => clearRows("draft")}>Clear unsubmitted rows</button>{completedCount > 0 && <button type="button" className="text-link" disabled={busy} onClick={() => clearRows("completed")}>Clear completed rows</button>}</div></div>
      <div className="intake-grid-wrap"><table className="intake-grid"><caption className="sr-only">Recruit details, ten rows per page</caption><thead><tr><th scope="col"><span className="sr-only">Row</span></th>{FIELDS.map(field => <th scope="col" key={field.key}>{field.label}{field.key === "email" && <span className="intake-optional"> optional</span>}</th>)}<th scope="col">Status</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead><tbody>{shown.map((row, index) => {
        const rowIndex = (currentPage - 1) * PAGE_SIZE + index;
        const rowErrors = showIssues ? issues[rowIndex] : {};
        const allowRemove = !row.locked || ["created", "already_exists"].includes(row.status) || row.checkedHubSpot;
        return <tr key={row.id} className={`intake-row intake-row-${row.status}`}><th scope="row">{rowIndex + 1}</th>{FIELDS.map(field => <td key={field.key}><input type={field.type} inputMode={field.type === "tel" ? "tel" : undefined} name={`${field.key}-${row.id}`} aria-label={`${field.label}, row ${rowIndex + 1}`} aria-invalid={Boolean(rowErrors[field.key]) || undefined} aria-describedby={rowErrors[field.key] ? `intake-${row.id}-${field.key}-error` : undefined} maxLength={field.max} value={row.values[field.key]} disabled={busy || row.locked} onChange={event => changeField(row.id, field.key, event.target.value)} />{rowErrors[field.key] && <span className="contact-field-error" id={`intake-${row.id}-${field.key}-error`}>{rowErrors[field.key]}</span>}</td>)}<td className="intake-status"><strong>{recruitDraftIsBlank(row.values) && row.status === "draft" ? "—" : stateLabel(row)}</strong>{row.message && <span>{row.message}</span>}{verifiedLink(row.recruit, "0-5") && <a className="text-link" href={verifiedLink(row.recruit, "0-5")} target="_blank" rel="noopener noreferrer">Open recruiting record</a>}{verifiedLink(row.contact, "0-1") && <a className="text-link" href={verifiedLink(row.contact, "0-1")} target="_blank" rel="noopener noreferrer">Open Contact</a>}{["partial", "uncertain"].includes(row.status) && <><a className="text-link" href="https://app.hubspot.com/contacts/50894788/objects/0-1/views/all/list" target="_blank" rel="noopener noreferrer">Check HubSpot Contacts</a><label className="intake-reconcile-check"><input type="checkbox" checked={row.checkedHubSpot === true} disabled={busy} onChange={event => updateRow(row.id, { checkedHubSpot: event.target.checked })} /><span>I checked HubSpot and understand this row will not be retried.</span></label></>}{row.status === "partial" && row.canResume && <button className="btn btn-secondary" type="button" disabled={busy || !canCreate || retryAt > 0} onClick={() => void submitRows(undefined, row.id)}>Finish setup</button>}</td><td><button className="btn btn-quiet intake-remove" type="button" aria-label={`Remove row ${rowIndex + 1}`} disabled={busy || !allowRemove} title={!allowRemove ? "Check HubSpot before clearing this row." : "Remove this row from the local form."} onClick={() => removeRow(row.id)}>×</button></td></tr>;
      })}</tbody></table></div>
      <div className="intake-pagination"><span>Rows {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, rows.length)} of {rows.length}</span><div><button className="btn btn-secondary" type="button" disabled={busy || currentPage <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="btn btn-secondary" type="button" disabled={busy || currentPage >= pageCount} onClick={() => setPage(value => value + 1)}>Next</button></div></div>
      <div className="intake-submit-bar"><button type="button" className="btn btn-secondary" disabled={busy || rows.length >= MAX_INTAKE_ROWS} onClick={addRows}>Add 10 rows</button><button className="btn btn-primary intake-submit" type="submit" disabled={busy || !canCreate || checkingAccess || !ready.length || retryAt > 0}>{submitting ? "Submitting…" : "Submit"}</button></div>
      <p className="helper intake-submit-note">Submit sends the populated rows to HubSpot one at a time. Existing records are checked before creating anything. Keep this tab open until submission finishes; unconfirmed rows are never retried automatically.</p>
    </form>
  </section>;
}
