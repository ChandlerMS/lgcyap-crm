import { ApplicationExportError } from './application-download.mjs';
export function signedInFilters(input = {}) {
  const { office = 'all', name = '', review = 'all', sort = 'original' } = input;
  if (typeof office !== 'string' || office.length > 100 || typeof name !== 'string' || name.length > 200 || !['all', 'approved', 'denied', 'pending'].includes(review) || !['original', 'name-asc', 'name-desc', 'office'].includes(sort)) throw new ApplicationExportError('Choose valid signed-in filters.');
  return { office, name, review, sort };
}
export function filterSignedIn(rows, filters, reviews = {}, reviewComplete = true) {
  const { office, name, review, sort } = signedInFilters(filters);
  const needle = name.trim().toLowerCase();
  const result = rows.filter(row => (office === 'all' || row.office === office) && (!needle || row.name.toLowerCase().includes(needle)) && (review === 'all' || (reviews[row.ticketId]?.status ?? (reviewComplete ? 'pending' : 'unknown')) === review));
  if (sort !== 'original') result.sort((a, b) => (sort === 'office' ? a.office.localeCompare(b.office) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * (sort === 'name-desc' ? -1 : 1)) || String(a.ticketId).localeCompare(String(b.ticketId)));
  return result;
}
