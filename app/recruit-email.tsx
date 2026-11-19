"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { authClient } from '@/lib/auth-client';
import SummaryChips from './summary-chips';

type Recruit = { id: string; name: string; isDemo?: boolean };
type Recipient = { email: string; name: string; route: string; firstName: string };
type Template = { id: string; name: string; route: string; subject: string; fields: string[] };
type Status = { sender: string; connected: boolean; templates: Template[]; recent: { recruitId: string; status: string; at: number }[] };
type Preview = { recipient: Recipient; subject: string; html: string; previewHash: string };
// open(id, name): name labels a recruit the provider was not given, such as an Event Attendance sign-in.
const EmailContext = createContext<{ open: (id?: string, name?: string) => void; disabled: boolean; status: Status | null; error: string }>({ open: () => {}, disabled: true, status: null, error: '' });
export const useRecruitEmail = () => useContext(EmailContext);
async function mailApi(input: object) {
  const response = await fetch('/api/recruit-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), cache: 'no-store', signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Email is unavailable.');
  return data;
}
const labels: Record<string, string> = { contractingDate: 'Contracting date', contractingTime: 'Contracting time', trainingDate: 'Training start date', acceptBy: 'Offer acceptance deadline', licenseDeadline: 'Licensing deadline' };

export function RecruitEmailProvider({ recruits, disabled, children }: { recruits: Recruit[]; disabled: boolean; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState('');
  const [target, setTarget] = useState('');
  const [targetName, setTargetName] = useState('');
  const [openCount, setOpenCount] = useState(0);
  const [search, setSearch] = useState('');
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const requestId = useRef('');
  const loadStatus = useCallback(async () => {
    if (disabled) return;
    try { setStatus(await mailApi({ action: 'status' })); setStatusError(''); }
    catch (e) { setStatusError(e instanceof Error ? e.message : 'Email is unavailable.'); }
  }, [disabled]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadStatus(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);
  useEffect(() => {
    if (!target || disabled) return;
    let active = true;
    void mailApi({ action: 'prepare', recruitId: target }).then(data => { if (active) setRecipient(data.recipient); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [target, disabled, openCount]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dialog.current?.open && (subject || body || busy)) event.preventDefault(); };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [subject, body, busy]);
  const open = useCallback((id = '', name = '') => {
    if (disabled || dialog.current?.open) return;
    setTarget(id); setTargetName(name); setSearch(''); setRecipient(null); setTemplateId(''); setSubject(''); setBody(''); setFields({}); setPreview(null); setError(''); setNotice(''); setAttempted(false); requestId.current = crypto.randomUUID();
    setOpenCount(n => n + 1);
    dialog.current?.showModal(); void loadStatus();
  }, [disabled, loadStatus]);
  const change = () => { setPreview(null); setError(''); };
  const template = status?.templates.find(t => t.id === templateId);
  const close = () => { if (!busy && (!subject && !body || notice || window.confirm('Discard this email draft?'))) dialog.current?.close(); };
  const connect = async () => {
    // Google's sign-in page won't open inside the workspace's Event Attendance frame.
    if (window.self !== window.top) { setError('Connect Google email from New Email on the dashboard, then come back here to send.'); return; }
    setBusy(true); setError('');
    try {
      const result = await authClient.signIn.social({ provider: 'google', scopes: ['https://www.googleapis.com/auth/gmail.send'], loginHint: status?.sender, callbackURL: window.location.href, additionalParams: { access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true' } });
      if (result.error) throw new Error(result.error.message || 'Could not connect Google email.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect Google email.'); setBusy(false); }
  };
  const prepare = async () => {
    setBusy(true); setError('');
    try { setPreview(await mailApi({ action: 'preview', recruitId: target, templateId, subject, body, fields })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not preview email.'); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!preview || attempted) return;
    setBusy(true); setAttempted(true); setError('');
    try {
      const result = await mailApi({ action: 'send', recruitId: target, templateId, subject, body, fields, previewHash: preview.previewHash, requestId: requestId.current });
      setNotice(result.notice); setPreview(null); void loadStatus();
    } catch (e) { setError(`${e instanceof Error ? e.message : 'Delivery could not be confirmed.'} Check Gmail Sent before starting a new email. This draft will not be sent again.`); }
    finally { setBusy(false); }
  };
  const choices = recruits.filter(r => !r.isDemo && (!search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase()))).slice(0, 30);
  return <EmailContext.Provider value={{ open, disabled, status, error: statusError }}>{children}
    <dialog ref={dialog} className="email-dialog" aria-labelledby="email-compose-title" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="email-compose-head"><h2 id="email-compose-title">New Email</h2><button className="btn btn-quiet" type="button" aria-label="Close email" disabled={busy} onClick={close}>×</button></div>
      <p className="helper">Send directly from the CRM using your connected Google email.</p>
      {status && <p className="helper">From: <strong>{status.sender}</strong> · {status.connected ? 'Google email connected' : 'Google email not connected'}</p>}
      {!status?.connected && !notice && <div className="email-connect"><p>Connect your Google account to send email. This requests permission to send email, without access to read your inbox. Connecting reloads the page.</p><button className="btn btn-primary" disabled={busy} onClick={() => void connect()}>Connect Google email</button></div>}
      {(error || statusError) && <p role="alert" className="connection-alert">{error || statusError}</p>}
      {notice ? <><p role="status" className="save-notice">{notice}</p><button className="btn btn-primary" onClick={() => dialog.current?.close()}>Done</button></> : <fieldset disabled={busy || attempted} className="email-fields">
        <label>Find recruit<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search recruit names" /></label>
        <label>Recruit<select value={target} onChange={e => { setTarget(e.target.value); setRecipient(null); setTemplateId(''); setSubject(''); setBody(''); setFields({}); change(); }}><option value="">Choose a recruit</option>{target && !choices.some(r => r.id === target) && <option value={target}>{recruits.find(r => r.id === target)?.name || targetName || 'Selected recruit'}</option>}{choices.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        {recipient && <p>To: <strong>{recipient.name} &lt;{recipient.email}&gt;</strong></p>}
        <label>Template<select value={templateId} disabled={!recipient} onChange={e => { setTemplateId(e.target.value); const selected = status?.templates.find(t => t.id === e.target.value); setSubject(selected?.subject || ''); setFields({}); change(); }}><option value="">Compose a new message</option>{status?.templates.map(t => <option key={t.id} value={t.id} disabled={t.route !== recipient?.route}>{t.name}{t.route !== recipient?.route ? ' — licensing status does not match' : ''}</option>)}</select></label>
        {status && status.templates.length !== 2 && <p className="helper">Offer templates are unavailable. You can still compose a new message.</p>}
        <label>Subject<input value={subject} maxLength={200} onChange={e => { setSubject(e.target.value); change(); }} /></label>
        {template?.fields.map(field => <label key={field}>{labels[field] || field}<input type={field === 'contractingTime' ? 'time' : 'date'} value={fields[field] || ''} onChange={e => { setFields({ ...fields, [field]: e.target.value }); change(); }} required /></label>)}
        <label>{template ? 'Additional message (optional)' : 'Message'}<textarea rows={template ? 3 : 9} maxLength={60000} value={body} onChange={e => { setBody(e.target.value); change(); }} /></label>
        {template && <p className="helper">The original offer and logo are included. Preview the complete email before sending.</p>}
        <button className="btn btn-secondary" type="button" disabled={!recipient || !subject.trim()} onClick={() => void prepare()}>{busy ? 'Preparing…' : 'Preview email'}</button>
      </fieldset>}
      {preview && !notice && <section className="email-preview" aria-label="Email preview"><p><strong>{preview.subject}</strong><br />To: {preview.recipient.email}</p><iframe title="Complete email preview" sandbox="" srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${preview.html}</body></html>`} /><button className="btn btn-primary" type="button" disabled={busy || attempted || !status?.connected} onClick={() => void send()}>{busy ? 'Sending…' : 'Send email'}</button></section>}
    </dialog>
  </EmailContext.Provider>;
}

export function RecruitEmailSummary({ recruits }: { recruits: Recruit[] }) {
  const { open, disabled, status, error } = useRecruitEmail();
  const chips = (status?.recent || []).map((row, index) => ({ id: `${row.recruitId}-${index}`, name: recruits.find(r => r.id === row.recruitId)?.name || 'Recruit email', detail: new Date(row.at).toLocaleString(), badge: row.status === 'saved' ? 'Sent' : row.status === 'pending' ? 'Sending' : 'Check Sent' }));
  return <SummaryChips id="email-summary" title="Email" count={status ? String(chips.length) : undefined} note="Your recent CRM emails" chips={disabled ? [] : chips} empty={disabled ? 'Email is unavailable for demo recruits.' : error || 'Choose an offer template or compose a new message.'} more={{ label: 'emails' }} lead={<button className="btn btn-quiet email-new-button" disabled={disabled} onClick={() => open()}>New Email</button>} />;
}
