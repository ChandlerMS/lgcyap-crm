'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useEventReviews, type Review } from '../event-review';
import ApplicationsPage from '../applications-page';
import styles from './event-attendance.module.css';
import AttendeeImport, { type AttendeeValues } from './attendee-import';
import { ATTENDEE_TEMPLATE_CSV, HUBSPOT_SOURCE_URL, attendanceCsv, attendanceCsvFilename, parseAttendeeFile } from './attendance-files.mjs';
import { applicantColumns, appliedColumns, attendeeColumns, hiredColumns, PeopleTable, visitColumns, type Applicant, type Attendee, type Visit } from './people-lists';

const COMPLETED_STAGE_ID = '1416243218';
type Tile = 'signedIn' | 'applied' | 'hired' | 'today';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Office = { key: string; label: string };
type Day = { day: string; offices: Record<string, number>; signIns: number; applications: number };
type Stage = { stageId: string; label: string; count: number };
type Report = {
  fetchedAt: string; since: string; partial: boolean;
  people: { signedIn: number; applied: number; hired: number };
  signIns: number;
  applications: { total: number; fromAttendees: number; otherTickets: number; noTicket: number };
  stages: Stage[]; offices: Office[]; days: Day[];
  attendees?: Attendee[]; visits?: Visit[]; applicants?: Applicant[];
  canImport?: boolean; canReview?: boolean; reviews?: Record<string, Review>; reviewComplete?: boolean; reviewNotice?: string;
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
const dayLabel = (day: string) => { const time = Date.parse(`${day}T12:00:00Z`); return Number.isFinite(time) ? DAY_LABEL.format(time) : day; };
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

function validReport(value: unknown): value is Report {
  const report = value as Report;
  return Boolean(report) && Number.isFinite(Date.parse(report.fetchedAt)) && typeof report.since === 'string'
    && isNumber(report.people?.signedIn) && isNumber(report.people?.applied) && isNumber(report.people?.hired) && isNumber(report.signIns)
    && isNumber(report.applications?.total) && Array.isArray(report.stages) && Array.isArray(report.offices) && Array.isArray(report.days);
}

// As a section of the Recruiting Dashboard it drops the logo and page title and sits under the page's own heading.
export default function EventAttendanceBoard({ section = false }: { section?: boolean }) {
  const Root = section ? 'section' : 'main';
  const Title = section ? 'h2' : 'h1';
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [signInNeeded, setSignInNeeded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [todayKey, setTodayKey] = useState('');
  const [importFile, setImportFile] = useState<{ name: string; attendees: AttendeeValues[]; id: number } | null>(null);
  const [importError, setImportError] = useState('');
  const [reading, setReading] = useState(false);
  // One list open at a time: a tile, an event day, or one office on an event day.
  const [openTile, setOpenTile] = useState<Tile | null>(null);
  const [openDay, setOpenDay] = useState<{ day: string; office: string | null } | null>(null);
  // The Applications section reads the Applications page's list again on Refresh, or when a new application shows in the counts.
  const [appsReload, setAppsReload] = useState(0);
  const appsTotal = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const active = useRef<AbortController | null>(null);
  async function chooseFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setReading(true); setImportError('');
    try { setImportFile({ name: file.name, attendees: await parseAttendeeFile(file) as AttendeeValues[], id: Date.now() }); }
    catch (failure) { setImportError(failure instanceof Error ? failure.message : 'This file could not be read.'); }
    finally { setReading(false); }
  }
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
      if (appsTotal.current !== null && appsTotal.current !== result.applications.total) setAppsReload(value => value + 1);
      appsTotal.current = result.applications.total;
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
  const attendees = data?.attendees ?? [], visits = data?.visits ?? [], applicants: Applicant[] = data?.applicants ?? [];
  const toggleTile = (tile: Tile) => { setOpenDay(null); setOpenTile(current => current === tile ? null : tile); };
  const toggleDay = (day: string, office: string | null) => { setOpenTile(null); setOpenDay(current => current?.day === day && current.office === office ? null : { day, office }); };
  const officeName = (key: string) => data?.offices.find(office => office.key === key)?.label ?? key;
  // Approve and Deny in every list here, the Applications section included, share one state.
  const review = useEventReviews({ reviews: data?.reviews, reviewComplete: data?.reviewComplete, canReview: data?.canReview, onSignedOut: () => { setSignInNeeded(true); setData(null); }, onStale: () => void refresh() });
  const reviewActions = review.actions;
  const refreshAll = () => { void refresh(); setAppsReload(value => value + 1); };
  const applicationsSignedOut = useCallback(() => { setSignInNeeded(true); setError('Your sign-in has expired. Sign in again to see applications.'); }, []);
  const tiles: { key: Tile; label: string; value: string; note: string }[] = [
    { key: 'signedIn', label: 'Signed in', value: count(people?.signedIn), note: `People · ${count(data?.signIns)} sign-ins in all` },
    { key: 'applied', label: 'Applied', value: count(people?.applied), note: `${share(people?.applied, people?.signedIn)} of people who signed in` },
    { key: 'hired', label: 'Hired', value: count(people?.hired), note: `${share(people?.hired, people?.signedIn)} reached Completed` },
    { key: 'today', label: 'Today', value: data ? count(today?.signIns ?? 0) : '—', note: `Sign-ins · ${data ? count(today?.applications ?? 0) : '—'} applications` },
  ];
  const tileList = () => {
    if (openTile === 'signedIn') return <PeopleTable title="Everyone who signed in" rows={attendees} columns={attendeeColumns} actions={reviewActions} empty="No one has signed in yet." />;
    if (openTile === 'applied') return <PeopleTable title="Signed in and applied online" rows={attendees.filter(person => person.appliedAt)} columns={appliedColumns} actions={reviewActions} empty="No one who signed in has applied online yet." />;
    if (openTile === 'hired') return <PeopleTable title="Signed in and reached Completed" rows={attendees.filter(person => person.stageId === COMPLETED_STAGE_ID)} columns={hiredColumns} empty="No one who signed in has reached Completed yet." />;
    if (openTile === 'today') return <><PeopleTable title="Signed in today" rows={visits.filter(visit => visit.day === todayKey)} columns={visitColumns} actions={reviewActions} empty="No sign-ins yet today." /><PeopleTable title="Applied online today" rows={applicants.filter(item => item.day === todayKey)} columns={applicantColumns} actions={reviewActions} empty="No online applications yet today." /></>;
    return null;
  };
  const dayList = (day: string, office: string | null) => office
    ? <PeopleTable title={`Signed in at ${officeName(office)} on ${dayLabel(day)}`} rows={visits.filter(visit => visit.day === day && visit.office === office)} columns={visitColumns} actions={reviewActions} empty="No sign-ins." />
    : <><PeopleTable title={`Signed in on ${dayLabel(day)}`} rows={visits.filter(visit => visit.day === day)} columns={visitColumns} actions={reviewActions} empty="No sign-ins this day." /><PeopleTable title={`Applied online on ${dayLabel(day)}`} rows={applicants.filter(item => item.day === day)} columns={applicantColumns} actions={reviewActions} empty="No online applications this day." /></>;

  return <Root className={section ? `${styles.board} ${styles.section}` : styles.board} aria-labelledby={section ? 'event-attendance-title' : undefined}>
    <div className={styles.topRow}><span className={`${styles.status} ${error ? styles.warning : ''}`} role="status">{error ? 'Update unavailable' : data ? `Updated ${UPDATED.format(Date.parse(data.fetchedAt))}` : 'Loading'}</span></div>
    <header className={styles.header}>
      <div className={styles.identity}>{!section && <Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners" width={164} height={107} priority className={styles.logo} />}<div>{!section && <p className={styles.brand}>Legacy Agency Partners</p>}<Title id="event-attendance-title">{section ? <a className="panel-title-link" href="#event-attendance">Event Attendance</a> : "Event Attendance"}</Title><p className={styles.subtitle}>Hiring event sign-ins and online applications since {since}, plus imported sign-in lists</p></div></div>
      <div className={styles.controls}>
        <a className={styles.action} href={HUBSPOT_SOURCE_URL} target="_blank" rel="noopener noreferrer" title="Opens the Recruiting tickets from the sign-in page, the application page and imported lists. If HubSpot shows another pipeline, choose Recruiting.">Open in HubSpot <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
        <button type="button" disabled={!data} onClick={() => data && download(attendanceCsvFilename(data.fetchedAt), attendanceCsv(data))}>Export CSV</button>
        {data?.canImport && <><input ref={fileRef} type="file" accept=".csv,.xlsx" className="sr-only" tabIndex={-1} aria-label="Choose a sign-in list to import (CSV or Excel)" onChange={event => void chooseFile(event.target.files?.[0])} /><button type="button" disabled={reading || Boolean(importFile)} onClick={() => fileRef.current?.click()}>{reading ? 'Reading file…' : 'Import attendees'}</button></>}
        <button type="button" disabled={busy} onClick={refreshAll}>{busy ? 'Refreshing…' : 'Refresh'}</button>
      </div>
    </header>
    <p className={styles.hint}>Open in HubSpot shows the Recruiting tickets these numbers come from. If HubSpot opens another pipeline, choose Recruiting at the top right.{data?.canImport && <> Import a sign-in list as CSV or Excel with First Name, Last Name (or Name), Phone Number, Email, Office and Event Date columns. <button type="button" className={styles.linkButton} onClick={() => download('sign-in-list-template.csv', ATTENDEE_TEMPLATE_CSV)}>Download the template</button>.</>}</p>

    {importError && <p role="alert" className={styles.alert}>{importError}</p>}
    {importFile && <AttendeeImport key={importFile.id} fileName={importFile.name} attendees={importFile.attendees} onClose={() => setImportFile(null)} onImported={() => void refresh()} />}

    {data?.reviewNotice && <p role="status" className={styles.hint}>{data.reviewNotice}</p>}
    {review.error && <div className={styles.alert} role="alert">{review.error} {review.retry ? <button type="button" onClick={review.retry}>Retry review</button> : <button type="button" onClick={() => void refresh()}>Refresh statuses</button>}</div>}
    {error &&<div role="alert" className={styles.alert}><p>{error}{data ? ' The last numbers received are shown below.' : ''}</p>{signInNeeded && <a href="/sign-in?return_to=%2F%23event-attendance" target="_top">Sign in</a>}</div>}
    {data?.partial && <p role="status" className={styles.alert}>HubSpot returned more notes than this page reads at once, so the oldest sign-ins and applications may be missing from these counts.</p>}

    <p className={styles.lede}>{data ? <><strong>{count(people?.signedIn)}</strong> {people?.signedIn === 1 ? 'person has' : 'people have'} signed in at a hiring event. <strong>{count(people?.applied)}</strong> of them applied online and <strong>{count(people?.hired)}</strong> reached Completed.</> : busy ? 'Loading hiring event attendance from HubSpot…' : 'Attendance is unavailable right now.'}</p>

    <section className={styles.tiles} aria-label="Totals. Select one to see the people in it.">
      {tiles.map(tile => <button type="button" key={tile.key} className={`${styles.tile} ${tile.key === 'today' ? styles.todayTile : ''} ${openTile === tile.key ? styles.tileOpen : ''}`} disabled={!data} aria-expanded={openTile === tile.key} aria-controls="tile-people" onClick={() => toggleTile(tile.key)}>
        <span className={styles.tileLabel}>{tile.label}</span>
        <span className={styles.big}>{tile.value}</span>
        <span className={styles.tileNote}>{tile.note}</span>
        <span className={styles.tileMore}>{openTile === tile.key ? 'Hide people ▲' : 'Show people ▼'}</span>
      </button>)}
    </section>
    {openTile && data && <section id="tile-people" className={`${styles.card} ${styles.peoplePanel}`} aria-label={`${tiles.find(tile => tile.key === openTile)?.label} — people`}>
      <div className={styles.peopleHead}><p className={styles.muted}>Select a name to open the recruit in the CRM.</p><button type="button" onClick={() => setOpenTile(null)}>Close</button></div>
      {tileList()}
    </section>}

    <section className={styles.card} aria-labelledby="days-title">
      <div className={styles.sectionHeading}><h2 id="days-title">Attendance by event day and office</h2><span>Newest first · Eastern time · Select a day or a number to see who signed in</span></div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th scope="col">Event day</th>{data?.offices.map(office => <th scope="col" key={office.key}>{office.label}</th>)}<th scope="col">Sign-ins</th><th scope="col">Online applications</th></tr></thead>
          <tbody>{data?.days.map(row => {
            const dayOpen = openDay?.day === row.day && openDay.office === null;
            return <Fragment key={row.day}>
              <tr className={openDay?.day === row.day ? styles.rowOpen : undefined}>
                <th scope="row"><button type="button" className={styles.dayButton} aria-expanded={dayOpen} aria-controls={`day-${row.day}`} onClick={() => toggleDay(row.day, null)}>{dayLabel(row.day)}<span aria-hidden="true">{dayOpen ? ' ▲' : ' ▼'}</span></button></th>
                {data.offices.map(office => {
                  const value = row.offices[office.key] ?? 0;
                  const cellOpen = openDay?.day === row.day && openDay.office === office.key;
                  return <td key={office.key}>{value ? <button type="button" className={`${styles.countButton} ${cellOpen ? styles.countOpen : ''}`} aria-expanded={cellOpen} aria-controls={`day-${row.day}`} aria-label={`${value} signed in at ${office.label} on ${dayLabel(row.day)}. ${cellOpen ? 'Hide' : 'Show'} people.`} onClick={() => toggleDay(row.day, office.key)}>{count(value)}</button> : count(0)}</td>;
                })}
                <td className={styles.total}>{count(row.signIns)}</td><td>{count(row.applications)}</td>
              </tr>
              {openDay?.day === row.day && <tr className={styles.detailRow}><td id={`day-${row.day}`} colSpan={data.offices.length + 3}>
                <div className={styles.peopleHead}><p className={styles.muted}>Select a name to open the recruit in the CRM.</p><button type="button" onClick={() => setOpenDay(null)}>Close</button></div>
                {dayList(row.day, openDay.office)}
              </td></tr>}
            </Fragment>;
          })}</tbody>
        </table>
      </div>
      {data && !data.days.length && <p className={styles.empty}>No sign-ins or applications yet.</p>}
    </section>

    {/* The Applications page's list, ten a page, sharing this board's Refresh and Approve and Deny. Its title opens
        the full page: in the dashboard by its route, and from this page's own frame in the top window. */}
    <div className={styles.card}>
      <ApplicationsPage onUnauthorized={applicationsSignedOut} board={{ review, reload: appsReload, topWindow: !section }} />
    </div>

    <details className={styles.card}>
      <summary>How each number is counted</summary>
      <ul className={styles.definitions}>
        <li><strong>Signed in</strong>: people with a sign-in from the hiring event sign-in page (live since {since}) or from an imported sign-in list. Each person counts once, by their recruiting ticket. The attendance table counts every sign-in, so someone who comes to two events is in both days.</li>
        <li><strong>Imported lists</strong>: each person is matched to HubSpot by phone and email. A new person gets a contact and a Recruiting ticket at Hiring Event; everyone gets a sign-in on the event day, unless they already have one for that day. Nothing in HubSpot is overwritten.</li>
        <li><strong>Applied</strong>: people who signed in and also sent the online application, before or after signing in.</li>
        <li><strong>Hired</strong>: people who signed in whose recruiting ticket is now at Completed. Withdrawn tickets are not hires.</li>
        <li><strong>Office</strong>: the office the person picked when signing in.</li>
        <li><strong>Applications</strong>: the same list as the Applications page, every application sent from the application page, newest first. Someone who applies twice is listed twice. <strong>Did not meet a required item</strong> have no recruiting ticket, because the application page creates one only when every required item is met; <strong>Need a private conversation</strong> answered a question the hiring team should discuss with them; <strong>Still at Hiring Event</strong> already had a ticket at Hiring Event, which applying does not move.</li>
        <li><strong>Approve</strong> and <strong>Deny</strong> save the decision as a note on the person&apos;s recruiting ticket. The same decision shows in every list here and on the Applications page.</li>
        <li>Numbers come from HubSpot each time this page loads and every minute while it is open. The Applications list reads again on Refresh and whenever a new application comes in. The lists show what each person entered when signing in or applying. Like the rest of the recruiting workspace, they are visible only to recruiting editors.</li>
      </ul>
    </details>
  </Root>;
}
