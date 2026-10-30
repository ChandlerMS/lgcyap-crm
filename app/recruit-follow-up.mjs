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
