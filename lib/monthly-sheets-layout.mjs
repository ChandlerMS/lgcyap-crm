import { easternSyncTime } from './application-sheets-layout.mjs';
/** Calendar groups shared by native application and sign-in reports. */
export function calendarWeeks(month) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid report month.');
  const [year, m] = month.split('-').map(Number), last = new Date(Date.UTC(year, m, 0)).getUTCDate(), weeks = [];
  for (let start = 1; start <= last;) {
    const end = Math.min(last, start + (7 - new Date(Date.UTC(year, m - 1, start)).getUTCDay()) % 7);
    weeks.push({ start, end, title: `Week ${weeks.length + 1} (${String(start).padStart(2, '0')}-${String(end).padStart(2, '0')})` });
    start = end + 1;
  }
  return weeks;
}
export function monthlyRecords(records, now, managedMonths = []) {
  const groups = new Map(), seen = new Set();
  for (const month of [easternSyncTime(now).day.slice(0, 7), ...managedMonths]) { calendarWeeks(month); groups.set(month, []); }
  for (const record of records) {
    if (!/^[1-9]\d*$/.test(record.id ?? '') || seen.has(record.id)) throw new Error('Invalid or duplicate report record ID.');
    const at = new Date(record.at);
    if (!Number.isFinite(at.getTime())) throw new Error('Invalid report date.');
    seen.add(record.id);
    const day = easternSyncTime(at).day, month = day.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push({ ...record, day });
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([month, values]) => [month, values.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id, 'en', { numeric: true }))]);
}
export function reportCell(value) {
  const text = String(value ?? '');
  if (text.length > 50000) throw new Error('Report value exceeds the Google Sheets cell limit.');
  return text;
}
