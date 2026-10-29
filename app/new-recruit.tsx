"use client";

import { startTransition, useEffect, useRef, useState, type FormEvent } from "react";

type Draft = { firstName: string; lastName: string; phone: string; licensed: boolean };
type FieldErrors = Partial<Record<keyof Draft, string>>;
type Contact = { id?: string; hubspotUrl?: string };
type ContactResult = {
  status?: string; requestId?: string; replayed?: boolean; contact?: Contact;
  error?: { code?: string; message?: string; fields?: FieldErrors; fieldErrors?: FieldErrors; contact?: Contact };
  fieldErrors?: FieldErrors; retryAfterSeconds?: number;
};
type Attempt = { requestId: string; payload: string };
type Props = { active: boolean; canCreate: boolean; checkingAccess: boolean; onUnauthorized: () => void };

const EMPTY: Draft = { firstName: "", lastName: "", phone: "", licensed: false };
const ATTEMPT_KEY = "legacy.recruiting.contact-attempt.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTACTS_HOME = "https://app.hubspot.com/contacts/50894788";

function contactLink(contact?: Contact) {
  if (typeof contact?.id !== "string" || !/^[1-9]\d{0,29}$/.test(contact.id)) return undefined;
  const expected = `https://app.hubspot.com/contacts/50894788/record/0-1/${contact.id}`;
  if (contact.hubspotUrl === undefined) return expected;
  try { return new URL(contact.hubspotUrl).href === expected ? expected : undefined; }
  catch { return undefined; }
}

function validate(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.firstName.trim()) errors.firstName = "Enter a first name.";
  else if (/[\u0000-\u001f\u007f-\u009f]/.test(draft.firstName) || Array.from(draft.firstName.trim().normalize("NFC")).length > 100) errors.firstName = "Enter a first name of 1–100 characters.";
  if (!draft.lastName.trim()) errors.lastName = "Enter a last name.";
  else if (/[\u0000-\u001f\u007f-\u009f]/.test(draft.lastName) || Array.from(draft.lastName.trim().normalize("NFC")).length > 100) errors.lastName = "Enter a last name of 1–100 characters.";
  const phone = draft.phone.trim();
  const digits = phone.replace(/\D/g, "");
  if (!phone) errors.phone = "Enter a phone number.";
  else if (!/^\+?[0-9 ().-]+$/.test(phone) || (phone.startsWith("+")
    ? !/^[1-9]\d{6,14}$/.test(digits)
    : digits.length !== 10 && !(digits.length === 11 && digits.startsWith("1")))) {
    errors.phone = "Enter 10 US digits or a number starting with + and its country code.";
  }
  return errors;
}

function fieldsFrom(result: ContactResult): FieldErrors {
  const supplied = result.fieldErrors ?? result.error?.fields ?? result.error?.fieldErrors;
  if (!supplied || typeof supplied !== "object") return {};
  return Object.fromEntries((["firstName", "lastName", "phone", "licensed"] as const)
    .filter(key => typeof supplied[key] === "string").map(key => [key, supplied[key]]));
}

/** Only an opaque save-request ID is kept between reloads. Names and phone stay in memory. */
function rememberAttempt(requestId: string) {
  try { window.sessionStorage.setItem(ATTEMPT_KEY, requestId); return true; }
  catch { return false; }
}
function forgetAttempt() {
  try { window.sessionStorage.removeItem(ATTEMPT_KEY); return true; }
  catch { return false; }
}

export default function NewRecruit({ active, canCreate, checkingAccess, onUnauthorized }: Props) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [checkedHubSpot, setCheckedHubSpot] = useState(false);
  const [receipt, setReceipt] = useState<{ kind: "created" | "duplicate"; contact?: Contact } | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const attemptRef = useRef<Attempt | null>(null);
  const busyRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const dirty = Boolean(draft.firstName || draft.lastName || draft.phone || draft.licensed);

  useEffect(() => {
    let previous: string | null = null;
    try { previous = window.sessionStorage.getItem(ATTEMPT_KEY); }
    catch { /* A save will explain storage access if this browser blocks it. */ }
    startTransition(() => {
      setStorageReady(true);
      if (previous) {
        setUncertain(true);
        setError("A previous save in this tab could not be confirmed. Check HubSpot Contacts before starting another contact.");
        if (UUID.test(previous)) attemptRef.current = { requestId: previous, payload: "" };
      }
    });
    return () => requestRef.current?.abort();
  }, []);
  useEffect(() => {
    if ((!dirty || receipt) && !pending && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending, uncertain, receipt]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAt]);
  useEffect(() => {
    if (!active) return;
    if (receipt) resultRef.current?.focus({ preventScroll: true });
    else if (error) noticeRef.current?.focus({ preventScroll: true });
  }, [active, error, receipt]);

  function updateField<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    if (busyRef.current || uncertain || receipt) return;
    setDraft(current => ({ ...current, [key]: value }));
    setFieldErrors(current => ({ ...current, [key]: undefined }));
  }
  function blockUnconfirmed(message = "The save could not be confirmed. Check HubSpot Contacts before trying to add this person again.") {
    setUncertain(true); setCheckedHubSpot(false); setError(message);
  }
  function startAnother() {
    if (busyRef.current || (uncertain && !checkedHubSpot)) return;
    if (!forgetAttempt()) { setError("This browser could not clear the save receipt. Close this tab after checking HubSpot Contacts."); return; }
    attemptRef.current = null;
    setDraft({ ...EMPTY }); setFieldErrors({}); setError(null); setReceipt(null);
    setUncertain(false); setCheckedHubSpot(false); setNeedsSignIn(false); setRetryAt(0);
    window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>("input")?.focus());
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !storageReady || !canCreate || checkingAccess || uncertain || receipt || retryAt > 0) return;
    const values = { firstName: draft.firstName.trim().normalize("NFC"), lastName: draft.lastName.trim().normalize("NFC"), phone: draft.phone.trim(), licensed: draft.licensed };
    const issues = validate(values);
    setFieldErrors(issues);
    if (Object.keys(issues).length) {
      setError("Check the highlighted contact details.");
      const first = Object.keys(issues)[0];
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
    const payload = JSON.stringify(values);
    // A changed form is a new intent only after a definite, non-creating response.
    const attempt = attemptRef.current?.payload === payload ? attemptRef.current : { requestId: crypto.randomUUID(), payload };
    if (!rememberAttempt(attempt.requestId)) {
      setError("This browser cannot keep a save receipt. Allow session storage or use another browser before saving.");
      return;
    }
    attemptRef.current = attempt;
    busyRef.current = true; setPending(true); setError(null); setNeedsSignIn(false);
    const controller = new AbortController(); requestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 55_000);
    try {
      const response = await fetch("/api/contacts", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: attempt.requestId, ...values }),
      });
      let result: ContactResult;
      try { result = await response.json() as ContactResult; }
      catch { throw new Error("Contact save response could not be confirmed"); }
      if (!response.ok) {
        const code = result.error?.code;
        const definiteFailure = code === "CREATE_ALREADY_PROCESSED" || code === "CONTACT_CONFLICT"
          || code === "CONTACT_SEARCH_UNAVAILABLE" || code === "CREATE_UNAVAILABLE";
        if (code === "CREATE_UNCERTAIN" || (response.status >= 500 && !definiteFailure)
          || (response.status === 409 && code !== "CONTACT_EXISTS" && !definiteFailure)) {
          blockUnconfirmed(result.error?.message); return;
        }
        if (code === "CONTACT_EXISTS" && response.status === 409) {
          forgetAttempt();
          setReceipt({ kind: "duplicate", contact: result.contact ?? result.error?.contact });
          return;
        }
        forgetAttempt();
        // The next explicit Save after a definite failure is a new deliberate attempt.
        // Uncertain attempts take the blocked branch above and retain their UUID.
        attemptRef.current = null;
        setFieldErrors(fieldsFrom(result));
        setError(typeof result.error?.message === "string" ? result.error.message : "The contact was not saved. Check the details and try again.");
        if (response.status === 401) { setNeedsSignIn(true); onUnauthorized(); }
        const retry = Number(result.retryAfterSeconds ?? response.headers.get("Retry-After"));
        if (Number.isFinite(retry) && retry > 0) setRetryAt(Date.now() + Math.min(retry, 86400) * 1000);
        return;
      }
      if (result.status !== "created" || result.requestId !== attempt.requestId || !contactLink(result.contact)) {
        throw new Error("Contact creation could not be confirmed");
      }
      forgetAttempt();
      setReceipt({ kind: "created", contact: result.contact });
    } catch { blockUnconfirmed(); }
    finally {
      window.clearTimeout(timer); requestRef.current = null; busyRef.current = false; setPending(false);
    }
  }

  if (!active) return null;
  const receiptLink = contactLink(receipt?.contact);
  const unavailable = checkingAccess ? "Checking contact access…" : !canCreate ? "Saving contacts is not enabled for this account. Contact the app owner." : null;
  return <section className="new-recruit-page" aria-labelledby="page-title">
    <div className="page-head"><div><h1 id="page-title" className="page-title" tabIndex={-1}>Add recruit</h1><p className="subheading">A few details. One new HubSpot contact.</p></div></div>
    {receipt ? <div className="contact-receipt" role="status">
      <span className="contact-receipt-mark" aria-hidden="true">{receipt.kind === "created" ? "✓" : "↗"}</span>
      <h2 tabIndex={-1} ref={resultRef}>{receipt.kind === "created" ? "Saved to HubSpot Contacts" : "Contact already exists"}</h2>
      <p>{receipt.kind === "created" ? "Their contact details are ready in HubSpot. Recruiting pipeline records are managed separately." : "A contact with this phone number is already in HubSpot. Open the contact to check their details."}</p>
      <div className="contact-receipt-actions">{receiptLink && <a className="btn btn-primary" href={receiptLink} target="_blank" rel="noopener noreferrer">Open contact in HubSpot <span aria-hidden="true">↗</span></a>}<button type="button" className="btn btn-secondary" onClick={startAnother}>Add another contact</button></div>
    </div> : <div className="new-recruit-form-wrap">
      <p className="new-recruit-intro">Enter their contact details and license status. First name, last name and phone number are required.</p>
      {unavailable && <p className="contact-access-note" role="status">{unavailable}</p>}
      {error && <div className="contact-form-notice" role="alert" tabIndex={-1} ref={noticeRef}>
        <h2>{uncertain ? "Check HubSpot before continuing" : "Contact not saved"}</h2><p>{error}</p>
        {needsSignIn && <><a href="/sign-in" target="_blank" rel="noopener noreferrer" className="text-link">Sign in in another tab</a><p>After signing in, use Refresh above. Your draft stays here.</p></>}
        {retryAt > 0 && <p>Try again after {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(retryAt))}.</p>}
        {uncertain && <><a href={CONTACTS_HOME} target="_blank" rel="noopener noreferrer" className="text-link">Check HubSpot Contacts <span aria-hidden="true">↗</span></a><p>This form will not retry the unconfirmed save.</p><label className="contact-check"><input type="checkbox" checked={checkedHubSpot} onChange={event => setCheckedHubSpot(event.target.checked)} /><span>I checked HubSpot and am ready to add a different contact.</span></label><button type="button" className="btn btn-secondary" disabled={!checkedHubSpot || pending} onClick={startAnother}>Add a different contact</button></>}
      </div>}
      <form ref={formRef} className="new-recruit-form" onSubmit={event => void save(event)} autoComplete="off" aria-busy={pending}>
        <div className="contact-name-fields">
          {([ ["firstName", "First name"], ["lastName", "Last name"] ] as const).map(([key, label]) => <label className="field" key={key}><span>{label}</span><input name={key} type="text" required maxLength={200} value={draft[key]} disabled={pending || uncertain} aria-invalid={Boolean(fieldErrors[key]) || undefined} aria-describedby={fieldErrors[key] ? `contact-${key}-error` : undefined} onChange={event => updateField(key, event.target.value)} />{fieldErrors[key] && <span className="contact-field-error" id={`contact-${key}-error`}>{fieldErrors[key]}</span>}</label>)}
        </div>
        <label className="field contact-phone-field"><span>Phone number</span><input name="phone" type="tel" inputMode="tel" required maxLength={80} value={draft.phone} disabled={pending || uncertain} aria-invalid={Boolean(fieldErrors.phone) || undefined} aria-describedby={`contact-phone-help${fieldErrors.phone ? " contact-phone-error" : ""}`} onChange={event => updateField("phone", event.target.value)} /><span className="contact-field-help" id="contact-phone-help">Use 10 US digits or + followed by the country code and number.</span>{fieldErrors.phone && <span className="contact-field-error" id="contact-phone-error">{fieldErrors.phone}</span>}</label>
        <div className="contact-license-field"><label className="contact-check"><input name="licensed" type="checkbox" checked={draft.licensed} disabled={pending || uncertain} aria-invalid={Boolean(fieldErrors.licensed) || undefined} aria-describedby={`contact-license-help${fieldErrors.licensed ? " contact-license-error" : ""}`} onChange={event => updateField("licensed", event.target.checked)} /><span>Active 2-14 / 2-15 license</span></label><p className="contact-field-help" id="contact-license-help">Leave unchecked for Unlicensed.</p>{fieldErrors.licensed && <p className="contact-field-error" id="contact-license-error">{fieldErrors.licensed}</p>}</div>
        <div className="contact-form-actions"><button type="submit" className="btn btn-primary" disabled={!storageReady || !canCreate || checkingAccess || pending || uncertain || retryAt > 0}>{pending ? "Saving to HubSpot…" : "Save contact"}</button><a href="#recruits" className="text-link">Back to recruits</a></div>
        <p className="contact-form-footnote">Saved contacts are available in HubSpot Contacts. Recruiting pipeline records are managed separately.</p>
      </form>
    </div>}
  </section>;
}
