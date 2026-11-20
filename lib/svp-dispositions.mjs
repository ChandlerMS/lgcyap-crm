import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { isAllowedOrigin } from './hubspot.mjs';

export const DISPOSITION_COLUMNS = ['Date (Interaction Start)', 'Agent', 'Number', 'State', 'Disposition', 'Disposition Notes', 'Call Recording', 'Auto Summary URL', 'Call Result', 'Start Time', 'Interaction Time', 'KPI Talk Time', 'KPI Handle Time', 'KPI Wrap Time', 'Hold Time'];
const ATTRIBUTES = { agent: 1, state: 3, disposition: 4, result: 8 };
const TEXT = { number: 2, notes: 5, recording: 6, summary: 7, startTime: 9 };
const DURATIONS = { interaction: 10, talk: 11, handle: 12, wrap: 13, hold: 14 };
const PAGE_SIZE = 50;
const keyBytes = key => { const bytes = Buffer.from(key ?? '', 'base64'); if (bytes.length !== 32) throw new Error('Snapshot key unavailable'); return bytes; };

/** The only tracked data is authenticated ciphertext. The key stays in production configuration. */
export function sealSnapshot(snapshot, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  const data = Buffer.concat([cipher.update(gzipSync(JSON.stringify(snapshot))), cipher.final()]);
  return Buffer.concat([Buffer.from('SVPD1'), iv, cipher.getAuthTag(), data]);
}
export function openSnapshot(bytes, key) {
  if (bytes.subarray(0, 5).toString() !== 'SVPD1') throw new Error('Invalid snapshot');
  const cipher = createDecipheriv('aes-256-gcm', keyBytes(key), bytes.subarray(5, 17));
  cipher.setAuthTag(bytes.subarray(17, 33));
  const data = JSON.parse(gunzipSync(Buffer.concat([cipher.update(bytes.subarray(33)), cipher.final()]), { maxOutputLength: 100_000_000 }).toString());
  if (data.version !== 1 || !Array.isArray(data.rows) || data.rows.some(row => !Array.isArray(row) || row.length !== 15 || row.some(value => typeof value !== 'string'))) throw new Error('Invalid snapshot');
  return data;
}

export function parseDuration(value) {
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/g)];
  if (!parts.length || text.replace(/\d+(?:\.\d+)?\s*[hms]/g, '').trim()) return null;
  return parts.reduce((sum, [, n, unit]) => sum + Number(n) * ({ h: 3600, m: 60, s: 1 }[unit]), 0);
}
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function validateDispositionQuery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid query');
  const known = new Set(['from', 'to', 'query', 'page', 'sort', 'direction', 'duration', 'export', ...Object.keys(ATTRIBUTES), ...Object.keys(TEXT)]);
  if (Object.keys(input).some(key => !known.has(key))) throw new Error('Unknown filter');
  const result = { page: 1, sort: 'date', direction: 'desc', duration: {} };
  for (const field of ['from', 'to']) if (input[field]) { if (!validDate(input[field])) throw new Error('Invalid date'); result[field] = input[field]; }
  if (result.from && result.to && result.from > result.to) throw new Error('Reversed dates');
  for (const field of ['query', ...Object.keys(ATTRIBUTES), ...Object.keys(TEXT)]) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== 'string' || input[field].length > 500) throw new Error('Invalid filter');
    result[field] = input[field].trim();
  }
  if (input.page !== undefined) { if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 1_000_000) throw new Error('Invalid page'); result.page = input.page; }
  if (input.sort !== undefined) { if (!['date', ...Object.keys(ATTRIBUTES), ...Object.keys(TEXT), ...Object.keys(DURATIONS)].includes(input.sort)) throw new Error('Invalid sort'); result.sort = input.sort; }
  if (input.direction !== undefined) { if (!['asc', 'desc'].includes(input.direction)) throw new Error('Invalid sort'); result.direction = input.direction; }
  if (input.export !== undefined && typeof input.export !== 'boolean') throw new Error('Invalid export');
  result.export = input.export === true;
  if (input.duration !== undefined) {
    if (!input.duration || typeof input.duration !== 'object' || Array.isArray(input.duration)) throw new Error('Invalid duration');
    for (const [field, range] of Object.entries(input.duration)) {
      if (!Object.hasOwn(DURATIONS, field) || !range || typeof range !== 'object' || Array.isArray(range) || Object.keys(range).some(key => !['min', 'max'].includes(key))) throw new Error('Invalid duration');
      for (const value of Object.values(range)) if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid duration');
      if (range.min !== undefined && range.max !== undefined && range.min > range.max) throw new Error('Reversed duration');
      if (Object.keys(range).length) result.duration[field] = range;
    }
  }
  return result;
}

function selectedRows(snapshot, input) {
  const textFilters = Object.entries(TEXT).filter(([field]) => input[field]).map(([field, column]) => [column, input[field].toLowerCase()]);
  const attributes = Object.entries(ATTRIBUTES).filter(([field]) => input[field]);
  const ranges = Object.entries(input.duration ?? {});
  const query = (input.query ?? '').toLowerCase();
  const rows = snapshot.rows.filter(row => {
    if ((input.from && row[0] < input.from) || (input.to && row[0] > input.to)) return false;
    if (attributes.some(([field, column]) => row[column] !== input[field])) return false;
    if (textFilters.some(([column, text]) => !row[column].toLowerCase().includes(text))) return false;
    if (query && !row.some(value => value.toLowerCase().includes(query))) return false;
    return ranges.every(([field, range]) => {
      const seconds = parseDuration(row[DURATIONS[field]]);
      return seconds !== null && (range.min === undefined || seconds >= range.min) && (range.max === undefined || seconds <= range.max);
    });
  });
  const column = ({ date: 0, ...ATTRIBUTES, ...TEXT, ...DURATIONS })[input.sort];
  const numeric = Object.hasOwn(DURATIONS, input.sort), sign = input.direction === 'asc' ? 1 : -1;
  rows.sort((a, b) => sign * (numeric ? (parseDuration(a[column]) ?? -1) - (parseDuration(b[column]) ?? -1) : (a[column].localeCompare(b[column]) || (column === 0 ? a[9].localeCompare(b[9]) : 0))));
  return rows;
}
export function queryDispositions(snapshot, input) {
  const rows = selectedRows(snapshot, input), counts = new Map();
  for (const row of rows) counts.set(row[4] || '(Blank)', (counts.get(row[4] || '(Blank)') ?? 0) + 1);
  const dates = snapshot.rows.map(row => row[0]).sort();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), page = Math.min(input.page, pages);
  return {
    source: snapshot.source, importedAt: snapshot.importedAt, appliedFilters: snapshot.appliedFilters,
    columns: DISPOSITION_COLUMNS, total: rows.length, snapshotTotal: snapshot.rows.length,
    from: dates[0], to: dates.at(-1), page, pages, pageSize: PAGE_SIZE,
    facets: Object.fromEntries(Object.entries(ATTRIBUTES).map(([key, column]) => [key, [...new Set(snapshot.rows.map(row => row[column]))].sort()])),
    dispositions: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    agents: new Set(rows.map(row => row[1]).filter(name => name && name !== 'N/A')).size,
    averageInteraction: rows.length ? rows.reduce((sum, row) => sum + (parseDuration(row[10]) ?? 0), 0) / rows.length : null,
    rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function dispositionCsv(rows, header = true) {
  return [...(header ? [DISPOSITION_COLUMNS] : []), ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export async function handleDispositionRequest(request, { getUser, authorize, allowedOrigin, readSnapshot }) {
  const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Use POST to load dispositions.' }, 405);
  try {
    const user = await getUser();
    if (!user) return json({ error: 'Sign in to view call dispositions.' }, 401);
    if (!authorize(user) || !isAllowedOrigin(request, allowedOrigin)) return json({ error: 'Access denied.' }, 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'Use a JSON request.' }, 415);
    let input;
    try {
      const reader = request.body?.getReader(), decoder = new TextDecoder(); let size = 0, body = '';
      if (reader) while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { await reader.cancel(); return json({ error: 'Request too large.' }, 413); } body += decoder.decode(value, { stream: true }); }
      body += decoder.decode();
      input = validateDispositionQuery(JSON.parse(body));
    } catch { return json({ error: 'Choose valid filters and date ranges.' }, 400); }
    const snapshot = await readSnapshot();
    if (input.export) {
      const rows = selectedRows(snapshot, input), encoder = new TextEncoder(); let offset = 0;
      // Stream large exports instead of exceeding Vercel's buffered response limit.
      const stream = new ReadableStream({ pull(controller) {
        if (!offset) controller.enqueue(encoder.encode('\uFEFF' + dispositionCsv([], true)));
        const chunk = rows.slice(offset, offset + 500); offset += 500;
        if (chunk.length) controller.enqueue(encoder.encode(dispositionCsv(chunk, false)));
        if (offset >= rows.length) controller.close();
      } });
      return new Response(stream, { headers: { ...HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="standard-vs-preferred-dispositions.csv"' } });
    }
    return json(queryDispositions(snapshot, input));
  } catch { return json({ error: 'Call dispositions could not be loaded. Please try again.' }, 503); }
}
