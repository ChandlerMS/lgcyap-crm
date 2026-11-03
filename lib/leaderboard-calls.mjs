// Only aggregate counts leave this module. No customer or recording fields are requested.
export async function readLeaderboardCalls(bounds, { request, remaining, pause }) {
  const records = new Map(), cursors = new Set(); let after, expected = null, partial = false;
  for (let page = 0; page < 50; page++) {
    if (remaining() < 250) return { status: 'unavailable', total: null, byOwner: new Map(), partial: true };
    await pause(220);
    if (remaining() < 250) return { status: 'unavailable', total: null, byOwner: new Map(), partial: true };
    const payload = await request({ properties: ['hs_timestamp', 'hs_call_direction', 'hubspot_owner_id'], filterGroups: [{ filters: [
      { propertyName: 'hs_call_direction', operator: 'EQ', value: 'INBOUND' },
      { propertyName: 'hs_timestamp', operator: 'GTE', value: String(bounds.startMs) },
      { propertyName: 'hs_timestamp', operator: 'LT', value: String(bounds.endMs) },
    ] }], limit: 200, sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }], ...(after ? { after } : {}) });
    if (!payload || !Number.isSafeInteger(payload.total) || payload.total < 0 || !Array.isArray(payload.results) || payload.results.length > 200) throw new Error('Invalid call page');
    partial ||= payload.total > 10000 || (expected !== null && payload.total !== expected); expected = payload.total;
    for (const record of payload.results) {
      const p = record?.properties, time = typeof p?.hs_timestamp === 'string' && /^\d+$/.test(p.hs_timestamp) ? Number(p.hs_timestamp) : Date.parse(p?.hs_timestamp);
      if (!record || typeof record.id !== 'string' || !/^[1-9]\d{0,29}$/.test(record.id) || record.archived || p?.hs_call_direction !== 'INBOUND' || !Number.isFinite(time) || time < bounds.startMs || time >= bounds.endMs) throw new Error('Invalid call record');
      if (records.has(record.id)) partial = true;
      records.set(record.id, p.hubspot_owner_id);
    }
    if (!payload.paging?.next) { partial ||= records.size !== expected; break; }
    const cursor = String(payload.paging.next.after);
    if (!/^[1-9]\d{0,4}$/.test(cursor) || cursors.has(cursor) || !payload.results.length) throw new Error('Invalid call cursor');
    if (Number(cursor) >= 10000 || page === 49) { partial = true; break; }
    cursors.add(cursor); after = cursor;
  }
  const byOwner = new Map();
  for (const owner of records.values()) if (typeof owner === 'string' && /^[1-9]\d{0,29}$/.test(owner)) byOwner.set(owner, (byOwner.get(owner) ?? 0) + 1);
  return { status: 'available', total: records.size, byOwner, partial };
}

/** Owner attribution is explicitly not an assertion that the owner is the writing agent. */
export function attachLeaderboardCalls(rows, deals, calls, dealsPartial) {
  const ownersByName = new Map(), namesByOwner = new Map();
  for (const { properties: p } of deals) {
    const name = (p.writing_agent_name ?? '').trim().normalize('NFC').replace(/\s+/g, ' '), owner = p.hubspot_owner_id;
    if (!name) continue;
    if (!ownersByName.has(name)) ownersByName.set(name, new Set());
    ownersByName.get(name).add(owner || null);
    if (owner) { if (!namesByOwner.has(owner)) namesByOwner.set(owner, new Set()); namesByOwner.get(owner).add(name); }
  }
  const complete = calls.status === 'available' && !calls.partial && !dealsPartial;
  return rows.map(row => {
    const owners = ownersByName.get(row.name), owner = owners?.size === 1 ? [...owners][0] : null;
    const count = complete && owner && namesByOwner.get(owner)?.size === 1 ? calls.byOwner.get(owner) ?? 0 : null;
    return { ...row, inboundCalls: count, soldPerInboundLog: count > 0 ? row.sales / count : null };
  });
}
