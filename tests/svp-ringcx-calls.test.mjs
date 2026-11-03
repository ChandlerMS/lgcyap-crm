import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { RingCxError } from '../lib/ringcx.mjs';
import { applySvpCalls, importSvpCallsReports, parseSvpCallsReport, readSvpCalls } from '../lib/svp-calls.mjs';
import { openSvpReport, readSvpRingcxStatus, SVP_REPORT_FIRST_DATE, svpReportDays, svpReportExecution, svpReportLoadedAt, svpReportRows, syncSvpRingcxCalls } from '../lib/svp-ringcx-calls.mjs';

const schemas = await Promise.all(['0007_svp_calls.sql', '0008_svp_ringcx_calls.sql', '0009_svp_ringcx_report.sql'].map(file => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')));
const at = value => Date.parse(value);
const FIVE_MINUTES = 300000, NOW = at('2026-11-03T22:00:00Z');
const database = async () => { const db = new PGlite(); for (const schema of schemas) { await db.exec(schema); await db.exec(schema); } return db; };

const PID = 'fxvsv9l0lmfwew3feu8jhuf80qidzfyg', obj = number => `/gdc/md/${PID}/obj/${number}`;
const element = (number, id) => `${obj(number)}/elements?id=${id}`;
// The report's saved definition as RingCX returned it on 2026-11-03.
const SAVED = {
  filters: [
    { relativeDateFilter: { from: 0, granularity: 'GDC.time.date', dataSet: { uri: obj(2044) }, to: 0 } },
    { positiveAttributeFilter: { displayForm: { uri: obj(7090) }, in: [element(7089, 332)] } },
    { negativeAttributeFilter: { displayForm: { uri: obj(7110) }, notIn: [] } },
    { positiveAttributeFilter: { in: [element(7020, 1001932)], displayForm: { uri: obj(7021) } } },
    { positiveAttributeFilter: { in: [element(7095, 207)], displayForm: { uri: obj(7096) } } },
    { negativeAttributeFilter: { displayForm: { uri: obj(7074) }, notIn: [] } },
    { negativeAttributeFilter: { displayForm: { uri: obj(7185) }, notIn: [element(7184, 73), element(7184, 120119), element(7184, 1)] } },
    { negativeAttributeFilter: { displayForm: { uri: obj(4472) }, notIn: [] } },
  ],
  buckets: [
    { localIdentifier: 'measures', items: [
      { measure: { definition: { measureDefinition: { filters: [{ positiveAttributeFilter: { in: [element(7073, 118255)], displayForm: { uri: obj(7074) } } }], item: { uri: obj(7639) } } }, localIdentifier: 'sold-id', title: 'Interactions (Agent Disposition: Sold)', alias: 'Sold' } },
      { measure: { localIdentifier: 'calls-id', title: 'Interactions', alias: 'Calls', definition: { measureDefinition: { item: { uri: obj(7639) } } } } },
      { measure: { format: '#,##0.00%', localIdentifier: 'rate-id', alias: 'Close Rate', definition: { arithmeticMeasure: { measureIdentifiers: ['sold-id', 'calls-id'], operator: 'ratio' } } } },
    ] },
    { localIdentifier: 'attribute', items: [{ visualizationAttribute: { displayForm: { uri: obj(4455) }, localIdentifier: 'agent-id' } }] },
  ],
};
const RESOLVED = { dateSet: obj(2044), dateLabel: obj(2035) };

test('the execution keeps the saved filters and measures, replaces only the date, and groups by day and agent', () => {
  const { execution: { afm, resultSpec } } = svpReportExecution(SAVED, RESOLVED, '2026-10-27', '2026-11-03');
  assert.deepEqual(afm.measures, [
    { localIdentifier: 'sold-id', alias: 'Sold', definition: { measure: { filters: [{ positiveAttributeFilter: { in: [element(7073, 118255)], displayForm: { uri: obj(7074) } } }], item: { uri: obj(7639) } } } },
    { localIdentifier: 'calls-id', alias: 'Calls', definition: { measure: { item: { uri: obj(7639) } } } },
  ]);
  assert.deepEqual(afm.attributes, [{ displayForm: { uri: obj(2035) }, localIdentifier: 'date' }, { displayForm: { uri: obj(4455) }, localIdentifier: 'agent' }]);
  assert.deepEqual(afm.filters[0], { absoluteDateFilter: { dataSet: { uri: obj(2044) }, from: '2026-10-27', to: '2026-11-03' } });
  assert.deepEqual(afm.filters.slice(1), [SAVED.filters[1], SAVED.filters[3], SAVED.filters[4], SAVED.filters[6]], 'negative filters with nothing excluded are dropped');
  assert.deepEqual(resultSpec.dimensions, [{ itemIdentifiers: ['date', 'agent'] }, { itemIdentifiers: ['measureGroup'] }]);

  const edited = change => { const copy = structuredClone(SAVED); change(copy); return () => svpReportExecution(copy, RESOLVED, 'a', 'b'); };
  assert.throws(edited(copy => { copy.buckets[0].items[1].measure.alias = 'Answered'; }), error => error.code === 'REPORT_CHANGED' && /"Calls"/.test(error.detail));
  assert.throws(edited(copy => { copy.buckets[1].items.push(copy.buckets[1].items[0]); }), error => error.code === 'REPORT_CHANGED' && /found 2/.test(error.detail));
  assert.throws(edited(copy => { copy.filters.shift(); }), error => error.code === 'REPORT_CHANGED');
  assert.throws(edited(copy => { copy.filters[0].relativeDateFilter.dataSet.uri = obj(1); }), error => error.code === 'REPORT_CHANGED');
});

const resultPage = (rows, { offset = 0, total = rows.length } = {}) => ({
  headerItems: [[rows.map(row => ({ attributeHeaderItem: { name: row[0], uri: 'd' } })), rows.map(row => ({ attributeHeaderItem: { name: row[1], uri: 'a' } }))], [[{ measureHeaderItem: { name: 'Sold', order: 0 } }, { measureHeaderItem: { name: 'Calls', order: 1 } }]]],
  data: rows.map(row => [row[3] ?? null, row[2] ?? null]),
  paging: { count: [rows.length, 2], offset: [offset, 0], total: [total, 2] },
});

test('result rows read measures by name, count a blank as none, and reject anything unexpected', () => {
  assert.deepEqual(svpReportRows(resultPage([['2026-11-02', 'Agent One', '12', 3], ['2026-11-02', 'Agent Two', 4, null]])), [{ date: '2026-11-02', name: 'Agent One', calls: 12, sold: 3 }, { date: '2026-11-02', name: 'Agent Two', calls: 4, sold: 0 }]);
  assert.deepEqual(svpReportRows(resultPage([])), []);
  const bad = page => assert.throws(() => svpReportRows(page), error => error.code === 'INVALID_REPORT_RESPONSE' && !/Private/.test(error.detail));
  bad({});
  bad(resultPage([['11/02/2026', 'Private Person', 1, 0]]));
  bad(resultPage([['2026-11-02', 'Private Person', 1.5, 0]]));
  bad(resultPage([['2026-11-02', 'Private Person', -1, 0]]));
  bad({ ...resultPage([]), headerItems: [[[], []], [[{ measureHeaderItem: { name: 'Calls' } }]]] });
});

test('rows fold into one per agent per day under HubSpot spelling; empty names and empty rows are skipped', () => {
  assert.deepEqual(svpReportDays([
    { date: '2026-11-02', name: 'Agent One', calls: 2, sold: 1 },
    { date: '2026-11-02', name: ' agent  one ', calls: 3, sold: 0 },
    { date: '2026-11-03', name: 'Agent One', calls: 1, sold: 0 },
    { date: '2026-11-02', name: 'Julian Parker Gillion', calls: 4, sold: 0 },
    { date: '2026-11-02', name: 'Jose Luis Garcia', calls: 5, sold: 0 },
    { date: '2026-11-02', name: 'Walter (Noah) Korfant', calls: 6, sold: 1 },
    { date: '2026-11-02', name: 'Idle Agent', calls: 0, sold: 0 },
    { date: '2026-11-02', name: '  ', calls: 9, sold: 0 },
    { date: '2026-11-02', name: 'x'.repeat(201), calls: 9, sold: 0 },
  ]), [
    { date: '2026-11-02', key: 'agent one', name: 'Agent One', calls: 5, sold: 1 },
    { date: '2026-11-03', key: 'agent one', name: 'Agent One', calls: 1, sold: 0 },
    { date: '2026-11-02', key: 'julian gillion', name: 'Julian Parker Gillion', calls: 4, sold: 0 },
    { date: '2026-11-02', key: 'luis garcia', name: 'Jose Luis Garcia', calls: 5, sold: 0 },
    { date: '2026-11-02', key: 'walter noah korfant', name: 'Walter (Noah) Korfant', calls: 6, sold: 1 },
  ]);
});

test('last load time reads RingCX format, with or without the leading zero', () => {
  assert.equal(svpReportLoadedAt('11032026175927'), '2026-11-03 17:59:27');
  assert.equal(svpReportLoadedAt(1032027090000), '2027-01-03 09:00:00');
  for (const value of [null, undefined, '', 'soon']) assert.equal(svpReportLoadedAt(value), null);
});

const CLAIMS = 'claims-secret', ORIGIN = 'https://us1-prod.analytics.engage.ringcentral.com';
const SESSION = { clientId: 'client-1', claims: CLAIMS, provider: 'sso', domain: ORIGIN };
const cookie = (name, value) => ({ 'Set-Cookie': `${name}=${value}; Path=/gdc; Secure; HttpOnly` });
/** RingCX's analytics host: `pages` answers each result request, `routes` overrides any path. */
const fakeAnalytics = ({ pages = [resultPage([['2026-11-03', 'Agent One', 4, 1]])], routes = {}, saved = SAVED, updated = '2026-11-03 23:51:48' } = {}) => {
  const requests = [];
  const queue = [...pages];
  const defaults = {
    '/gdc/account/customerlogin': () => new Response('{}', { headers: cookie('GDCAuthSST', 'long') }),
    '/gdc/account/token': () => new Response('{}', { headers: cookie('GDCAuthTT', 'short') }),
    [`/gdc/md/${PID}/identifiers`]: () => Response.json({ identifiers: [['aaB7aXOESEiB', obj(1997754)], ['callstartdate.dataset.dt', obj(2044)], ['callstartdate.date.day.yyyy_mm_dd', obj(2035)], ['aaD16BZbLrKz', obj(7638)]].map(([identifier, uri]) => ({ identifier, uri })) }),
    [obj(1997754)]: () => Response.json({ visualizationObject: { meta: { updated }, content: saved } }),
    [`/gdc/app/projects/${PID}/executeAfm`]: init => Response.json({ executionResponse: { links: { executionResult: `/gdc/app/projects/${PID}/executionResults/${JSON.parse(init.body).execution.afm.attributes ? 'rows' : 'loaded'}?c=abc&q=x%2By&offset=0,0&limit=2,1000&dimensions=2&totals=0,0` } } }, { status: 201 }),
    [`/gdc/app/projects/${PID}/executionResults/loaded`]: () => Response.json({ executionResult: { data: ['11032026175927'], headerItems: [], paging: { count: [1], offset: [0], total: [1] } } }),
    [`/gdc/app/projects/${PID}/executionResults/rows`]: () => { const next = queue.shift(); return next instanceof Response ? next : Response.json({ executionResult: next }); },
  };
  const fetch = async (url, init) => {
    requests.push({ url: new URL(url), init });
    const route = routes[new URL(url).pathname] ?? defaults[new URL(url).pathname];
    if (!route) throw new Error(`unexpected request ${url}`);
    return route(init);
  };
  return { fetch, requests, client: { analyticsSession: async () => SESSION } };
};

test('the report opens with the login cookies and reads every page by replacing the offset', async () => {
  const pages = [resultPage([['2026-11-02', 'Agent One', 1, 0], ['2026-11-02', 'Agent Two', 2, 0]], { total: 3 }), new Response(null, { status: 202 }), resultPage([['2026-11-03', 'Agent One', 3, 1]], { offset: 2, total: 3 })];
  const { fetch, requests, client } = fakeAnalytics({ pages });
  const report = await openSvpReport(client, { fetch, pollMs: 1 });
  assert.equal(report.version, '2026-11-03 23:51:48');
  assert.deepEqual(await report.read('2026-11-02', '2026-11-03'), [{ date: '2026-11-02', name: 'Agent One', calls: 1, sold: 0 }, { date: '2026-11-02', name: 'Agent Two', calls: 2, sold: 0 }, { date: '2026-11-03', name: 'Agent One', calls: 3, sold: 1 }]);
  assert.equal(await report.dataLoadedAt(), '2026-11-03 17:59:27');

  const login = requests.find(({ url }) => url.pathname.endsWith('/customerlogin'));
  assert.equal(login.url.origin, ORIGIN);
  assert.deepEqual(JSON.parse(login.init.body), { pgpLoginRequest: { targetUrl: '/gdc/app/account/bootstrap?projectUri=/gdc/projects/client:default:client-1', ssoProvider: 'sso', encryptedClaims: CLAIMS } });
  assert.equal(requests.find(({ url }) => url.pathname.endsWith('/token')).init.headers.Cookie, 'GDCAuthSST=long');
  assert.equal(requests.find(({ url }) => url.pathname.endsWith('/identifiers')).init.headers.Cookie, 'GDCAuthTT=short');
  assert.equal(requests.filter(({ init }) => JSON.stringify(init).includes(CLAIMS)).length, 1, 'the claims go to the login only');

  const results = requests.filter(({ url }) => url.pathname.endsWith('/rows')).map(({ url }) => url.searchParams);
  assert.deepEqual(results.map(params => params.getAll('offset')), [['0,0'], ['2,0'], ['2,0']], 'one offset each; a 202 asks again');
  assert.deepEqual([results[1].get('c'), results[1].get('q'), results[1].getAll('limit')], ['abc', 'x+y', ['2,1000']]);
});

test('an empty result is no rows, but a missing later page fails rather than reading short', async () => {
  const empty = fakeAnalytics({ pages: [new Response(null, { status: 204 })] });
  assert.deepEqual(await (await openSvpReport(empty.client, { fetch: empty.fetch })).read('a', 'b'), []);
  const gone = fakeAnalytics({ pages: [resultPage([['2026-11-02', 'Agent One', 1, 0]], { total: 2 }), new Response(null, { status: 204 })] });
  await assert.rejects((await openSvpReport(gone.client, { fetch: gone.fetch })).read('a', 'b'), error => error.code === 'INVALID_REPORT_RESPONSE');
  const short = fakeAnalytics({ pages: [resultPage([['2026-11-02', 'Agent One', 1, 0]], { total: 2 }), resultPage([], { total: 2 })] });
  await assert.rejects((await openSvpReport(short.client, { fetch: short.fetch })).read('a', 'b'), error => error.code === 'INVALID_REPORT_RESPONSE');
});

test('login failures name the step and never repeat the claims; the claims only go to a RingCentral host', async () => {
  const open = async (routes, session = SESSION) => { const { fetch, client } = fakeAnalytics({ routes }); client.analyticsSession = async () => session; return openSvpReport(client, { fetch }); };
  const failed = (code, detail) => error => { assert.equal(error.code, code); assert.match(error.detail, detail); assert.doesNotMatch(error.detail, /claims-secret|long|short/); return true; };
  await assert.rejects(open({ '/gdc/account/customerlogin': () => new Response(`bad ${CLAIMS}`, { status: 401 }) }), failed('RINGCX_ACCESS_DENIED', /^login: HTTP 401$/));
  await assert.rejects(open({ '/gdc/account/customerlogin': () => Response.json({ error: { message: 'User not found' } }, { status: 403 }) }), failed('RINGCX_ACCESS_DENIED', /^login: HTTP 403 User not found$/));
  await assert.rejects(open({ '/gdc/account/customerlogin': () => new Response('{}') }), failed('REPORT_LOGIN_FAILED', /set no session/));
  await assert.rejects(open({ '/gdc/account/customerlogin': () => new Response('{}', { headers: cookie('GDCAuthSST', '') }) }), failed('REPORT_LOGIN_FAILED', /set no session/));
  await assert.rejects(open({ '/gdc/account/token': () => new Response('{}') }), failed('REPORT_LOGIN_FAILED', /set no token/));
  await assert.rejects(open({ '/gdc/account/token': () => new Response('', { status: 429 }) }), failed('RINGCX_RATE_LIMITED', /^token: HTTP 429$/));
  await assert.rejects(open({ [`/gdc/md/${PID}/identifiers`]: () => Response.json({ identifiers: [] }) }), failed('REPORT_CHANGED', /not found/));
  await assert.rejects(open({ [obj(1997754)]: () => new Response('', { status: 500 }) }), failed('REPORT_UNAVAILABLE', /^report: HTTP 500$/));
  await assert.rejects(open({ '/gdc/account/customerlogin': () => { throw new TypeError(`connect failed ${CLAIMS}`); } }), failed('REPORT_UNAVAILABLE', /^login: TypeError$/));

  const redirected = fakeAnalytics({ routes: { '/gdc/account/customerlogin': () => new Response(null, { status: 302, headers: cookie('GDCAuthSST', 'long') }) } });
  assert.equal((await openSvpReport(redirected.client, { fetch: redirected.fetch })).version, '2026-11-03 23:51:48', 'a redirect that sets the session is a login');

  const bare = fakeAnalytics();
  bare.client.analyticsSession = async () => ({ ...SESSION, domain: 'us1-prod.analytics.engage.ringcentral.com' });
  await openSvpReport(bare.client, { fetch: bare.fetch });
  assert.equal(bare.requests[0].url.origin, ORIGIN, 'a host with no scheme becomes https');
  for (const domain of ['https://analytics.example.com', 'http://analytics.ringcentral.com', 'https://ringcentral.com.example.com', 'not a url']) {
    const blocked = fakeAnalytics();
    blocked.client.analyticsSession = async () => ({ ...SESSION, domain });
    await assert.rejects(openSvpReport(blocked.client, { fetch: blocked.fetch }), error => error.code === 'INVALID_ANALYTICS_SESSION');
    assert.equal(blocked.requests.length, 0);
  }
});

/** A report the sync can read: `rows` is what RingCX holds; it filters them to the asked dates. */
const fakeReport = (rows, { version = 'v1', loadedAt = '2026-11-03 17:59:27' } = {}) => {
  const report = { version, ranges: [], read: async (from, to) => { report.ranges.push([from, to]); return rows.filter(row => row.date >= from && row.date <= to); }, dataLoadedAt: async () => loadedAt };
  return report;
};
const row = (date, name, calls, sold = 0) => ({ date, name, calls, sold });
const history = [row('2026-06-25', 'Agent One', 10, 1), row('2026-11-02', 'Agent One', 24, 6), row('2026-11-02', 'Agent Two', 8, 2), row('2026-11-03', 'Agent One', 16, 2), row('2026-11-03', 'Agent Three', 5, 1)];
const saved = async db => (await db.query("SELECT to_char(call_date, 'YYYY-MM-DD') AS date, agent_key, calls, sold FROM svp_ringcx_report_daily ORDER BY call_date, agent_key")).rows.map(item => [item.date, item.agent_key, item.calls, item.sold]);

test('the first run reads all history, later runs re-read the last week, and vanished rows go away', async () => {
  const db = await database();
  try {
    const first = fakeReport(history);
    const result = await syncSvpRingcxCalls(db, async () => first, NOW);
    assert.deepEqual(result, { status: 'ok', from: SVP_REPORT_FIRST_DATE, to: '2026-11-03', rebuild: true, rows: 5, calls: 63, sold: 12 });
    assert.deepEqual(first.ranges, [[SVP_REPORT_FIRST_DATE, '2026-11-03']]);
    assert.equal((await saved(db)).length, 5);

    let opened = 0;
    assert.equal((await syncSvpRingcxCalls(db, async () => { opened++; return first; }, NOW + 60000)).status, 'skipped', 'a duplicated cron run reads nothing');
    assert.equal(opened, 0);

    // Agent Two's call on the 2nd was re-dispositioned away and Agent One gained a sale on the 3rd.
    const next = fakeReport([row('2026-06-25', 'Agent One', 999), row('2026-11-02', 'Agent One', 24, 6), row('2026-11-03', 'Agent One', 18, 3), row('2026-11-03', 'Agent Three', 5, 1)]);
    const second = await syncSvpRingcxCalls(db, async () => next, NOW + FIVE_MINUTES);
    assert.deepEqual([second.from, second.rebuild], ['2026-10-27', false]);
    assert.deepEqual(await saved(db), [['2026-06-25', 'agent one', 10, 1], ['2026-11-02', 'agent one', 24, 6], ['2026-11-03', 'agent one', 18, 3], ['2026-11-03', 'agent three', 5, 1]], 'older days stay as read; the last week follows the report');

    const status = await readSvpRingcxStatus(db);
    assert.deepEqual([status.reportFrom, status.reportThrough, status.dataLoadedAt, status.errorCode, status.lastRun.calls], ['2026-06-25', '2026-11-03', '2026-11-03 17:59:27', null, 47]);
    assert.deepEqual(status.days[0], { date: '2026-11-03', agents: 2, calls: 23, sold: 4, workbook_calls: null });
  } finally { await db.close(); }
});

test('saving the report with new filters rebuilds its history', async () => {
  const db = await database();
  try {
    await syncSvpRingcxCalls(db, async () => fakeReport(history), NOW);
    const edited = fakeReport([row('2026-11-03', 'Agent One', 1)], { version: 'v2' });
    const result = await syncSvpRingcxCalls(db, async () => edited, NOW + FIVE_MINUTES);
    assert.deepEqual([result.rebuild, result.from], [true, SVP_REPORT_FIRST_DATE]);
    assert.deepEqual(await saved(db), [['2026-11-03', 'agent one', 1, 0]]);
    assert.equal((await readSvpRingcxStatus(db)).reportFrom, '2026-11-03');
    assert.equal((await syncSvpRingcxCalls(db, async () => edited, NOW + 2 * FIVE_MINUTES)).rebuild, false);
  } finally { await db.close(); }
});

test('failures and empty reads keep earlier counts, record why, and clear after the next success', async () => {
  const db = await database();
  try {
    const before = await (async () => { await syncSvpRingcxCalls(db, async () => fakeReport(history), NOW); return saved(db); })();
    const denied = await syncSvpRingcxCalls(db, async () => { throw new RingCxError('RINGCX_ACCESS_DENIED', 503, 'login: HTTP 403 User not found'); }, NOW + FIVE_MINUTES);
    assert.deepEqual([denied.status, denied.code, denied.detail], ['failed', 'RINGCX_ACCESS_DENIED', 'login: HTTP 403 User not found']);
    let status = await readSvpRingcxStatus(db);
    assert.deepEqual([status.errorCode, status.errorDetail, new Date(status.succeededAt).getTime()], ['RINGCX_ACCESS_DENIED', 'login: HTTP 403 User not found', NOW]);

    const empty = await syncSvpRingcxCalls(db, async () => fakeReport([]), NOW + 2 * FIVE_MINUTES);
    assert.deepEqual([empty.status, empty.code, empty.detail], ['failed', 'EMPTY_REPORT', '2026-10-27 to 2026-11-03']);
    const emptyRebuild = await syncSvpRingcxCalls(db, async () => fakeReport([], { version: 'v2' }), NOW + 3 * FIVE_MINUTES);
    assert.equal(emptyRebuild.code, 'EMPTY_REPORT', 'an edit that matches nothing cannot erase the history');
    assert.deepEqual(await saved(db), before);
    assert.equal((await syncSvpRingcxCalls(db, async () => fakeReport(history, { version: 'v2' }), NOW + 4 * FIVE_MINUTES)).rebuild, true, 'the same edit is rebuilt once it reads');

    const unexpected = await syncSvpRingcxCalls(db, async () => { throw new Error('postgres://secret'); }, NOW + 5 * FIVE_MINUTES);
    assert.deepEqual([unexpected.code, unexpected.detail], ['SYNC_FAILED', null]);

    await syncSvpRingcxCalls(db, async () => fakeReport(history, { version: 'v2', loadedAt: null }), NOW + 6 * FIVE_MINUTES);
    status = await readSvpRingcxStatus(db);
    assert.deepEqual([status.errorCode, status.errorDetail, status.dataLoadedAt], [null, null, '2026-11-03 17:59:27'], 'a missing load time keeps the last one');
  } finally { await db.close(); }
});

const SHA = 'a'.repeat(64);
const sheet = (date, rows) => ({ sheet: date, data: [[`Daily Connected Calls Report — ${date}`], ['Source: synthetic'], [], ['Date', 'Agent Full Name', 'Total Calls Connected'], ...rows.map(([name, calls]) => [date, name, calls]), ['Total', `${rows.length} Active Agents`, null]] });
const june = parseSvpCallsReport({ fileName: 'Agent_Daily_Calls_2026-06_June_2026.xlsx', sha256: SHA, sheets: [sheet('2026-06-20', [['Agent One', 7], ['Agent Two', 3]])] });
const board = extra => ({ status: 'available', board: 'sp', salesComplete: true, source: 'HubSpot', rows: [{ name: 'Agent One', attributed: true, sales: 9 }, { name: 'Agent Four', attributed: true, sales: 1 }, { name: 'Writing agent not recorded', attributed: false, sales: 2 }], ...extra });
const day = date => ({ startDate: date, endDate: date });

test('outside 9 AM–9 PM Eastern the cron stops before RingCX or the database, and open pages stop reloading', () => {
  const route = readFileSync('app/api/cron/svp-ringcx-calls/route.ts', 'utf8');
  const auth = route.indexOf('cronAuthorized(request'), hours = route.indexOf('if (!policytekRefreshActive())'), reads = route.indexOf('await getSvpCallsDb()');
  assert.ok(auth >= 0 && auth < hours && hours < reads);
  assert.equal(readFileSync('app/leaderboard.tsx', 'utf8').match(/policytekRefreshActive\(\) && !document\.hidden/g)?.length, 2, 'the Standard vs. Preferred reload pauses like Shopper and Source');
});

test('the overnight pause is not called late, and today stays on the report until the 9 AM read', async () => {
  const db = await database();
  try {
    await syncSvpRingcxCalls(db, async () => fakeReport(history), at('2026-11-04T01:55:00Z'));

    const night = await readSvpCalls(db, day('2026-11-03'), at('2026-11-04T04:30:00Z'));
    assert.deepEqual([night.total, night.report.stale], [21, false], '11:30 PM is a planned pause');
    assert.doesNotMatch(applySvpCalls(board(), night).callNotice, /not been read/);

    const eightAm = at('2026-11-04T13:00:00Z');
    const early = await readSvpCalls(db, day('2026-11-04'), eightAm);
    assert.deepEqual([early.status, early.partial, early.total, early.report.stale], ['available', false, 0, false]);
    const shown = applySvpCalls(board(), early);
    assert.deepEqual([shown.calls.basis, shown.calls.soldPerInboundLog, shown.rows[0].inboundCalls, shown.rows[0].soldPerInboundLog], ['ringcx', null, 0, null]);
    assert.match(shown.callNotice, /checked every five minutes, 9 AM–9 PM Eastern\./);
    assert.match(shown.callNotice, /last refreshed this data at 2026-11-03 5:59 PM Eastern\./);
    const week = await readSvpCalls(db, { startDate: '2026-11-02', endDate: '2026-11-04' }, eightAm);
    assert.deepEqual([week.partial, week.total], [false, 53]);

    const range = { startDate: '2026-11-03', endDate: '2026-11-04' };
    assert.equal((await readSvpCalls(db, range, at('2026-11-04T14:10:00Z'))).report.stale, false, 'a grace period after 9 AM');
    assert.equal((await readSvpCalls(db, range, at('2026-11-04T14:20:00Z'))).report.stale, true, 'a morning with no reads is a real problem');

    assert.equal((await readSvpCalls(db, day('2026-11-04'), at('2026-11-05T02:30:00Z'))).status, 'not-covered', 'a day whose reads all failed is not shown as zero calls');
    assert.equal((await readSvpCalls(db, day('2026-11-05'), at('2026-11-05T13:00:00Z'))).status, 'not-covered', 'only the one overnight pause is bridged');

    await syncSvpRingcxCalls(db, async () => fakeReport(history), at('2026-11-04T14:00:07Z'));
    assert.equal((await readSvpRingcxStatus(db)).reportThrough, '2026-11-04');
  } finally { await db.close(); }
});

test('the board takes Calls and Close Rate from the report, and the report wins over the workbook', async () => {
  const db = await database();
  try {
    await importSvpCallsReports(db, [june], NOW);
    assert.equal(applySvpCalls(board(), await readSvpCalls(db, day('2026-11-03'), NOW)).callNotice, undefined, 'nothing read yet, so the board keeps its other source');
    await syncSvpRingcxCalls(db, async () => fakeReport(history), NOW);

    const today = await readSvpCalls(db, day('2026-11-03'), NOW);
    const shown = applySvpCalls(board(), today);
    assert.deepEqual(shown.rows.map(item => [item.inboundCalls, item.soldPerInboundLog]), [[16, 2 / 16], [0, null], [null, null]], 'Close Rate is RingCX Sold ÷ Calls, not the 9 HubSpot sales');
    assert.deepEqual(shown.calls, { status: 'available', basis: 'ringcx', total: 21, partial: false, soldPerInboundLog: 3 / 21 });
    assert.equal(shown.source, 'HubSpot · RingCX');
    assert.match(shown.callNotice, /RingCX report "Agent Close Rate - Standard vs Preferred SYNC", checked every five minutes/);
    assert.match(shown.callNotice, /RingCX last refreshed this data at 5:59 PM Eastern\./);
    assert.match(shown.callNotice, /One agent with calls but no HubSpot sales in this range counts in the totals only\./);
    assert.equal(applySvpCalls(board({ salesComplete: false }), today).calls.soldPerInboundLog, 3 / 21, "the report's Close Rate does not depend on HubSpot returning every deal");

    const late = applySvpCalls(board(), await readSvpCalls(db, day('2026-11-03'), NOW + 1500000));
    assert.match(late.callNotice, /has not been read since .*, so today's numbers may be behind/);
    assert.doesNotMatch(late.callNotice, /last refreshed/);

    const past = applySvpCalls(board(), await readSvpCalls(db, day('2026-11-02'), NOW));
    assert.deepEqual([past.calls.total, past.rows[0].soldPerInboundLog], [32, 6 / 24]);
    assert.doesNotMatch(past.callNotice, /last refreshed|not been read/, 'a finished day has no freshness note');

    const both = await readSvpCalls(db, { startDate: '2026-11-02', endDate: '2026-11-03' }, NOW);
    assert.deepEqual([both.total, both.byAgent.get('agent one'), both.report.soldByAgent.get('agent one')], [53, 40, 8]);

    const straddle = await readSvpCalls(db, { startDate: '2026-06-20', endDate: '2026-06-25' }, NOW);
    assert.deepEqual([straddle.partial, straddle.total], [true, 10], 'workbook days never mix with report days');
    assert.match(applySvpCalls(board(), straddle).callNotice, /has no call data/);

    const before = applySvpCalls(board(), await readSvpCalls(db, day('2026-06-20'), NOW));
    assert.deepEqual([before.calls.basis, before.calls.total, before.rows[0].soldPerInboundLog], ['spreadsheet', 10, 9 / 7], 'days before the report keep the workbook');
    assert.match(before.callNotice, /answered/);

    assert.equal((await readSvpCalls(db, day('2026-11-05'), NOW)).status, 'not-covered');
    await importSvpCallsReports(db, [parseSvpCallsReport({ fileName: 'Agent_Daily_Calls_2026-11_November_2026.xlsx', sha256: 'b'.repeat(64), sheets: [sheet('2026-11-03', [['Agent One', 1]])] })]);
    assert.equal((await readSvpCalls(db, day('2026-11-03'), NOW)).total, 21, 'a workbook import cannot change report days');
  } finally { await db.close(); }
});
