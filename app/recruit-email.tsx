"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import SummaryChips from './summary-chips';

type Recruit = { id: string; name: string; isDemo?: boolean; email?: string | null; stage?: string | null; office?: string | null };
type Handoff = { recipient: { email: string; name: string }; contactUrl: string; templates: { id: string; name: string; url: string }[] };
// Names also support attendees outside the provider's recruit list.
const EmailContext = createContext<{ open: (id?: string, name?: string) => void; disabled: boolean }>({ open: () => {}, disabled: true });
export const useRecruitEmail = () => useContext(EmailContext);

export function RecruitEmailProvider({ recruits, disabled, children }: { recruits: Recruit[]; disabled: boolean; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState('');
  const [targetName, setTargetName] = useState('');
  const [openCount, setOpenCount] = useState(0);
  const [search, setSearch] = useState('');
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!target || disabled) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/recruit-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'prepare', recruitId: target }), cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Email is unavailable.');
        if (!controller.signal.aborted) setHandoff(data);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Email is unavailable.'); }
    })();
    return () => controller.abort();
  }, [target, disabled, openCount]);
  const open = useCallback((id = '', name = '') => {
    if (disabled || dialog.current?.open) return;
    setTarget(id); setTargetName(name); setSearch(''); setHandoff(null); setTemplateId(''); setError('');
    setOpenCount(n => n + 1);
    dialog.current?.showModal();
  }, [disabled]);
  const template = handoff?.templates.find(t => t.id === templateId);
  const choices = recruits.filter(r => !r.isDemo && (!search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase()))).slice(0, 30);
  return <EmailContext.Provider value={{ open, disabled }}>{children}
    <dialog ref={dialog} className="email-dialog" aria-labelledby="email-compose-title">
      <div className="email-compose-head"><h2 id="email-compose-title">New Email</h2><button className="btn btn-quiet" type="button" aria-label="Close email" onClick={() => dialog.current?.close()}>×</button></div>
      <p className="helper">Compose and send in HubSpot using an offer template or a new message.</p>
      {error && <p role="alert" className="connection-alert">{error}</p>}
      <fieldset className="email-fields">
        <label>Find recruit<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search recruit names" /></label>
        <label>Recruit<select value={target} onChange={e => { setTarget(e.target.value); setHandoff(null); setTemplateId(''); setError(''); }}><option value="">Choose a recruit</option>{target && !choices.some(r => r.id === target) && <option value={target}>{recruits.find(r => r.id === target)?.name || targetName || 'Selected recruit'}</option>}{choices.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        {target && !handoff && !error && <p role="status">Checking recruit details…</p>}
        {handoff && <p>To: <strong>{handoff.recipient.name} &lt;{handoff.recipient.email}&gt;</strong></p>}
        <label>Template<select value={templateId} disabled={!handoff} onChange={e => setTemplateId(e.target.value)}><option value="">Compose a new message</option>{handoff?.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        {handoff && <>
          {!handoff.templates.length && <p className="helper">An offer template requires a confirmed licensing status. You can still compose a new message.</p>}
          <p>{template ? <>In HubSpot, click <strong>Email → Templates</strong> and select <strong>{template.name}</strong>. Complete the dates and review the message before sending.</> : <>In HubSpot, click <strong>Email</strong> to compose and send your message.</>}</p>
          <p className="helper">The contact opens in a new tab. Your template selection is guidance; insert the template in HubSpot.</p>
          <div className="email-actions"><a className="btn btn-primary" href={handoff.contactUrl} target="_blank" rel="noopener noreferrer">Open in HubSpot</a>{template && <a className="btn btn-quiet" href={template.url} target="_blank" rel="noopener noreferrer">View selected template</a>}</div>
        </>}
      </fieldset>
    </dialog>
  </EmailContext.Provider>;
}

// The Email card's hover list: every loaded recruit with an email address, by name, each with its address, stage and
// office and an Email button that opens New Email for them (compose and send in HubSpot).
export function RecruitEmailSummary({ recruits }: { recruits: Recruit[] }) {
  const { open, disabled } = useRecruitEmail();
  const reachable = disabled ? [] : recruits.filter(r => !r.isDemo && r.email && /^[1-9]\d{0,29}$/.test(r.id)).sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }));
  const list = reachable.map(r => ({ id: r.id, href: `#recruit/${encodeURIComponent(r.id)}`, name: r.name, detail: r.email ?? '',
    facts: [['Email', r.email ?? ''], ['Stage', r.stage || 'Not recorded'], ...(r.office ? [['Office', r.office] as const] : [])] as const,
    actions: <button type="button" className="btn btn-quiet email-new-button" onClick={() => open(r.id, r.name)}>Email {r.name.split(' ')[0]}</button> }));
  return <SummaryChips id="email-summary" title="Email" preview previewChips={list} count={disabled ? undefined : String(reachable.length)} note="Compose and send in HubSpot" chips={[]} empty={disabled ? 'Email is unavailable for demo recruits.' : 'Choose an offer template or compose a new message.'} more={{ label: 'emails' }} lead={<button className="btn btn-quiet email-new-button" disabled={disabled} onClick={() => open()}>New Email</button>} previewActions={<div className="summary-preview-new"><button type="button" className="btn btn-quiet email-new-button" disabled={disabled} onClick={() => open()}>New Email</button></div>} />;
}
