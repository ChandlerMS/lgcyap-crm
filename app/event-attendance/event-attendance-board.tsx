'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import styles from './event-attendance.module.css';

type Office = { key: string; label: string };
type Day = { day: string; offices: Record<string, number>; signIns: number; applications: number };
type Stage = { stageId: string; label: string; count: number };
type Report = {
  fetchedAt: string; since: string; partial: boolean;
  people: { signedIn: number; applied: number; hired: number };
  signIns: number;
  applications: { total: number; fromAttendees: number; otherTickets: number; noTicket: number };
  stages: Stage[]; offices: Office[]; days: Day[];
};

const ZONE = 'America/New_York';
const NUMBER = new Intl.NumberFormat('en-US');
const DAY_LABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const SINCE_LABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const UPDATED = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const REFRESH_MS = 60000;

const count = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? NUMBER.format(value) : '—';
const share = (part: number | undefined, whole: number | undefined) => typeof part === 'number' && typeof whole === 'number' && whole > 0 ? `${Math.round(part / whole * 100)}%` : '—';
const width = (part: number, whole: number) => `${whole > 0 ? Math.max(part > 0 ? 2 : 0, Math.round(part / whole * 100)) : 0}%`;
const dayLabel = (day: string) => { const time = Date.parse(`${day}T12:00:00Z`); return Number.isFinite(time) ? DAY_LABEL.format(time) : day; };
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

function validReport(value: unknown): value is Report {
  const report = value as Report;
  return Boolean(report) && Number.isFinite(Date.parse(report.fetchedAt)) && typeof report.since === 'string'
    && isNumber(report.people?.signedIn) && isNumber(report.people?.applied) && isNumber(report.people?.hired) && isNumber(report.signIns)
    && isNumber(report.applications?.total) && Array.isArray(report.stages) && Array.isArray(report.offices) && Array.isArray(report.days);
}

export default function EventAttendanceBoard() {
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [signInNeeded, setSignInNeeded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [todayKey, setTodayKey] = useState('');
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true);
    try {
      const response = await fetch('/api/event-attendance', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) { setSignInNeeded(true); setData(null); }
        throw new Error(typeof result?.error?.message === 'string' ? result.error.message : 'Event attendance could not refresh. Use Refresh to try again.');
      }
      if (!validReport(result)) throw new Error('HubSpot returned an incomplete update. Use Refresh to try again.');
      setData(result); setTodayKey(TODAY.format(Date.parse(result.fetchedAt))); setError(''); setSignInNeeded(false);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Event attendance could not refresh.');
    } finally { if (!controller.signal.aborted) setBusy(false); active.current = null; }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    // Refreshes each minute while visible, so the page keeps up during an event.
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, REFRESH_MS);
    const resume = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', resume);
    return () => { clearTimeout(initial); clearInterval(timer); document.removeEventListener('visibilitychange', resume); active.current?.abort(); };
  }, [refresh]);

  const people = data?.people;
  const today = data?.days.find(row => row.day === todayKey);
  const since = data ? SINCE_LABEL.format(Date.parse(`${data.since}T12:00:00Z`)) : 'Nov 10, 2026';
  const stageTotal = data?.stages.reduce((sum, stage) => sum + stage.count, 0) ?? 0;
  const funnel = people ? [
    { label: 'Signed in', value: people.signedIn, note: 'Everyone who signed in at an event' },
    { label: 'Applied', value: people.applied, note: `${share(people.applied, people.signedIn)} of sign-ins sent the online application` },
    { label: 'Hired', value: people.hired, note: `${share(people.hired, people.applied)} of applicants · ${share(people.hired, people.signedIn)} of sign-ins` },
  ] : [];

  return <main className={styles.board}>
    <header className={styles.header}>
      <div className={styles.identity}><Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners" width={164} height={107} priority className={styles.logo} /><div><p className={styles.brand}>Legacy Agency Partners</p><h1>Event Attendance</h1><p className={styles.subtitle}>Hiring event sign-ins and online applications since {since}</p></div></div>
      <div className={styles.controls}><span className={`${styles.status} ${error ? styles.warning : ''}`} role="status">{error ? 'Update unavailable' : data ? `Updated ${UPDATED.format(Date.parse(data.fetchedAt))}` : 'Loading'}</span><button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh'}</button></div>
    </header>

    {error && <div role="alert" className={styles.alert}><p>{error}{data ? ' The last numbers received are shown below.' : ''}</p>{signInNeeded && <a href="/sign-in?return_to=%2F%23event-attendance" target="_top">Sign in</a>}</div>}
    {data?.partial && <p role="status" className={styles.alert}>HubSpot returned more notes than this page reads at once, so the oldest sign-ins and applications may be missing from these counts.</p>}

    <p className={styles.lede}>{data ? <>Since {since}, <strong>{count(people?.signedIn)}</strong> {people?.signedIn === 1 ? 'person has' : 'people have'} signed in at a hiring event. <strong>{count(people?.applied)}</strong> of them applied online and <strong>{count(people?.hired)}</strong> reached Completed.</> : busy ? 'Loading hiring event attendance from HubSpot…' : 'Attendance is unavailable right now.'}</p>

    <section className={styles.tiles} aria-label="Totals">
      <article><h2>Signed in</h2><p className={styles.big}>{count(people?.signedIn)}</p><span>People · {count(data?.signIns)} sign-ins in all</span></article>
      <article><h2>Applied</h2><p className={styles.big}>{count(people?.applied)}</p><span>{share(people?.applied, people?.signedIn)} of people who signed in</span></article>
      <article><h2>Hired</h2><p className={styles.big}>{count(people?.hired)}</p><span>{share(people?.hired, people?.signedIn)} reached Completed</span></article>
      <aside><h2>Today</h2><p className={styles.big}>{data ? count(today?.signIns ?? 0) : '—'}</p><span>Sign-ins · {data ? count(today?.applications ?? 0) : '—'} applications</span></aside>
    </section>

    <div className={styles.pair}>
      <section className={styles.card} aria-labelledby="funnel-title">
        <h2 id="funnel-title">Sign-in → application → hire</h2>
        <p className={styles.muted}>Each bar is a share of everyone who signed in.</p>
        <ol className={styles.bars}>{funnel.map(step => <li key={step.label}><div className={styles.barHead}><span>{step.label}</span><strong>{count(step.value)}</strong></div><div className={styles.track} aria-hidden="true"><span style={{ width: width(step.value, people?.signedIn ?? 0) }} /></div><p className={styles.muted}>{step.note}</p></li>)}</ol>
        {!data && <p className={styles.empty}>{busy ? 'Loading…' : 'No data.'}</p>}
      </section>
      <section className={styles.card} aria-labelledby="stage-title">
        <h2 id="stage-title">Where sign-ins are now</h2>
        <p className={styles.muted}>Current Recruiting stage of each person who signed in.</p>
        <ol className={styles.bars}>{data?.stages.map(stage => <li key={stage.stageId}><div className={styles.barHead}><span>{stage.label}</span><strong>{count(stage.count)}</strong></div><div className={styles.track} aria-hidden="true"><span style={{ width: width(stage.count, stageTotal) }} /></div></li>)}</ol>
        {data && !data.stages.length && <p className={styles.empty}>No sign-ins yet.</p>}
      </section>
    </div>

    <section className={styles.card} aria-labelledby="days-title">
      <div className={styles.sectionHeading}><h2 id="days-title">Attendance by event day and office</h2><span>Newest first · Eastern time</span></div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th scope="col">Event day</th>{data?.offices.map(office => <th scope="col" key={office.key}>{office.label}</th>)}<th scope="col">Sign-ins</th><th scope="col">Online applications</th></tr></thead>
          <tbody>{data?.days.map(row => <tr key={row.day}><th scope="row">{dayLabel(row.day)}</th>{data.offices.map(office => <td key={office.key}>{count(row.offices[office.key] ?? 0)}</td>)}<td className={styles.total}>{count(row.signIns)}</td><td>{count(row.applications)}</td></tr>)}</tbody>
        </table>
      </div>
      {data && !data.days.length && <p className={styles.empty}>No sign-ins or applications yet.</p>}
    </section>

    <section className={styles.card} aria-labelledby="apps-title">
      <h2 id="apps-title">Online applications</h2>
      <div className={styles.appTotals}>
        <article><h3>All online applications</h3><strong>{count(data?.applications.total)}</strong></article>
        <article><h3>From people who signed in</h3><strong>{count(data?.applications.fromAttendees)}</strong></article>
        <article><h3>New applicants</h3><strong>{count(data?.applications.otherTickets)}</strong><span>Not signed in at an event</span></article>
        <article><h3>Did not meet a required item</h3><strong>{count(data?.applications.noTicket)}</strong><span>No recruiting ticket was created</span></article>
      </div>
    </section>

    <details className={styles.card}>
      <summary>How each number is counted</summary>
      <ul className={styles.definitions}>
        <li><strong>Signed in</strong>: people with a sign-in from the hiring event sign-in page. Each person counts once, by their recruiting ticket. The attendance table counts every sign-in, so someone who comes to two events is in both days.</li>
        <li><strong>Applied</strong>: people who signed in and also sent the online application, before or after signing in.</li>
        <li><strong>Hired</strong>: people who signed in whose recruiting ticket is now at Completed. Withdrawn tickets are not hires.</li>
        <li><strong>Office</strong>: the office the person picked when signing in.</li>
        <li><strong>Online applications</strong>: every application sent from the application page. Someone who applies twice counts twice.</li>
        <li>Numbers come from HubSpot each time this page loads and every minute while it is open. Only counts reach this page; names and answers stay in HubSpot.</li>
      </ul>
    </details>
  </main>;
}
