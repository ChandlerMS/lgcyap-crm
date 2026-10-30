export const RECRUITING_TIME_ZONE = 'America/New_York';
export const RECRUITING_PERIODS = Object.freeze([
  { value: 'today', label: 'Today' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'date', label: 'Specific date' },
  { value: 'range', label: 'Date range' },
]);

const calendarFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: RECRUITING_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const displayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
});

function calendarDate(year, month, day) {
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}
function dateKey(date) {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function parseDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = calendarDate(year, month, day);
  return dateKey(date) === value ? date : null;
}
function shiftDate(value, days) {
  const date = parseDateKey(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

/** Convert an instant to its agency calendar date; never use the browser's timezone. */
export function recruitingCalendarDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return parseDateKey(value) ? value : null;
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(calendarFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}

/** @param {Date | string | number} now */
export function defaultPeriodSelection(now = new Date()) {
  const today = recruitingCalendarDate(now);
  return { preset: 'today', startDate: today ?? '', endDate: today ?? '' };
}

/**
 * Inclusive calendar bounds. Comparing local dates makes 23/25-hour DST days safe.
 * @param {{preset: string, startDate?: string, endDate?: string}} selection
 * @param {Date | string | number} now
 */
export function resolveRecruitingPeriod(selection = defaultPeriodSelection(), now = new Date()) {
  const preset = selection?.preset;
  const definition = RECRUITING_PERIODS.find(period => period.value === preset);
  const today = recruitingCalendarDate(now);
  const invalid = message => ({ valid: false, preset, label: definition?.label ?? 'Date range', startDate: null, endDate: null, description: '', error: message });
  if (!definition) return invalid('Choose a reporting period.');
  if (!today) return invalid('The current date is unavailable. Refresh and try again.');
  const [year, month] = today.split('-').map(Number);
  let startDate = today;
  let endDate = today;
  if (preset === 'weekly') {
    const weekday = parseDateKey(today).getUTCDay();
    startDate = shiftDate(today, -(weekday === 0 ? 6 : weekday - 1));
    endDate = shiftDate(startDate, 6);
  } else if (preset === 'monthly') {
    startDate = dateKey(calendarDate(year, month, 1));
    endDate = dateKey(calendarDate(year, month + 1, 0));
  } else if (preset === 'quarterly') {
    const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
    startDate = dateKey(calendarDate(year, quarterMonth, 1));
    endDate = dateKey(calendarDate(year, quarterMonth + 3, 0));
  } else if (preset === 'yearly') {
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
  } else if (preset === 'date' || preset === 'range') {
    if (!parseDateKey(selection.startDate)) return invalid('Choose a valid start date.');
    startDate = selection.startDate;
    if (preset === 'range' && !parseDateKey(selection.endDate)) return invalid('Choose a valid end date.');
    endDate = preset === 'date' ? startDate : selection.endDate;
    if (startDate > endDate) return invalid('The end date must be on or after the start date.');
  }
  const display = value => displayFormatter.format(parseDateKey(value));
  return {
    valid: true, preset, label: definition.label, startDate, endDate, error: null,
    description: startDate === endDate ? display(startDate) : `${display(startDate)} – ${display(endDate)}`,
  };
}

export function recordsInRecruitingPeriod(records, period, basis = 'createdAt') {
  if (!['createdAt', 'enteredStageAt'].includes(basis)) throw new TypeError('Unsupported recruiting reporting date.');
  if (!period?.valid) return [];
  const unique = [...new Map(records.map(record => [record.id, record])).values()];
  return unique.filter(record => {
    const date = recruitingCalendarDate(record[basis]);
    return date != null && date >= period.startDate && date <= period.endDate;
  });
}

/** Current-stage distribution of a selected cohort; this is not historical stage throughput. */
export function recruitingPeriodStats(records, stages, period, basis = 'createdAt') {
  const selected = recordsInRecruitingPeriod(records, period, basis);
  const stageTotals = stages.map(stage => ({
    ...stage,
    count: selected.filter(record => stage.stageId ? record.stageId === stage.stageId : record.stageKey === (stage.key ?? stage.id)).length,
  }));
  const counted = stageTotals.reduce((total, stage) => total + stage.count, 0);
  const unique = [...new Map(records.map(record => [record.id, record])).values()];
  const contactedCount = selected.filter(record => recruitingCalendarDate(record.lastContactedAt) != null).length;
  return {
    records: selected, total: selected.length, stageTotals, contactedCount,
    contactedPercentage: selected.length ? Math.round(contactedCount / selected.length * 1000) / 10 : 0,
    unknownStageCount: selected.length - counted,
    missingDateCount: unique.filter(record => recruitingCalendarDate(record[basis]) == null).length,
  };
}
