'use client';
import type { ReactNode } from 'react';
import styles from './event-attendance.module.css';

type Person = { ticketId: string | null; name: string; email: string; phone: string; office: string; stageId: string; stage: string; hubspotUrl: string | null };
export type Visit = Person & { day: string; at: string; heardAbout: string; license: string; source: string; imported: boolean };
export type Applicant = Person & { day: string; at: string; license?: string; fromAttendee: boolean };
export type Attendee = Person & { ticketId: string; signIns: number; firstDay: string; lastDay: string; appliedAt: string | null };
type Column<T> = { label: string; render: (row: T) => ReactNode };

const ZONE = 'America/New_York';
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const OFFICE_LABELS: Record<string, string> = { orlando: 'Orlando', miami: 'Miami', tampa: 'Tampa', other: 'Not recorded' };

export const shortDay = (day: string) => { const time = Date.parse(`${day}T12:00:00Z`); return Number.isFinite(time) ? DAY.format(time) : day; };
const when = (iso: string | null) => { const time = iso ? Date.parse(iso) : NaN; return Number.isFinite(time) ? TIME.format(time) : '—'; };
const officeLabel = (key: string) => OFFICE_LABELS[key] ?? (key || '—');
function phoneText(value: string) {
  const digits = value.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return local.length === 10 ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : value;
}

// The recruit opens in the workspace around this frame.
const nameCell = (row: Person) => row.ticketId ? <a href={`/#recruit/${row.ticketId}`} target="_top" title="Open this recruit in the CRM">{row.name}</a> : row.name;
const phoneCell = (row: Person) => row.phone ? <a href={`tel:${row.phone.replace(/[^\d+]/g, '')}`}>{phoneText(row.phone)}</a> : '—';
const emailCell = (row: Person) => row.email ? <a href={`mailto:${row.email}`}>{row.email}</a> : '—';
const contact: Column<Person>[] = [
  { label: 'Name', render: nameCell }, { label: 'Phone', render: phoneCell }, { label: 'Email', render: emailCell }, { label: 'Office', render: row => officeLabel(row.office) },
];

// The previews leave out stage, location and the HubSpot link: the recruit and the Applications page have them.
export const attendeeColumns: Column<Attendee>[] = [
  ...contact,
  { label: 'Sign-ins', render: row => row.signIns > 1 ? `${row.signIns} · last ${shortDay(row.lastDay)}` : shortDay(row.lastDay) },
  { label: 'Applied online', render: row => row.appliedAt ? when(row.appliedAt) : 'Not yet' },
];
export const appliedColumns: Column<Attendee>[] = [
  ...contact,
  { label: 'Applied online', render: row => when(row.appliedAt) },
  { label: 'Signed in', render: row => shortDay(row.lastDay) },
];
export const hiredColumns: Column<Attendee>[] = [
  ...contact,
  { label: 'First signed in', render: row => shortDay(row.firstDay) },
];
export const visitColumns: Column<Visit>[] = [
  ...contact,
  { label: 'Signed in', render: row => row.imported ? `${shortDay(row.day)} · imported list` : when(row.at) },
  { label: 'How they heard', render: row => row.heardAbout || '—' },
  { label: 'License', render: row => row.license || '—' },
];
export const applicantColumns: Column<Applicant>[] = [
  ...contact,
  { label: 'Applied', render: row => when(row.at) },
  { label: 'License', render: row => row.license || '—' },
  { label: 'Signed in at an event', render: row => row.fromAttendee ? 'Yes' : 'No' },
];

// total is the whole list's size when rows is one page of it.
export function PeopleTable<T extends { ticketId: string | null }>({ title, rows, columns, empty, actions, total = rows.length }: { title: string; rows: T[]; columns: Column<T>[]; empty: string; actions?: (row: T) => ReactNode; total?: number }) {
  return <div className={styles.peopleBlock}>
    <h3>{title} <span>{total}</span></h3>
    {rows.length ? <div className={styles.tableWrap}><table className={`${styles.table} ${styles.peopleTable}`}>
      <thead><tr>{columns.map(column => <th scope="col" key={column.label}>{column.label}</th>)}{actions && <th scope="col">Review and notes</th>}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.ticketId ?? 'none'}-${index}`}>{columns.map((column, at) => at === 0 ? <th scope="row" key={column.label}>{column.render(row)}</th> : <td key={column.label}>{column.render(row)}</td>)}{actions && <td>{actions(row)}</td>}</tr>)}</tbody>
    </table></div> : <p className={styles.empty}>{empty}</p>}
  </div>;
}
