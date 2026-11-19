"use client";
import DismissibleNotice from './dismissible-notice';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import SummaryChips from './summary-chips';
import RecruitCombobox from './recruit-combobox';

type Recruit = { id: string; name: string; isDemo?: boolean; email?: string | null; stage?: string | null; office?: string | null; createdAt?: string | null };
type Template = { id: string; name: string; route: string; subject: string; fields: string[] };
type Recipient = { email: string; name: string; firstName?: string; route?: string };
type Prepared = { recipient: Recipient; templates: Template[]; subject?: string };
type MailStatus = { sender: string; available: boolean; templates: Template[] };
type GmailStatus = { available: boolean; connected: boolean; canRead: boolean; email: string; unresolvedSend?: boolean; unresolvedRequestId?: string | null; acknowledgeAfter?: string | null; error?: string };
type Preview = { recipient: Recipient; subject: string; html: string; previewToken: string };
type Receipt = { kind: 'sent' | 'uncertain'; notice: string; requestId?: string };
const EmailContext = createContext<{ open: (id?: string, name?: string) => void; openReply: (messageId: string) => void; showSent: () => void; sentView: number; mailboxRefresh: number; disabled: boolean }>({ open: () => {}, openReply: () => {}, showSent: () => {}, sentView: 0, mailboxRefresh: 0, disabled: true });
export const useRecruitEmail = () => useContext(EmailContext);
const fieldLabels: Record<string, string> = { eventDate: 'Hiring event date', applicationDeadline: 'Application deadline', acceptBy: 'Accept by', contractingDate: 'Contracting date', contractingTime: 'Contracting time (Eastern)', trainingDate: 'Training start date' };
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
  const sendingRef = useRef(false);
  const acknowledgingRef = useRef(false);
  const recoveryEpoch = useRef(0);
  const owner = useRef('');
  const [visible, setVisible] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [target, setTarget] = useState('');
  const [replyMessageId, setReplyMessageId] = useState('');
  const [sentView, setSentView] = useState(0);
  const [mailboxRefresh, setMailboxRefresh] = useState(0);
  const showSent = useCallback(() => setSentView(value => value + 1), []);
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
  const [sending, setSending] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const invalidate = useCallback(() => { revision.current++; setPreview(null); setPreviewing(false); setError(''); }, []);
  const reset = useCallback((id = '', name = '', replyId = '') => {
    generation.current++; sendingRef.current = false; acknowledgingRef.current = false; setAcknowledging(false); setSending(false); invalidate(); setTarget(id); setReplyMessageId(replyId); setQuery(id ? recruitsRef.current.find(r => r.id === id)?.name || name : '');
    setPrepared(null); setPreparing(false); setConnecting(false); setTemplateId(''); setFields({}); setSubject(''); setBody('');
  }, [invalidate]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!disabled) return;
    // Demo mode hides private content without erasing a send outcome or allowing a second attempt.
    revision.current++; visibleRef.current = false;
    dialog.current?.close();
    void (async () => { setVisible(false); setStatus(null); setGmail(null); setPreview(null); setPrepared(null); })();
  }, [disabled]);
  const openComposer = useCallback((id = '', name = '', replyId = '') => {
    if (disabled || dialog.current?.open) return;
    // Keep both confirmed and uncertain send results until explicitly acknowledged.
    if (!receipt && !sendingRef.current) reset(id, name, replyId);
    setChecking(true); setStatus(null); setGmail(null);
    visibleRef.current = true; setVisible(true); setOpenCount(n => n + 1); dialog.current?.showModal();
  }, [disabled, receipt, reset]);
  const open = useCallback((id = '', name = '') => openComposer(id, name), [openComposer]);
  const openReply = useCallback((messageId: string) => openComposer('', '', messageId), [openComposer]);
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
        // A fresh status supersedes any acknowledgement still returning from an earlier dialog opening.
        recoveryEpoch.current++; acknowledgingRef.current = false; setAcknowledging(false);
        if (connection.data.unresolvedSend) {
          const requestId = typeof connection.data.unresolvedRequestId === 'string' ? connection.data.unresolvedRequestId.trim() : '';
          setReceipt(previous => {
            if (previous?.kind === 'uncertain' && (!requestId || previous.requestId === requestId)) return previous;
            return { kind: 'uncertain', requestId: requestId || undefined, notice: previous ? 'Your account has a different unresolved send. Check Sent email again before acknowledging this send or starting another email.' : 'A previous send could not be confirmed. Check Sent email before starting another email.' };
          });
        }
        setStatus(mail.data); setGmail(connection.data); setError('');
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Email status could not be checked.'); }
      finally { if (!controller.signal.aborted) setChecking(false); }
    })();
    return () => controller.abort();
  }, [visible, disabled, openCount, reset]);
  useEffect(() => {
    if (!visible || disabled || !status?.available || (!target && !replyMessageId) || receipt || sendingRef.current) return;
    const controller = new AbortController();
    setPreparing(true);
    void (async () => {
      try {
        const { response, data } = await mailRequest('/api/recruit-email', { action: 'prepare', ...(replyMessageId ? { replyMessageId } : { recruitId: target }) }, AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]));
        if (!response.ok) throw new Error(data.error || 'Recruit details could not be verified.');
        if (!controller.signal.aborted) { setPrepared(data); if (replyMessageId) setSubject(data.subject || ''); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Recruit details could not be verified.'); }
      finally { if (!controller.signal.aborted) setPreparing(false); }
    })();
    return () => controller.abort();
  }, [target, replyMessageId, disabled, visible, status?.available, openCount, receipt]);
  const template = prepared?.templates.find(item => item.id === templateId);
  const choices = recruits.filter(r => !r.isDemo);
  const input = { ...(replyMessageId ? { replyMessageId } : { recruitId: target }), templateId, subject, body, fields };
  const ready = Boolean(status?.available && gmail?.available && gmail.connected && gmail.canRead && status.sender.toLowerCase() === gmail.email.toLowerCase());
  const previewEmail = async () => {
    if (!status?.available || !prepared || sendingRef.current || previewing) return;
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
  const sendEmail = async () => {
    if (!ready || !preview || receipt || sendingRef.current) return;
    const life = generation.current;
    const requestId = crypto.randomUUID();
    sendingRef.current = true; setSending(true); setError('');
    try {
      const { response, data } = await mailRequest('/api/recruit-email', { action: 'send', ...input, previewToken: preview.previewToken, requestId }, AbortSignal.timeout(60000));
      if (!alive.current || life !== generation.current) return;
      if (data.uncertain || data.code === 'SEND_UNCERTAIN') {
        setReceipt({ kind: 'uncertain', requestId: data.unresolvedRequestId || requestId, notice: data.error || 'Sending could not be confirmed. Check Sent email before starting another email.' });
      } else if (!response.ok) { setPreview(null); setError(data.error || 'Email could not be sent. Preview the email again before trying.'); }
      else if (data.sent === true && data.messageId) {
        setReceipt({ kind: 'sent', notice: data.notice || 'Email sent.' });
        setMailboxRefresh(value => value + 1);
      } else { setReceipt({ kind: 'uncertain', requestId, notice: 'Sending could not be confirmed. Check Sent email before starting another email.' }); }
    } catch {
      if (alive.current && life === generation.current) setReceipt({ kind: 'uncertain', requestId, notice: 'Sending could not be confirmed. Check Sent email before starting another email.' });
    } finally {
      if (alive.current && life === generation.current) { sendingRef.current = false; setSending(false); }
    }
  };
  const acknowledgeSend = async () => {
    if (receipt?.kind !== 'uncertain' || acknowledgingRef.current || sendingRef.current) return;
    if (!receipt.requestId) { setError('Send recovery details could not be loaded. Close and reopen email before acknowledging.'); return; }
    const life = generation.current, recovery = recoveryEpoch.current;
    acknowledgingRef.current = true; setAcknowledging(true); setError('');
    try {
      const { response, data } = await mailRequest('/api/gmail', { action: 'acknowledge-send', requestId: receipt.requestId }, AbortSignal.timeout(45000));
      if (!alive.current || life !== generation.current || recovery !== recoveryEpoch.current) return;
      if (!response.ok || data.acknowledged !== true) { setError(data.error || 'The send could not be acknowledged. Your email remains locked; check Sent and try again.'); return; }
      setReceipt(null); reset();
    } catch {
      if (alive.current && life === generation.current && recovery === recoveryEpoch.current) setError('The send could not be acknowledged. Your email remains locked; check Sent and try again.');
    } finally {
      if (alive.current && life === generation.current && recovery === recoveryEpoch.current) { acknowledgingRef.current = false; setAcknowledging(false); }
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
  return <EmailContext.Provider value={{ open, openReply, showSent, sentView, mailboxRefresh, disabled }}>{children}
    <dialog ref={dialog} className="email-dialog gmail-compose-dialog" aria-labelledby="email-compose-title" onClose={close} onCancel={close}>
      <div className="email-compose-head"><h2 id="email-compose-title">{replyMessageId ? 'Reply' : 'New Email'}</h2><button className="btn btn-quiet" type="button" aria-label="Close email" onClick={() => { close(); dialog.current?.close(); }}>×</button></div>
      {disabled ? <p className="helper">Email is unavailable in demo mode.</p> : <>
        <p className="helper">Select a template or write a message, review the complete preview, then send here.</p>
        {error && <DismissibleNotice role="alert" className="connection-alert">{error}</DismissibleNotice>}
        {checking && <p role="status">Checking Gmail access…</p>}
        {!checking && status && gmail && <>
          <div className="email-connect gmail-compose-connection"><p>From: <strong>{status.sender}</strong>. {ready ? 'Gmail is connected.' : 'Connect Gmail to read and send email within this app.'}</p>
            <p className="helper">Gmail access lets this app read and send email for your connected Google account. Sending happens only when you choose Send email after reviewing the preview.</p>
            {(!status.available || !gmail.available) ? <p role="status">Email is not enabled for this account. Ask your administrator to finish Gmail setup.</p> : !gmail.connected || !gmail.canRead ? <><button type="button" className="btn btn-secondary" disabled={connecting} onClick={() => void connect()}>{connecting ? 'Connecting…' : gmail.connected ? 'Reconnect Gmail' : 'Connect Gmail'}</button><p className="helper">{gmail.connected ? 'Reconnect to authorize inbox access. ' : ''}You can select a recipient and preview a template before connecting.</p></> : !ready ? <p role="alert">Your Gmail connection must match your signed-in account. Reconnect Gmail in the Email workspace.</p> : null}
            {gmail.error && <p role="alert">{gmail.error}</p>}
          </div>
          {receipt ? <div className="gmail-send-receipt" role={receipt.kind === 'uncertain' ? 'alert' : 'status'}>
            <h3>{receipt.kind === 'sent' ? 'Email sent' : 'Check Sent email'}</h3><p>{receipt.notice}</p>
            <a className="btn btn-secondary" href="#email" onClick={() => { showSent(); close(); dialog.current?.close(); }}>View Sent email</a>
            {receipt.kind === 'uncertain' && <p className="helper">Sending will stay locked until you check Sent for this message. This app does not automatically retry.</p>}
            <button type="button" className="btn btn-quiet" disabled={acknowledging || sending} onClick={() => { if (receipt.kind === 'uncertain') void acknowledgeSend(); else { setReceipt(null); reset(); } }}>{acknowledging ? 'Acknowledging…' : receipt.kind === 'uncertain' ? 'I checked Sent — start another email' : 'Start another email'}</button>
          </div> : status.available && <form onSubmit={event => { event.preventDefault(); void previewEmail(); }}>
            <fieldset className="email-fields" disabled={sending}>
              {!replyMessageId && <RecruitCombobox recruits={choices} query={query} selectedId={target}
                onQuery={text => { setQuery(text); if (target) { setTarget(''); setPrepared(null); setTemplateId(''); setFields({}); } invalidate(); }}
                onSelect={recruit => { setQuery(recruit.name); if (recruit.id !== target) { setTarget(recruit.id); setPrepared(null); setTemplateId(''); setFields({}); invalidate(); } }} />}
              {preparing && <p role="status">{replyMessageId ? 'Checking reply details…' : 'Checking recruit details…'}</p>}
              {prepared && <p>To: <strong>{prepared.recipient.name} &lt;{prepared.recipient.email}&gt;</strong></p>}
              <label>Template<select value={templateId} disabled={!prepared} onChange={event => { const next = event.target.value; setTemplateId(next); setFields({}); if (!replyMessageId) setSubject(prepared?.templates.find(item => item.id === next)?.subject || ''); setBody(''); invalidate(); }}><option value="">Compose a new message</option>{prepared?.templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              {prepared && <>
                {!replyMessageId && !prepared.templates.length && <p className="helper">No offer template is available for this recruit’s current licensing status. You can compose a custom message.</p>}
                <div className="gmail-offer-fields">{template?.fields.map(key => <label key={key}>{fieldLabels[key] || key.replace(/([A-Z])/g, ' $1')}<input type={key === 'contractingTime' ? 'time' : 'date'} required value={fields[key] || ''} onChange={event => { setFields(current => ({ ...current, [key]: event.target.value })); invalidate(); }} /></label>)}</div>
                <label>Subject<input type="text" required readOnly={Boolean(replyMessageId)} maxLength={replyMessageId ? 1000 : 200} value={subject} onChange={event => { setSubject(event.target.value); invalidate(); }} /></label>
                {replyMessageId && <p className="helper">The reply subject stays with the original conversation.</p>}
                <label>{template ? 'Additional note (optional)' : 'Message'}<textarea required={!template} rows={6} maxLength={60000} value={body} onChange={event => { setBody(event.target.value); invalidate(); }} /></label>
                <div className="gmail-email-actions"><button type="submit" className="btn btn-secondary" disabled={previewing || sending}>{previewing ? 'Preparing preview…' : 'Preview email'}</button></div>
              </>}
            </fieldset>
            {preview && <section className="email-preview gmail-complete-preview" aria-label="Email preview"><h3>Review the complete email</h3><p>To: <strong>{preview.recipient.name} &lt;{preview.recipient.email}&gt;</strong><br />Subject: <strong>{preview.subject}</strong></p><iframe title="Complete email preview" sandbox="" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">${preview.html}`} /><p className="helper">{ready ? 'Send email delivers this reviewed message from your connected Gmail account.' : 'Connect Gmail with inbox access before sending. Your preview is ready to review.'}</p><button type="button" className="btn btn-primary" disabled={sending || !ready} onClick={() => void sendEmail()}>{sending ? 'Sending email…' : 'Send email'}</button></section>}
            {sending && <p role="status">Sending your reviewed email. Keep this window open for the result.</p>}
          </form>}
        </>}
      </>}
    </dialog>
  </EmailContext.Provider>;
}

// The Email card: its title and gold plus open New Email (compose an email in the app). The card lists the newest loaded
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
  return <SummaryChips id="email-summary" title="Email" preview href="#email" previewChips={byName} previewExtra={<a className="text-link" href="#email">Open Email workspace</a>} count={disabled ? undefined : String(reachable.length)} note="Newest recruits · email in app" chips={newest} empty={disabled ? 'Email is unavailable for demo recruits.' : 'No loaded recruit has an email address yet.'} more={{ label: 'recruits to email' }} lead={plus} previewActions={<div className="summary-preview-new"><button type="button" className="btn btn-quiet email-new-button" disabled={disabled} onClick={() => open()}>New Email</button></div>} />;
}
