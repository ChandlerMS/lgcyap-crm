export const QUEUE_TV_BOARDS = Object.freeze({ shopper: 'Shopper', standard: 'Standard vs Preferred' });

/** Cycle a bounded roster without losing entries when the live roster changes size.
 * @template T
 * @param {T[]} rows
 * @param {number} turn
 * @param {number} size
 */
export function queueTvPage(rows = [], turn = 0, size = 6) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.max(0, Math.floor(turn)) % pages;
  return { rows: rows.slice(page * size, (page + 1) * size), page: page + 1, pages };
}
