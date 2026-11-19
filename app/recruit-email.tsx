"use client";
import DismissibleNotice from './dismissible-notice';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import SummaryChips from './summary-chips';
import RecruitCombobox from './recruit-combobox';

type Recruit = { id: string; name: string; isDemo?: boolean; email?: string | null; stage?: string | null; office?: string | null; createdAt?: string | null };
type Template = { id: string; name: string; route: string; subject: string; fields: string[] };
type Recipient = { email: string; name: string; firstName?: string; route?: string };
type Prepared = { recipient: Recipient; templates: Template[] };
type MailStatus = { sender: string; available: boolean; templates: Template[] };
type GmailStatus = { available: boolean; connected: boolean; email: string; inboxUrl: string; draftsUrl: string; error?: string };
type Preview = { recipient: Recipient; subject: string; html: string; previewToken: string };
type Receipt = { kind: 'created' | 'uncertain'; gmailUrl?: string; draftsUrl: string; notice: string };
const EmailContext = createContext<{ open: (id?: string, name?: string) => void; disabled: boolean }>({ open: () => {}, disabled: true });
export const useRecruitEmail = () => useContext(EmailContext);
const fieldLabels: Record<string, string> = { acceptBy: 'Accept by', contractingDate: 'Contracting date', contractingTime: 'Contracting time (Eastern)', trainingDate: 'Training start date' };
const gmailLink = (value: string | undefined) => {
  try { const url = new URL(value || ''); return url.protocol === 'https:' && url.hostname === 'mail.google.com' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
};
async function mailRequest(url: string, input?: object, signal?: AbortSignal) {
  const response = await fetch(url, { ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}), credentials: 'same-origin', cache: 'no-store', signal });
  const data = await response.json();
  return { response, data };
}

export function RecruitEmailProvider({ recruits, disabled, children }: { recruits: Recruit[]; disabled: boolean; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const recruitsRef = useRef(recruits);
  useEffect(() => { recruitsRef.current = recruits; }, [recruits]);
  const alive = useRef(true);
  const generation = useRef(0);
  const revision = useRef(0);
  const visibleRef = useRef(false);
  const creatingRef = useRef(false);
  const owner = useRef('');
  const [visible, setVisible] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [target, setTarget] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const invalidate = useCallback(() => { revision.current++; setPreview(null); setPreviewing(false); setError(''); }, []);
  const reset = useCallback((id = '', name = '') => {
    generation.current++; creatingRef.current = false; setCreating(false); invalidate(); setTarget(id); setQuery(id ? recruitsRef.current.find(r => r.id === id)?.name || name : '');
    setPrepared(null); setPreparing(false); setConnecting(false); setTemplateId(''); setFields({}); setSubject(''); setBody('');
  }, [invalidate]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!disabled) return;
    generation.current++; revision.current++; owner.current = ''; creatingRef.current = false; visibleRef.current = false;
    dialog.current?.close();
    void (async () => { setVisible(false); setReceipt(null); setStatus(null); setGmail(null); setPreview(null); setPrepared(null); setCreating(false); })();
  }, [disabled]);
  const open = useCallback((id = '', name = '') => {
    if (disabled || dialog.current?.open) return;
    // A closed dialog keeps its draft receipt, including ambiguous outcomes, until explicitly acknowledged.
    if (!receipt && !creatingRef.current) reset(id, name);
    setChecking(true); setStatus(null); setGmail(null);
    visibleRef.current = true; setVisible(true); setOpenCount(n => n + 1); dialog.current?.showModal();
  }, [disabled, receipt, reset]);
  useEffect(() => {
    if (!visible || disabled) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]);
    void (async () => {
      try {
        const [mail, connection] = await Promise.all([mailRequest('/api/recruit-email', { action: 'status' }, signal), mailRequest('/api/gmail', undefined, signal)]);
        if (controller.signal.aborted) return;
        if (!mail.response.ok || !connection.response.ok) {
          if (mail.response.status === 401 || connection.response.status === 401) { owner.current = ''; setReceipt(null); reset(); }
          throw new Error(mail.data.error || connection.data.error || 'Email status could not be checked.');
        }
        const email = String(mail.data.sender || '').toLowerCase();
        if (owner.current && owner.current !== email) { setReceipt(null); reset(); }
        owner.current = email;
        setStatus(mail.data); setGmail(connection.data); setError('');
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Email status could not be checked.'); }
      finally { if (!controller.signal.aborted) setChecking(false); }
    })();
    return () => controller.abort();
  }, [visible, disabled, openCount, reset]);
  useEffect(() => {
    if (!visible || disabled || !status?.available || !target || receipt || creatingRef.current) return;
    const controller = new AbortController();
    setPreparing(true);
    void (async () => {
      try {
        const { response, data } = await mailRequest('/api/recruit-email', { action: 'prepare', recruitId: target }, AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]));
        if (!response.ok) throw new Error(data.error || 'Recruit details could not be verified.');
        if (!controller.signal.aborted) setPrepared(data);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Recruit details could not be verified.'); }
      finally { if (!controller.signal.aborted) setPreparing(false); }
    })();
    return () => controller.abort();
  }, [target, disabled, visible, status?.available, openCount, receipt]);
  const template = prepared?.templates.find(item => item.id === templateId);
  const choices = recruits.filter(r => !r.isDemo);
  const input = { recruitId: target, templateId, subject, body, fields };
  const ready = Boolean(status?.available && gmail?.available && gmail.connected && status.sender.toLowerCase() === gmail.email.toLowerCase());
  const previewEmail = async () => {
    if (!ready || !prepared || creatingRef.current || previewing) return;
    const current = revision.current, life = generation.current;
    setError(''); setPreview(null); setPreviewing(true);
    try {
      const { response, data } = await mailRequest('/api/recruit-email', { action: 'preview', ...input }, AbortSignal.timeout(60000));
      if (!alive.current || current !== revision.current || life !== generation.current) return;
      if (!response.ok) throw new Error(data.error || 'Email preview could not be prepared.');
      setPreview(data);
    } catch (e) { if (alive.current && current === revision.current && life === generation.current) setError(e instanceof Error ? e.message : 'Email preview could not be prepared.'); }
    finally { if (alive.current && current === revision.current && life === generation.current) setPreviewing(false); }
  };
  const createDraft = async () => {
    if (!ready || !preview || receipt || creatingRef.current) return;
    const life = generation.current;
    const draftsUrl = gmailLink(gmail?.draftsUrl);
    creatingRef.current = true; setCreating(true); setError('');
    try {
      const { response, data } = await mailRequest('/api/recruit-email', { action: 'draft', ...input, previewToken: preview.previewToken, requestId: crypto.randomUUID() }, AbortSignal.timeout(60000));
      if (!alive.current || life !== generation.current) return;
      if (data.uncertain || data.code === 'DRAFT_UNCERTAIN') {
        setReceipt({ kind: 'uncertain', draftsUrl, notice: data.error || 'Draft creation could not be confirmed. Check Gmail Drafts before starting another email.' });
      } else if (!response.ok) { setPreview(null); setError(data.error || 'Draft could not be created. Preview the email again before trying.'); }
      else if (data.created === true && data.draftId) {
        const gmailUrl = gmailLink(data.gmailUrl);
        setReceipt({ kind: 'created', gmailUrl, draftsUrl: gmailLink(data.draftsUrl) || draftsUrl, notice: data.notice || 'Draft created. Review and send it in Gmail.' });
        if (visibleRef.current && gmailUrl) {
          try { window.open(gmailUrl, '_blank', 'noopener,noreferrer'); } catch { /* The explicit Gmail link remains available when a browser blocks popups. */ }
        }
      } else { setReceipt({ kind: 'uncertain', draftsUrl, notice: 'Draft creation could not be confirmed. Check Gmail Drafts before starting another email.' }); }
    } catch {
      if (alive.current && life === generation.current) setReceipt({ kind: 'uncertain', draftsUrl, notice: 'Draft creation could not be confirmed. Check Gmail Drafts before starting another email.' });
    } finally {
      if (alive.current && life === generation.current) { creatingRef.current = false; setCreating(false); }
    }
  };
  const connect = async () => {
    if (connecting || !gmail?.available) return;
    const life = generation.current; setConnecting(true); setError('');
    try {
      const { response, data } = await mailRequest('/api/gmail', { action: 'connect' }, AbortSignal.timeout(45000));
      if (!alive.current || life !== generation.current || !visibleRef.current) return;
      if (!response.ok) throw new Error(data.error || 'Gmail could not be connected.');
      const url = new URL(data.url);
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') throw new Error('Gmail authorization is unavailable.');
      window.location.assign(url.href);
    } catch (e) { if (alive.current && life === generation.current) setError(e instanceof Error ? e.message : 'Gmail could not be connected.'); }
    finally { if (alive.current && life === generation.current) setConnecting(false); }
  };
  const close = () => { visibleRef.current = false; setVisible(false); };
  return <EmailContext.Provider value={{ open, disabled }}>{children}
    <dialog ref={dialog} className="email-dialog gmail-compose-dialog" aria-labelledby="email-compose-title" onClose={close} onCancel={close}>
      <div className="email-compose-head"><h2 id="email-compose-title">New Email</h2><button className="btn btn-quiet" type="button" aria-label="Close email" onClick={() => { close(); dialog.current?.close(); }}>×</button></div>
      {disabled ? <p className="helper">Email is unavailable in demo mode.</p> : <>
        <p className="helper">Prepare your message here, then review and send the draft in Gmail.</p>
        {error && <DismissibleNotice role="alert" className="connection-alert">{error}</DismissibleNotice>}
        {checking && <p role="status">Checking Gmail draft access…</p>}
        {!checking && status && gmail && <>
          <div className="email-connect gmail-draft-connection"><p>Signed in as <strong>{status.sender}</strong>. {gmail.connected ? `Gmail connected: ${gmail.email}` : 'Connect your matching Google account to create drafts.'}</p><p className="helper">Google’s draft permission includes sending. This app only creates drafts; you choose Send in Gmail.</p>
            {(!status.available || !gmail.available) ? <p role="status">Gmail drafts are not enabled for this account. Ask your administrator to finish Gmail setup.</p> : !gmail.connected ? <button type="button" className="btn btn-secondary" disabled={connecting} onClick={() => void connect()}>{connecting ? 'Connecting…' : 'Connect Gmail'}</button> : !ready ? <p role="alert">Your Gmail connection must match your signed-in account. Reconnect Gmail in the Email workspace.</p> : null}
            {gmail.error && <p role="alert">{gmail.error}</p>}
          </div>
          {receipt ? <div className="gmail-draft-receipt" role={receipt.kind === 'uncertain' ? 'alert' : 'status'}>
            <h3>{receipt.kind === 'created' ? 'Draft created' : 'Check Gmail Drafts'}</h3><p>{receipt.notice}</p>
            <div className="gmail-email-actions">{receipt.gmailUrl && <a className="btn btn-primary" href={receipt.gmailUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open Gmail draft</a>}{receipt.draftsUrl && <a className="btn btn-secondary" href={receipt.draftsUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open Gmail Drafts folder</a>}</div>
            <p className="helper">If Gmail shows the conversation or draft list, select your new draft. Review the recipient and message, then send in Gmail.</p>
            <button type="button" className="btn btn-quiet" onClick={() => { setReceipt(null); reset(); }}>{receipt.kind === 'uncertain' ? 'I checked Gmail Drafts — start another email' : 'Start another email'}</button>
          </div> : status.available && gmail.available && <form onSubmit={event => { event.preventDefault(); void previewEmail(); }}>
            <fieldset className="email-fields" disabled={creating}>
              <RecruitCombobox recruits={choices} query={query} selectedId={target}
                onQuery={text => { setQuery(text); if (target) { setTarget(''); setPrepared(null); setTemplateId(''); setFields({}); } invalidate(); }}
                onSelect={recruit => { setQuery(recruit.name); if (recruit.id !== target) { setTarget(recruit.id); setPrepared(null); setTemplateId(''); setFields({}); invalidate(); } }} />
              {preparing && <p role="status">Checking recruit details…</p>}
              {prepared && <p>To: <strong>{prepared.recipient.name} &lt;{prepared.recipient.email}&gt;</strong></p>}
              <label>Template<select value={templateId} disabled={!prepared} onChange={event => { const next = event.target.value; setTemplateId(next); setFields({}); setSubject(prepared?.templates.find(item => item.id === next)?.subject || ''); setBody(''); invalidate(); }}><option value="">Compose a new message</option>{prepared?.templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              {prepared && <>
                {!prepared.templates.length && <p className="helper">No offer template is available for this recruit’s current licensing status. You can compose a custom message.</p>}
                <div className="gmail-offer-fields">{template?.fields.map(key => <label key={key}>{fieldLabels[key] || key.replace(/([A-Z])/g, ' $1')}<input type={key === 'contractingTime' ? 'time' : 'date'} required value={fields[key] || ''} onChange={event => { setFields(current => ({ ...current, [key]: event.target.value })); invalidate(); }} /></label>)}</div>
                <label>Subject<input type="text" required maxLength={200} value={subject} onChange={event => { setSubject(event.target.value); invalidate(); }} /></label>
                <label>{template ? 'Additional note (optional)' : 'Message'}<textarea required={!template} rows={6} maxLength={60000} value={body} onChange={event => { setBody(event.target.value); invalidate(); }} /></label>
                <div className="gmail-email-actions"><button type="submit" className="btn btn-secondary" disabled={!ready || previewing || creating}>{previewing ? 'Preparing preview…' : 'Preview email'}</button></div>
              </>}
            </fieldset>
            {preview && <section className="email-preview gmail-complete-preview" aria-label="Email preview"><h3>Review the complete email</h3><p>To: <strong>{preview.recipient.name} &lt;{preview.recipient.email}&gt;</strong><br />Subject: <strong>{preview.subject}</strong></p><iframe title="Complete email preview" sandbox="" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: cid:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">${preview.html}`} /><p className="helper">Creating a draft does not send it. Gmail opens for your final review.</p><button type="button" className="btn btn-primary" disabled={creating || !ready} onClick={() => void createDraft()}>{creating ? 'Creating Gmail draft…' : 'Create draft and open Gmail'}</button></section>}
            {creating && <p role="status">Creating your draft. Keep this window open for the result.</p>}
          </form>}
        </>}
      </>}
    </dialog>
  </EmailContext.Provider>;
}

// The Email card: its title and gold plus open New Email (review a draft in Gmail). The card lists the newest loaded
// recruits with an email address, and its hover list every one of them, by name, with address, stage and office; selecting
// a recruit, or their Email button, opens New Email for them.
export function RecruitEmailSummary({ recruits }: { recruits: Recruit[] }) {
  const { open, disabled } = useRecruitEmail();
  const reachable = disabled ? [] : recruits.filter(r => !r.isDemo && r.email && /^[1-9]\d{0,29}$/.test(r.id));
  const added = (r: Recruit) => { const time = Date.parse(r.createdAt ?? ''); return Number.isFinite(time) ? time : 0; };
  const chip = (r: Recruit) => ({ id: r.id, name: r.name, detail: `${r.email ?? ''}${r.stage ? `, ${r.stage}` : ''}`, badge: r.stage || undefined, onSelect: () => open(r.id, r.name),
    facts: [['Email', r.email ?? ''], ['Stage', r.stage || 'Not recorded'], ...(r.office ? [['Office', r.office] as const] : [])] as const,
    actions: <><button type="button" className="btn btn-quiet email-new-button" onClick={() => open(r.id, r.name)}>Email {r.name.split(' ')[0]}</button><a className="text-link summary-preview-recruit" href={`#recruit/${encodeURIComponent(r.id)}`}>Open recruit</a></> });
  const newest = [...reachable].sort((a, b) => added(b) - added(a) || a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' })).map(chip);
  const byName = [...reachable].sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' })).map(chip);
  const plus = <button type="button" className="summary-add" title="New Email" disabled={disabled} onClick={() => open()}><span aria-hidden="true">+</span><span className="sr-only">New Email</span></button>;
  return <SummaryChips id="email-summary" title="Email" preview href="#email" previewChips={byName} previewExtra={<a className="text-link" href="#email">Open Email workspace</a>} count={disabled ? undefined : String(reachable.length)} note="Newest recruits · draft in Gmail" chips={newest} empty={disabled ? 'Email is unavailable for demo recruits.' : 'No loaded recruit has an email address yet.'} more={{ label: 'recruits to email' }} lead={plus} previewActions={<div className="summary-preview-new"><button type="button" className="btn btn-quiet email-new-button" disabled={disabled} onClick={() => open()}>New Email</button></div>} />;
}
