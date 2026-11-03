const DAY = 86_400_000;
export function followUpRecruits(records, now) {
  if (!Number.isFinite(now) || now <= 0) return [];
  return [...new Map(records.map(record => [record.id, record])).values()].flatMap(record => {
    const neverContacted = !record.lastContactedAt;
    const since = Date.parse(neverContacted ? record.createdAt ?? "" : record.lastContactedAt);
    if (!Number.isFinite(since) || now - since <= 15 * DAY) return [];
    return [{ ...record, neverContacted, followUpSince: since, daysWaiting: Math.floor((now - since) / DAY) }];
  }).sort((a, b) => a.followUpSince - b.followUpSince || String(a.id).localeCompare(String(b.id)));
}
// How many name chips fit in `lines` wrapped rows, leaving room for a trailing "+N more" chip whenever any of `total` are left out.
export function fitFollowUpChips(widths, moreWidth, width, gap, lines, total = widths.length) {
  const rowsUsed = items => items.reduce(([rows, x], w) => x && x + gap + w > width ? [rows + 1, w] : [rows, x ? x + gap + w : w], [1, 0])[0];
  if (total <= widths.length && rowsUsed(widths) <= lines) return widths.length;
  for (let count = Math.min(widths.length, total - 1); count > 0; count--) if (rowsUsed([...widths.slice(0, count), moreWidth]) <= lines) return count;
  return 0;
}
