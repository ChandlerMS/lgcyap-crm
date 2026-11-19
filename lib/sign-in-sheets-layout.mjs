import { calendarWeeks, monthlyRecords, reportCell } from './monthly-sheets-layout.mjs';
import { OFFICES } from './recruiting-config.mjs';
const WHEN = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const headers = ['Sign-in ID', 'Name', 'Phone', 'Email', 'Office', 'Signed in (Eastern)', 'Event date', 'How they heard', 'License', 'Sign-in source', 'Imported list', 'Current recruiting stage', 'Sign-ins (person)', 'First sign-in', 'Latest sign-in', 'Applied online at', 'HubSpot recruit'];
export function buildSignInWorkbooks(report, now = new Date(), managedMonths = []) {
  if (report?.partial !== false || !Array.isArray(report.visits)) throw new Error('Refusing partial sign-in data.');
  const attendees = new Map((report.attendees ?? []).map(person => [person.ticketId, person]));
  return monthlyRecords(report.visits.map(visit => ({ ...visit, id: visit.noteId })), now, managedMonths).map(([month, visits]) => ({
    month, title: `${month.slice(5)}-${month.slice(2, 4)} Sign-Ins`,
    tabs: calendarWeeks(month).map(week => ({ title: week.title, values: [headers, ...visits.filter(visit => Number(visit.day.slice(8)) >= week.start && Number(visit.day.slice(8)) <= week.end).map(visit => {
      const person = attendees.get(visit.ticketId);
      return [visit.id, visit.name, visit.phone, visit.email, OFFICES[visit.office] ?? 'Not recorded', WHEN.format(new Date(visit.at)), visit.day, visit.heardAbout, visit.license, visit.source, visit.imported ? 'Yes' : 'No', visit.stage, person?.signIns, person?.firstDay, person?.lastDay, person?.appliedAt, visit.hubspotUrl].map(reportCell);
    })] })),
  }));
}
