const validId = value => /^[1-9]\d{0,19}$/.test(String(value ?? ''));
const invalid = () => Object.assign(new Error('HubSpot note associations are incomplete.'), { code: 'HUBSPOT_ASSOCIATIONS_INCOMPLETE' });
// HubSpot's v4 batch read lists a note that has no associations of the requested type as an OBJECT_NOT_FOUND /
// NO_ASSOCIATIONS_FOUND error (HTTP 207) instead of an empty row. Those notes are left out of the results, so they are
// read again one at a time below; any other error, or one naming a note that did come back, is still refused.
const noAssociations = (error, requested, returned) => {
  if (error?.category !== 'OBJECT_NOT_FOUND' && !/NO_ASSOCIATIONS_FOUND/.test(String(error?.subCategory ?? ''))) return false;
  // The error must name its note (context.fromObjectId, or "… associated with note 123." in the message).
  const from = error?.context?.fromObjectId;
  const named = /associated with \w+ ([1-9]\d{0,19})\.?$/.exec(String(error?.message ?? ''));
  const ids = (Array.isArray(from) ? from : from === undefined || from === null ? named ? [named[1]] : [] : [from]).map(String);
  return ids.length > 0 && ids.every(id => requested.has(id) && !returned.has(id));
};
const cursorOf = payload => {
  const value = payload.paging?.next?.after;
  if (value === undefined || value === null || value === '') return null;
  let cursor; try { cursor = decodeURIComponent(String(value)); } catch { throw invalid(); }
  if (!cursor || cursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(cursor)) throw invalid();
  return cursor;
};
/** Batch omissions are verified individually; row continuations never silently lose associations. */
export async function completeNoteLinks(ids, payload, readPage) {
  if (!Array.isArray(payload?.results) || payload.status && payload.status !== 'COMPLETE') throw invalid();
  const requested = new Set(ids.map(String)), returned = new Set(payload.results.map(row => String(row?.from?.id ?? '')));
  const errors = payload.errors ?? [];
  if (!Array.isArray(errors) || !errors.every(error => noAssociations(error, requested, returned)) || (payload.numErrors ?? 0) !== errors.length) throw invalid();
  const links = new Map(ids.map(id => [id, []])), seen = new Set(), pending = new Map(ids.map(id => [id, null]));
  const add = (from, targets) => {
    if (!Array.isArray(targets)) throw invalid();
    for (const target of targets) {
      const id = String(target?.toObjectId ?? '');
      if (!validId(id)) throw invalid();
      if (!links.get(from).includes(id)) links.get(from).push(id);
    }
  };
  for (const row of payload.results) {
    const from = String(row.from?.id ?? '');
    if (!links.has(from) || seen.has(from)) throw invalid();
    seen.add(from); add(from, row.to);
    const next = cursorOf(row);
    if (next) pending.set(from, next); else pending.delete(from);
  }
  for (const [from, initial] of pending) {
    let after = initial; const cursors = new Set();
    do {
      const page = await readPage(from, after);
      if (!Array.isArray(page?.results) || page.errors?.length || page.numErrors > 0 || page.status && page.status !== 'COMPLETE') throw invalid();
      add(from, page.results);
      const next = cursorOf(page);
      if (next && (cursors.has(next) || next === after || !page.results.length)) throw invalid();
      if (next) cursors.add(next);
      after = next;
    } while (after !== null);
  }
  return links;
}
