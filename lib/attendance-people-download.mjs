import { tableCsv, tableWorkbook } from './application-download.mjs';

const offices = { orlando: 'Orlando', miami: 'Miami', tampa: 'Tampa', other: 'Not recorded' };
const fields = [['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['office', 'Office'], ['stage', 'Recruiting stage'], ['ticketId', 'HubSpot ticket ID'], ['hubspotUrl', 'Open in HubSpot'], ['signIns', 'Sign-ins'], ['firstDay', 'First signed in'], ['lastDay', 'Last signed in'], ['appliedAt', 'Applied online'], ['day', 'Event day'], ['at', 'Submitted at'], ['heardAbout', 'How they heard'], ['license', 'License status'], ['source', 'Source'], ['imported', 'Imported sign-in'], ['fromAttendee', 'Signed in at an event']];
export function attendancePeopleRows(people) {
  const selected = fields.filter(([field], index) => index < 7 || people.some(person => Object.hasOwn(person, field)));
  return [selected.map(([, label]) => label), ...people.map(person => selected.map(([field]) => {
    const value = person[field];
    return value === null || value === undefined ? '' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : field === 'office' ? offices[value] ?? value : String(value);
  }))];
}
export const attendancePeopleCsv = people => tableCsv(attendancePeopleRows(people));
export const attendancePeopleWorkbook = people => tableWorkbook(attendancePeopleRows(people), 'Event Attendance');
