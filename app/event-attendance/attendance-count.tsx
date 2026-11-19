'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RecruitCommunications from '../recruit-communications';
import { useRecruitEmail } from '../recruit-email';
import { AddActivityButtons } from '../recruit-quick-actions';
import { applicantColumns, visitColumns, type Applicant, type Visit } from './people-lists';
import styles from './event-attendance.module.css';

export type AttendanceSelection = { kind: 'sign-ins' | 'applications'; day: string };
export function AttendanceDetails({ selection, visits, applicants, canAdd }: { selection: AttendanceSelection; visits: Visit[]; applicants: Applicant[]; canAdd: boolean }) {
  const email = useRecruitEmail();
  const rows = selection.kind === 'sign-ins' ? visits.filter(row => row.day === selection.day) : applicants.filter(row => row.day === selection.day);
  return <div className={styles.countDetails}>{!rows.length && <p>No {selection.kind === 'sign-ins' ? 'sign-ins' : 'online applications'} on this day.</p>}{rows.map((row, index) => <article key={`${row.ticketId}-${index}`}>
    <h3>{row.name}</h3>
    <dl>{selection.kind === 'sign-ins' ? visitColumns.map(column => <div key={column.label}><dt>{column.label}</dt><dd>{column.render(row as Visit)}</dd></div>) : applicantColumns.map(column => <div key={column.label}><dt>{column.label}</dt><dd>{column.render(row as Applicant)}</dd></div>)}<div><dt>Recruiting stage</dt><dd>{row.stage || 'No recruiting ticket'}</dd></div></dl>
    {row.ticketId ? <><RecruitCommunications recruitId={row.ticketId} recruitName={row.name} phone={row.phone} hubspotUrl={row.hubspotUrl || ''} labeled />{canAdd && <AddActivityButtons recruitId={row.ticketId} recruitName={row.name} />}</> : <><p>No recruiting ticket is associated with this application.</p><div className={styles.unlinkedActions}>{row.phone ? <><a href={`tel:${row.phone.replace(/[^\d+]/g, '')}`}>Call</a><button disabled title="Texting is paused while messaging approval is pending">Text</button></> : <><button disabled>Call</button><button disabled>Text</button></>}{row.email ? email.disabled ? <a href={`mailto:${row.email}`}>Email</a> : <button type="button" onClick={() => email.open('', row.name)}>Email</button> : <button disabled>Email</button>}{['Task', 'Follow-up', 'Meeting', 'Calendar'].map(label => <button key={label} disabled title="A recruiting ticket is required">{label}</button>)}</div></>}
  </article>)}</div>;
}
export default function AttendanceCount({ selection, value, visits, applicants, canAdd }: { selection: AttendanceSelection; value: number; visits: Visit[]; applicants: Applicant[]; canAdd: boolean }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const keep = () => { if (timer.current) clearTimeout(timer.current); };
  const close = () => { keep(); timer.current = setTimeout(() => { if (!document.querySelector('dialog[open]')) setPosition(null); }, 300); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const href = `/event-attendance?kind=${selection.kind}&day=${selection.day}`;
  const title = `${selection.kind === 'sign-ins' ? 'Sign-ins' : 'Online applications'} · ${selection.day}`;
  return <><a className={styles.countButton} href={href} target="_top" aria-label={`${value} ${title}. Open recruit list`} aria-controls={position ? id : undefined} onMouseEnter={event => { keep(); const box = event.currentTarget.getBoundingClientRect(); setPosition({ top: Math.max(8, Math.min(box.bottom, window.innerHeight - 360)), left: Math.max(8, Math.min(box.left, window.innerWidth - 650)) }); }} onMouseLeave={close} onFocus={event => { const box = event.currentTarget.getBoundingClientRect(); setPosition({ top: Math.max(8, Math.min(box.bottom, window.innerHeight - 360)), left: Math.max(8, Math.min(box.left, window.innerWidth - 650)) }); }} onBlur={close}>{value.toLocaleString('en-US')}</a>{position && createPortal(<section id={id} role="region" aria-label={title} className={styles.countPreview} style={position} onMouseEnter={keep} onMouseLeave={close} onFocus={keep} onBlur={close} onKeyDown={event => { if (event.key === 'Escape') setPosition(null); }}><div className={styles.peopleHead}><a href={href} target="_top">{title} ↗</a><button type="button" aria-label="Close attendance preview" onClick={() => setPosition(null)}>×</button></div><AttendanceDetails selection={selection} visits={visits} applicants={applicants} canAdd={canAdd} /></section>, document.body)}</>;
}
