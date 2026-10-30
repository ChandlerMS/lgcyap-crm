const fields = new Set(['name', 'phone', 'email', 'recruiter', 'stage', 'timeInStage', 'lastContactedAt']);
const collator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

export function sortRecruitRows(records, sort = { field: 'name', direction: 'asc' }) {
  if (!fields.has(sort.field) || !['asc', 'desc'].includes(sort.direction)) return [...records];
  const valueOf = record => {
    if (['timeInStage', 'lastContactedAt'].includes(sort.field)) {
      const raw = record[sort.field === 'timeInStage' ? 'enteredStageAt' : sort.field];
      const instant = typeof raw === 'string' && raw ? Date.parse(raw) : NaN;
      return Number.isFinite(instant) ? instant * (sort.field === 'timeInStage' ? -1 : 1) : null;
    }
    const value = record[sort.field];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  return records.map((record, index) => ({ record, index, value: valueOf(record) })).sort((a, b) => {
    if (a.value === null || b.value === null) return a.value === null && b.value === null ? a.index - b.index : a.value === null ? 1 : -1;
    const compared = typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : collator.compare(a.value, b.value);
    return compared ? compared * (sort.direction === 'asc' ? 1 : -1) : a.index - b.index;
  }).map(item => item.record);
}
