import { timingSafeEqual } from 'node:crypto';
import { parsePolicytekCapture, savePolicytekSnapshot, policytekSyncPlan } from './policytek.mjs';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

/** Dedicated aggregate-only publisher credential; has no HubSpot or general database access. */
export async function handlePolicytekSync(request, { secret, getDb, now = Date.now() }) {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) return json({ error: 'Sync is not configured.' }, 503);
  const actual = request.headers.get('Authorization') ?? '', expected = `Bearer ${secret}`;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return json({ error: 'Unauthorized.' }, 401);
  if (request.headers.has('Origin')) return json({ error: 'Browser publishing is not allowed.' }, 403);
  try {
    if (request.method === 'GET') return json({ jobs: await policytekSyncPlan(await getDb(), now) });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return json({ error: 'JSON required.' }, 415);
    const reader = request.body?.getReader(); if (!reader) return json({ error: 'Capture required.' }, 400);
    let size = 0, text = ''; const decoder = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 3 * 1024 * 1024) { await reader.cancel(); return json({ error: 'Capture too large.' }, 413); } text += decoder.decode(value, { stream: true }); }
    text += decoder.decode(); let snapshot;
    try { snapshot = parsePolicytekCapture(JSON.parse(text), now); } catch { return json({ error: 'Invalid report capture. Last successful data retained.' }, 400); }
    const saved = await savePolicytekSnapshot(await getDb(), snapshot);
    return json({ saved, board: snapshot.board, startDate: snapshot.startDate, endDate: snapshot.endDate, capturedAt: snapshot.capturedAt, namedRows: snapshot.rows.length, partial: snapshot.partial, reportTotals: snapshot.reportTotals });
  } catch { return json({ error: 'Sync unavailable. Last successful data retained.' }, 503); }
}
