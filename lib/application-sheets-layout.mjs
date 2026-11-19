const TIME_ZONE = 'America/New_York';
const parts = now => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
export function easternSyncTime(now) {
  const p = parts(now);
  return { day: `${p.year}-${p.month}-${p.day}`, daily: Number(p.hour) >= 9 };
}
const text = value => String(value ?? '');
const FIXED = ['Application ID', 'Submitted (Eastern)', 'Name', 'Preferred name', 'Email', 'Phone', 'Office', 'City', 'State', 'ZIP', 'License status', 'Earliest start', 'Heard about us', 'Referred by', 'Requirements met', 'Missed requirements', 'Private review flags', 'Application outcome', 'Photo ID attached', 'Recruiting stage', 'HubSpot ticket', 'HubSpot contact'];
const questionKey = (section, row) => JSON.stringify([section.title, row.label]);

/** Complete deterministic, oldest-first snapshots. Applicant strings remain strings, never formulas. */
export function buildApplicationWorkbooks(report, now = new Date(), managedMonths = []) {
  if (report?.partial !== false || !Array.isArray(report.applications)) throw new Error('Refusing partial application data.');
  const groups = new Map([[easternSyncTime(now).day.slice(0, 7), []]]), ids = new Set();
  for (const month of managedMonths) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid managed month.');
    if (!groups.has(month)) groups.set(month, []);
  }
  for (const application of report.applications) {
    if (!/^\d+$/.test(application.id) || ids.has(application.id)) throw new Error('Invalid or duplicate application ID.');
    ids.add(application.id);
    const at = new Date(application.at);
    if (!Number.isFinite(at.getTime())) throw new Error('Invalid application date.');
    const day = easternSyncTime(at).day, month = day.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push({ ...application, day });
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([month, applications]) => {
    applications.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id, 'en', { numeric: true }));
    const questions = new Map();
    for (const application of applications) for (const section of application.sections ?? []) for (const row of section.rows) questions.set(questionKey(section, row), `${section.title} — ${row.label}`);
    const keys = [...questions.keys()].sort();
    const headers = [...FIXED, ...keys.map(key => questions.get(key))];
    const [year, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate(), tabs = [];
    for (let start = 1; start <= last;) {
      const weekday = new Date(Date.UTC(year, m - 1, start)).getUTCDay();
      const end = Math.min(last, start + (7 - weekday) % 7);
      const rows = applications.filter(application => { const d = Number(application.day.slice(8)); return d >= start && d <= end; }).map(application => {
        const a = application, answers = new Map();
        for (const section of a.sections ?? []) for (const row of section.rows) {
          const key = questionKey(section, row);
          answers.set(key, [answers.get(key), text(row.value)].filter(Boolean).join('\n'));
        }
        const p = parts(new Date(a.at));
        return [a.id, `${a.day} ${p.hour}:${p.minute} ET`, a.name, a.preferredName, a.email, a.phone, a.office, a.city, a.state, a.zip, a.license, a.startDate, a.heardAbout, a.referredBy,
          a.requirementsMet === true ? 'Yes' : a.requirementsMet === false ? 'No' : 'Unknown', (a.missed ?? []).join('; '), (a.flags ?? []).join('; '), a.outcomeText, a.photoId ? 'Yes' : 'No', a.ticket?.stage, a.ticket?.url, a.contact?.url, ...keys.map(key => answers.get(key))].map(text);
      });
      // Google limits one cell to 50,000 characters. Refuse rather than silently lose answers.
      if (rows.some(row => row.some(cell => cell.length > 50_000))) throw new Error('Application answer exceeds the Google Sheets cell limit.');
      tabs.push({ title: `Week ${tabs.length + 1} (${String(start).padStart(2, '0')}-${String(end).padStart(2, '0')})`, values: [headers, ...rows] });
      start = end + 1;
    }
    return { month, title: `${month.slice(5)}-${month.slice(2, 4)} Applications`, tabs };
  });
}
