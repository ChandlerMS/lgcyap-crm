'use client';
import { useMemo, useState } from 'react';
import { attendeeEventDay, attendeeOffice, attendeeRowIssues } from '../../lib/event-attendee-input.mjs';
import { OFFICES } from '../../lib/recruiting-config.mjs';
import styles from './event-attendance.module.css';

export type AttendeeValues = { firstName: string; lastName: string; phone: string; email: string; office: string; eventDate: string };
type Link = { id: string; hubspotUrl: string };
type Status = 'ready' | 'sending' | 'added' | 'already' | 'failed';
type Row = { key: string; requestId: string; values: AttendeeValues; status: Status; message?: string; recruit?: Link; ticketCreated?: boolean };

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const DAY_LABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const OFFICE_LABELS: Record<string, string> = OFFICES;
const hubspotLink = (value: unknown): Link | undefined => {
  const link = value as Link;
  return link && /^[1-9]\d{0,19}$/.test(String(link.id)) && typeof link.hubspotUrl === 'string' && link.hubspotUrl.startsWith('https://app.hubspot.com/') ? { id: String(link.id), hubspotUrl: link.hubspotUrl } : undefined;
};

export default function AttendeeImport({ fileName, attendees, onClose, onImported }: { fileName: string; attendees: AttendeeValues[]; onClose: () => void; onImported: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => attendees.map((values, index) => ({ key: `${index}`, requestId: crypto.randomUUID(), values, status: 'ready' })));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [today] = useState(() => TODAY.format(new Date()));
  const issues = useMemo(() => attendeeRowIssues(rows.map(row => row.values), { today }) as Record<string, string>[], [rows, today]);
  const valid = (index: number) => !Object.keys(issues[index] ?? {}).length;
  const pending = rows.filter((row, index) => valid(index) && (row.status === 'ready' || row.status === 'failed'));
  const counts = {
    needFixes: rows.filter((_, index) => !valid(index)).length,
    added: rows.filter(row => row.status === 'added').length,
    already: rows.filter(row => row.status === 'already').length,
    failed: rows.filter(row => row.status === 'failed').length,
  };
  const update = (key: string, change: Partial<Row>) => setRows(current => current.map(row => row.key === key ? { ...row, ...change } : row));

  async function importRows() {
    setBusy(true); setNotice('');
    let changed = false;
    try {
      for (const row of pending) {
        update(row.key, { status: 'sending', message: undefined });
        let response: Response, result: Record<string, unknown> | null = null;
        try {
          response = await fetch('/api/event-attendance/import', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: row.requestId, ...row.values }) });
          result = await response.json().catch(() => null);
        } catch {
          update(row.key, { status: 'failed', message: 'The connection dropped. Import again: a person is never added twice for the same day.' });
          continue;
        }
        const error = result?.error as { message?: string; fieldErrors?: Record<string, string> } | undefined;
        if (response.ok && (result?.status === 'added' || result?.status === 'already_recorded')) {
          changed = true;
          update(row.key, { status: result.status === 'added' ? 'added' : 'already', recruit: hubspotLink(result.recruit), ticketCreated: result.ticketCreated === true });
          continue;
        }
        const message = error?.fieldErrors ? Object.values(error.fieldErrors).join(' ') : error?.message ?? 'This row could not be imported.';
        update(row.key, { status: 'failed', message, recruit: hubspotLink(result?.recruit) });
        if (response.status === 401) { setNotice('Your sign-in expired. Sign in again, then import the remaining rows.'); break; }
        if (response.status === 429) { setNotice('HubSpot is limiting requests. Wait a minute, then select Import again to continue.'); break; }
        if (response.status === 403) { setNotice(message); break; }
      }
    } finally {
      setBusy(false);
      if (changed) onImported();
    }
  }

  const resultText = (row: Row, index: number) => {
    if (!valid(index)) return Object.values(issues[index]).join(' ');
    if (row.status === 'sending') return 'Adding…';
    if (row.status === 'added') return row.ticketCreated ? 'Added: new contact and recruit' : 'Sign-in added to their recruit';
    if (row.status === 'already') return 'Already signed in for this day';
    if (row.status === 'failed') return row.message ?? 'Not imported';
    return 'Ready';
  };
  const eventLabel = (value: string) => { const day = attendeeEventDay(value); return day ? DAY_LABEL.format(Date.parse(`${day}T12:00:00Z`)) : value || '—'; };

  return <section className={`${styles.card} ${styles.importPanel}`} aria-labelledby="import-title" aria-busy={busy}>
    <div className={styles.sectionHeading}><h2 id="import-title">Import attendees</h2><span>{fileName}</span></div>
    <p className={styles.muted}>Each person gets a HubSpot contact and a Recruiting ticket at Hiring Event if they don’t have one, plus a sign-in for the event day. Nothing in HubSpot is overwritten. If someone is already in HubSpot under a different name, phone or email, that row is left for you to review there.</p>
    <p className={styles.importSummary} role="status">{rows.length} in file · {pending.length} to import · {counts.needFixes} need fixes{counts.added ? ` · ${counts.added} added` : ''}{counts.already ? ` · ${counts.already} already signed in` : ''}{counts.failed ? ` · ${counts.failed} not imported` : ''}</p>
    {notice && <p role="alert" className={styles.alert}>{notice}</p>}
    <div className={styles.tableWrap}>
      <table className={`${styles.table} ${styles.importTable}`}>
        <thead><tr><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col">Office</th><th scope="col">Event date</th><th scope="col">Result</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.key} className={!valid(index) || row.status === 'failed' ? styles.rowProblem : row.status === 'added' || row.status === 'already' ? styles.rowDone : undefined}>
          <th scope="row">{`${row.values.firstName} ${row.values.lastName}`.trim() || '—'}</th>
          <td>{row.values.phone || '—'}</td><td>{row.values.email || '—'}</td>
          <td>{OFFICE_LABELS[attendeeOffice(row.values.office)] ?? (row.values.office || '—')}</td>
          <td>{eventLabel(row.values.eventDate)}</td>
          <td className={styles.result}>{resultText(row, index)}{row.recruit && <> · <a href={row.recruit.hubspotUrl} target="_blank" rel="noopener noreferrer">Open in HubSpot</a></>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {counts.needFixes > 0 && <p className={styles.muted}>Rows that need fixes are not imported. Correct them in the file and import it again; people already added are not added twice.</p>}
    <div className={styles.importActions}>
      <button type="button" className={styles.primary} disabled={busy || !pending.length} onClick={() => void importRows()}>{busy ? 'Importing…' : `Add ${pending.length} ${pending.length === 1 ? 'attendee' : 'attendees'} to HubSpot`}</button>
      <button type="button" disabled={busy} onClick={onClose}>Close</button>
    </div>
  </section>;
}
