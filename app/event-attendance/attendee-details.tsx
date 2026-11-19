'use client';
import type { Application } from '../applications-page';
import styles from './event-attendance.module.css';
import { officeLabel, shortDay, when, type Visit } from './people-lists';

const WHEN = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const applied = (iso: string) => { const time = Date.parse(iso); return Number.isFinite(time) ? `${WHEN.format(time)} ET` : 'Date not recorded'; };
const signedIn = (visit: Visit) => visit.imported ? `${shortDay(visit.day)} · imported list` : when(visit.at);

/**
 * The part of an Event Attendance name card below the recruit's CRM details: their hiring event sign-ins and, where
 * the list shows applications, everything they entered on the online application. application is undefined until the
 * Applications list has loaded and null when no application matches the person.
 */
export default function AttendeeDetails({ visits, appliedAt, showApplication, application }: { visits: readonly Visit[]; appliedAt: string | null; showApplication: boolean; application?: Application | null }) {
  const latest = visits[0], first = visits.at(-1);
  const hasApplication = Boolean(appliedAt || application);
  return <div className={styles.hoverExtra}>
    <p className={styles.hoverHeading}>Hiring event</p>
    <dl className={styles.hoverFacts}>
      {latest ? <>
        <div><dt>Signed in</dt><dd>{visits.length > 1 ? `${visits.length} times · last ${signedIn(latest)}` : signedIn(latest)}</dd></div>
        {visits.length > 1 && first && <div><dt>First signed in</dt><dd>{signedIn(first)}</dd></div>}
        <div><dt>Office picked</dt><dd>{latest.office ? officeLabel(latest.office) : 'Not recorded'}</dd></div>
        <div><dt>How they heard</dt><dd>{latest.heardAbout || 'Not recorded'}</dd></div>
        <div><dt>License</dt><dd>{latest.license || 'Not recorded'}</dd></div>
        {latest.source && <div><dt>Signed in from</dt><dd>{latest.source}</dd></div>}
      </> : <div><dt>Signed in</dt><dd>No hiring event sign-in</dd></div>}
      <div><dt>Applied online</dt><dd>{appliedAt ? when(appliedAt) : application ? applied(application.at) : 'Not yet'}</dd></div>
    </dl>
    {showApplication && hasApplication && <>
      <p className={styles.hoverHeading}>Application</p>
      {application === undefined ? <p className={styles.hoverNote}>The answers show here once the Applications list below has loaded.</p>
        : application === null ? <p className={styles.hoverNote}>This application&apos;s answers aren&apos;t in the loaded Applications list. Open Applications to read them.</p>
        : <>
          <p className={styles.hoverNote}>Applied {applied(application.at)}{application.preferredName ? ` · goes by ${application.preferredName}` : ''}</p>
          <ul className={styles.hoverBadges}>
            <li className={application.requirementsMet === false ? styles.hoverBad : undefined}>{application.requirementsMet === false ? `Did not meet ${application.missed.length || ''} required item${application.missed.length === 1 ? '' : 's'}` : application.requirementsMet ? 'Met every required item' : 'Required items not recorded'}</li>
            {application.flags.length > 0 && <li className={styles.hoverWarn}>Private conversation: {application.flags.length}</li>}
            <li>{application.photos?.length ? 'Photo ID attached' : 'No photo ID'}</li>
          </ul>
          {application.missed.length > 0 && <><p className={styles.hoverSubheading}>Required items not met</p><ul className={styles.hoverList}>{application.missed.map(text => <li key={text}>{text}</li>)}</ul></>}
          {application.flags.length > 0 && <><p className={styles.hoverSubheading}>Needs a private conversation</p><ul className={styles.hoverList}>{application.flags.map(text => <li key={text}>{text}</li>)}</ul></>}
          {application.sections.map(section => <div key={section.title}>
            <p className={styles.hoverSubheading}>{section.title}</p>
            <dl className={styles.hoverFacts}>{section.rows.map((row, index) => <div key={`${row.label}-${index}`} className={row.value === 'Not answered' ? styles.hoverUnanswered : undefined}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          </div>)}
        </>}
    </>}
  </div>;
}
