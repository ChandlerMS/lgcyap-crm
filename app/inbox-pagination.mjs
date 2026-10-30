/** Validate each response before committing rows or advancing its opaque cursor. */
export function mergeInboxPage(previous, result, input) {
  const key = input.threadId ? 'messages' : 'records';
  if (result?.tool !== 'inbox' || result.status !== 'available' || !Array.isArray(result[key])
    || result.archive !== input.archive || (input.threadId && result.selectedThreadId !== input.threadId)
    || typeof result.complete !== 'boolean' || !(result.continuation === null || typeof result.continuation === 'string' && result.continuation.length > 0)
    || result.complete && (result.continuation !== null || result.partial === true)) throw Error('Unexpected Inbox page. Refresh to restart.');
  const rows = new Map(previous.items.map(item => [item.id, item]));
  for (const item of result[key]) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 200) throw Error('Unexpected Inbox record. Refresh to restart.');
    rows.set(item.id, item);
  }
  if (result.continuation && result.continuation === previous.continuation) throw Error('HubSpot pagination did not advance. Refresh to restart.');
  return { items: [...rows.values()], continuation: result.continuation, complete: result.complete,
    notice: result.notice ?? '', fetchedAt: result.fetchedAt, pages: previous.pages + 1 };
}

export const emptyInboxPages = () => ({ items: [], continuation: null, complete: false, notice: '', pages: 0 });

/** Bounded run, unlimited resumable pages. No retry on failure; retain last committed page. */
export async function walkInboxPages({ initial, input, request, signal, onPage, maxPages = 100 }) {
  let state = initial;
  const seen = new Set(state.continuation ? [state.continuation] : []);
  for (let page = 0; page < maxPages && !state.complete; page++) {
    if (signal.aborted) return state;
    const result = await request({ ...input, ...(state.continuation ? { continuation: state.continuation } : {}) }, signal);
    if (signal.aborted) return state;
    const next = mergeInboxPage(state, result, input);
    if (next.continuation && seen.has(next.continuation)) throw Error('HubSpot pagination repeated. Refresh to restart.');
    if (next.continuation) seen.add(next.continuation);
    state = next; onPage(state);
    if (!state.continuation) break;
  }
  return state;
}
