import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { LEAD_DATA_METRICS, LEAD_DATA_SOURCES, leadDataCompareRows, leadDataCsv, leadDataCsvFilename, rankLeadDataRows, sortLeadDataRows } from '../app/lead-data-view.mjs';
import { WORKSPACE_EXTRA_PAGES, resolveWorkspaceRoute } from '../app/recruiting-navigation.mjs';
import { leadDataDays, leadDataLoaded, leadReportExecution, leadReportRows, openLeadDataReports, readLeadData, syncLeadData, validateLeadDataInput } from '../lib/lead-data.mjs';
import { handleLeaderboardRequest } from '../lib/leaderboard.mjs';
import { RingCxError } from '../lib/ringcx.mjs';

const NOON = Date.parse('2026-11-03T17:00:00Z');
const LABELS = { dateSet: '/md/date-set', dateLabel: '/md/date-label', agentLabel: '/md/agent', callLabel: '/md/call', stateLabel: '/md/state', timeMetric: '/md/time' };
const saved = ({ state = true, relative = true, extra = [] } = {}) => ({
  buckets: [
    { localIdentifier: 'measures', items: [{ measure: { localIdentifier: 'other', definition: { measureDefinition: { item: { uri: '/md/other' } } } } }, { measure: { localIdentifier: 'saved-time', title: 'Interaction Time', definition: { measureDefinition: { item: { uri: '/md/time' } } } } }] },
    { localIdentifier: 'attribute', items: [
      { visualizationAttribute: { displayForm: { uri: '/md/agent' }, localIdentifier: 'a' } },
      { visualizationAttribute: { displayForm: { uri: '/md/caller-number' }, localIdentifier: 'b' } },
      { visualizationAttribute: { displayForm: { uri: '/md/notes' }, localIdentifier: 'c' } },
      { visualizationAttribute: { displayForm: { uri: '/md/recording' }, localIdentifier: 'd' } },
      ...(state ? [{ visualizationAttribute: { displayForm: { uri: '/md/state' }, localIdentifier: 'e' } }] : []),
    ] },
  ],
  filters: [
    relative ? { relativeDateFilter: { dataSet: { uri: '/md/date-set' }, granularity: 'GDC.time.year' } } : { absoluteDateFilter: { dataSet: { uri: '/md/date-set' }, from: '2020-01-01', to: '2020-01-02' } },
    { positiveAttributeFilter: { displayForm: { uri: '/md/call-type' }, in: { uris: ['/md/inbound'] } } },
    { negativeAttributeFilter: { displayForm: { uri: '/md/result' }, notIn: { uris: ['/md/abandoned'] } } },
    { negativeAttributeFilter: { displayForm: { uri: '/md/unused' }, notIn: [] } },
    ...extra,
  ],
});

function database() {
  const client = new PGlite();
  const sql = readFileSync('migrations/0011_lead_data.sql', 'utf8');
  return (async () => {
    await client.exec(sql); await client.exec(sql);
    return client;
  })();
}

const call = (date, name, id, seconds) => ({ date, name, call: id, seconds });
const reports = ({ version = 'v1', short = [call('2026-11-03', 'Ana Lee', 's1', 5)], instant = [call('2026-11-03', 'Ana Lee', 'i1', 2)], loaded = '2026-11-03 12:00:00', fail } = {}) => async () => {
  if (fail) throw fail;
  return { version, readShort: async (from, to) => short.filter(row => row.date >= from && row.date <= to), readInstant: async (from, to) => instant.filter(row => row.date >= from && row.date <= to), dataLoadedAt: async () => loaded };
};

test('a report keeps its filters, replaces only its date, and never asks for caller columns', () => {
  const { execution } = leadReportExecution(saved(), LABELS, '2026-11-01', '2026-11-03');
  assert.deepEqual(execution.afm.attributes.map(item => item.displayForm.uri), ['/md/date-label', '/md/agent', '/md/call', '/md/state']);
  assert.deepEqual(execution.afm.filters[0], { absoluteDateFilter: { dataSet: { uri: '/md/date-set' }, from: '2026-11-01', to: '2026-11-03' } });
  assert.equal(execution.afm.filters.length, 3, 'keeps the call type and result filters, drops the empty one');
  assert.ok(execution.afm.filters.some(filter => filter.positiveAttributeFilter?.displayForm.uri === '/md/call-type'));
  assert.ok(execution.afm.filters.some(filter => filter.negativeAttributeFilter?.displayForm.uri === '/md/result'));
  assert.deepEqual(execution.afm.measures.map(item => item.definition.measure.item.uri), ['/md/time']);
  const sent = JSON.stringify(execution);
  for (const column of ['caller-number', 'notes', 'recording']) assert.ok(!sent.includes(column), `${column} must not be requested`);
});

test('the State column is only requested while the saved report has it, so removing it brings its calls back', () => {
  const { execution } = leadReportExecution(saved({ state: false }), LABELS, '2026-11-01', '2026-11-03');
  assert.deepEqual(execution.afm.attributes.map(item => item.displayForm.uri), ['/md/date-label', '/md/agent', '/md/call']);
});

test('a report that no longer has its agent, time or single date filter stops the sync', () => {
  const noAgent = saved(); noAgent.buckets[1].items.shift();
  assert.throws(() => leadReportExecution(noAgent, LABELS, '2026-11-01', '2026-11-03'), error => error.code === 'REPORT_CHANGED');
  const noTime = saved(); noTime.buckets[0].items.pop();
  assert.throws(() => leadReportExecution(noTime, LABELS, '2026-11-01', '2026-11-03'), error => error.code === 'REPORT_CHANGED');
  const twoDates = saved({ extra: [{ relativeDateFilter: { dataSet: { uri: '/md/other-date' } } }] });
  assert.throws(() => leadReportExecution(twoDates, LABELS, '2026-11-01', '2026-11-03'), error => error.code === 'REPORT_CHANGED');
  const otherDate = saved(); otherDate.filters[0].relativeDateFilter.dataSet.uri = '/md/other-date';
  assert.throws(() => leadReportExecution(otherDate, LABELS, '2026-11-01', '2026-11-03'), error => error.code === 'REPORT_CHANGED');
});

test('result rows reject anything that is not a date, call ID and number', () => {
  const page = (date, id, value) => ({ data: [[value]], headerItems: [[[{ attributeHeaderItem: { name: date } }], [{ attributeHeaderItem: { name: 'Ana Lee' } }], [{ attributeHeaderItem: { name: id } }]]] });
  assert.deepEqual(leadReportRows(page('2026-11-03', 'u1', '2')), [{ date: '2026-11-03', name: 'Ana Lee', call: 'u1', seconds: 2 }]);
  assert.equal(leadReportRows(page('2026-11-03', 'u1', null))[0].seconds, null);
  assert.throws(() => leadReportRows(page('11/03/2026', 'u1', '2')), error => error.code === 'INVALID_REPORT_RESPONSE');
  assert.throws(() => leadReportRows(page('2026-11-03', '', '2')), error => error.code === 'INVALID_REPORT_RESPONSE');
  assert.throws(() => leadReportRows(page('2026-11-03', 'u1', 'soon')), error => error.code === 'INVALID_REPORT_RESPONSE');
  assert.throws(() => leadReportRows({ data: [], headerItems: [[[]]] }), error => error.code === 'INVALID_REPORT_RESPONSE');
});

test('Instant Disconnects count two seconds or less; Short Duration counts every call; a repeated call counts once', () => {
  const short = [call('2026-11-03', 'Ana Lee', 's1', 0), call('2026-11-03', 'Ana Lee', 's1', 0), call('2026-11-03', 'Ana Lee', 's2', 300)];
  const instant = [call('2026-11-03', 'Ana Lee', 'i1', 1), call('2026-11-03', 'Ana Lee', 'i2', 2), call('2026-11-03', 'Ana Lee', 'i2', 2), call('2026-11-03', 'Ana Lee', 'i3', 3), call('2026-11-03', 'Ana Lee', 'i4', null)];
  assert.deepEqual(leadDataDays(short, instant), [{ date: '2026-11-03', key: 'ana lee', name: 'Ana Lee', instantDisconnects: 2, shortDuration: 2 }]);
});

test('a blank agent counts with N/A, and an agent keeps RingCX spelling on the page', () => {
  const days = leadDataDays([call('2026-11-03', '', 's1', 5), call('2026-11-03', 'N/A', 's2', 5), call('2026-11-03', '  Ana   Lee ', 's3', 5)], []);
  assert.deepEqual(days.map(day => [day.key, day.name, day.shortDuration]), [['n/a', 'N/A', 2], ['ana lee', 'Ana Lee', 1]]);
});

test('a sync stores only counts, and a saved report change rebuilds the whole history', async () => {
  const db = await database();
  const seen = [];
  const open = version => async () => ({ version, readShort: async (from, to) => { seen.push([from, to]); return [call('2026-11-03', 'Ana Lee', 's1', 5)]; }, readInstant: async () => [], dataLoadedAt: async () => null });
  assert.equal(await leadDataLoaded(db), false);
  assert.equal((await syncLeadData(db, open('v1'), NOON)).status, 'ok');
  assert.equal(await leadDataLoaded(db), true);
  assert.deepEqual(seen.pop(), ['2026-01-01', '2026-11-03'], 'the first run reads from the start');
  assert.equal((await syncLeadData(db, open('v1'), NOON + 300000)).status, 'ok');
  assert.deepEqual(seen.pop(), ['2026-10-27', '2026-11-03'], 'later runs re-read a week');
  assert.equal((await syncLeadData(db, open('v2'), NOON + 600000)).rebuild, true);
  assert.deepEqual(seen.pop(), ['2026-01-01', '2026-11-03'], 'a saved change rebuilds');
  const { rows: columns } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'lead_data_ringcx_daily' ORDER BY ordinal_position`);
  assert.deepEqual(columns.map(row => row.column_name), ['call_date', 'agent_key', 'agent_name', 'instant_disconnects', 'short_duration']);
  await db.close();
});

test('runs close together are skipped, and a re-read removes rows RingCX no longer has', async () => {
  const db = await database();
  const first = reports({ short: [call('2026-11-03', 'Ana Lee', 's1', 5), call('2026-11-03', 'Bo Ray', 's2', 5)] });
  assert.equal((await syncLeadData(db, first, NOON)).status, 'ok');
  assert.equal((await syncLeadData(db, first, NOON + 60000)).status, 'skipped');
  await syncLeadData(db, reports({ short: [call('2026-11-03', 'Ana Lee', 's1', 5)] }), NOON + 300000);
  const { rows } = await db.query('SELECT agent_key FROM lead_data_ringcx_daily');
  assert.deepEqual(rows.map(row => row.agent_key), ['ana lee']);
  await db.close();
});

test('a failed or empty read keeps earlier counts and is recorded', async () => {
  const db = await database();
  await syncLeadData(db, reports(), NOON);
  const failed = await syncLeadData(db, reports({ fail: new RingCxError('REPORT_CHANGED', 503, 'no agent column') }), NOON + 300000);
  assert.deepEqual([failed.status, failed.code], ['failed', 'REPORT_CHANGED']);
  const empty = await syncLeadData(db, reports({ short: [], instant: [] }), NOON + 600000);
  assert.deepEqual([empty.status, empty.code], ['failed', 'EMPTY_REPORT']);
  const { rows: saved } = await db.query('SELECT short_duration FROM lead_data_ringcx_daily');
  assert.deepEqual(saved, [{ short_duration: 1 }]);
  const { ringcentral } = await readLeadData({ period: 'day' }, { db, now: NOON + 600000 });
  assert.equal(ringcentral.errorCode, 'EMPTY_REPORT');
  assert.equal(ringcentral.totals.shortDuration, 1);
  const unexpected = await syncLeadData(db, reports({ fail: new Error('secret detail') }), NOON + 900000);
  assert.deepEqual([unexpected.code, unexpected.detail], ['SYNC_FAILED', null], 'an unknown error is not repeated');
  await db.close();
});

test('the page reads counts for its range: N/A is in the totals and not the rows; PolicyTek is not connected', async () => {
  const db = await database();
  await syncLeadData(db, reports({
    short: [call('2026-11-02', 'Ana Lee', 's1', 5), call('2026-11-03', 'Ana Lee', 's2', 5), call('2026-11-03', 'N/A', 's3', 5), call('2026-11-03', 'Bo Ray', 's4', 5)],
    instant: [call('2026-11-03', 'N/A', 'i1', 1), call('2026-11-03', 'Bo Ray', 'i2', 2), call('2026-11-03', 'Bo Ray', 'i3', 9)],
  }), NOON);
  const today = await readLeadData({ period: 'day' }, { db, now: NOON + 60000 });
  assert.equal(today.board, 'lead-data');
  assert.equal(today.policytek.status, 'connection-required');
  assert.equal(today.ringcentral.status, 'available');
  assert.deepEqual(today.ringcentral.totals, { instantDisconnects: 2, shortDuration: 3 });
  assert.deepEqual(today.ringcentral.noAgent, { instantDisconnects: 1, shortDuration: 1 });
  assert.deepEqual(today.ringcentral.rows.map(row => row.name).sort(), ['Ana Lee', 'Bo Ray']);
  assert.ok(today.ringcentral.rows.every(row => row.name !== 'N/A'));
  assert.equal(today.ringcentral.stale, false);
  assert.match(today.ringcentral.notice, /2 seconds or less/);
  assert.match(today.ringcentral.notice, /RingCX last refreshed/);
  const range = await readLeadData({ period: 'custom', from: '2026-11-02', to: '2026-11-02' }, { db, now: NOON + 60000 });
  assert.deepEqual(range.ringcentral.totals, { instantDisconnects: 0, shortDuration: 1 });
  assert.ok(!/RingCX last refreshed/.test(range.ringcentral.notice), 'a finished day needs no refresh note');
  const early = await readLeadData({ period: 'custom', from: '2026-10-01', to: '2026-11-03' }, { db, now: NOON + 60000 });
  assert.match(early.ringcentral.notice, /reports start 2026-11-02/);
  await db.close();
});

test('with no successful read yet the page says so', async () => {
  const db = await database();
  const { ringcentral } = await readLeadData({ period: 'day' }, { db, now: NOON });
  assert.equal(ringcentral.status, 'unavailable');
  assert.match(ringcentral.message, /have not been read yet/);
  await db.close();
});

test('old numbers are called out', async () => {
  const db = await database();
  await syncLeadData(db, reports(), NOON);
  const { ringcentral } = await readLeadData({ period: 'day' }, { db, now: NOON + 3600000 });
  assert.equal(ringcentral.stale, true);
  assert.match(ringcentral.notice, /may be behind/);
  await db.close();
});

test('requests use the same periods as the leaderboard, without a board', async () => {
  assert.deepEqual(validateLeadDataInput({ period: 'week' }), { board: 'lead-data', period: 'week' });
  assert.deepEqual(validateLeadDataInput({ period: 'custom', from: '2026-11-01', to: '2026-11-03' }), { board: 'lead-data', period: 'custom', from: '2026-11-01', to: '2026-11-03' });
  assert.throws(() => validateLeadDataInput({ period: 'year' }));
  assert.throws(() => validateLeadDataInput({ period: 'day', extra: true }));
  const request = body => new Request('https://app.test/api/lead-data', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://app.test' }, body: JSON.stringify(body) });
  const options = { getUser: () => ({ email: 'a@b.test' }), authorizeUser: () => true, allowedOrigin: 'https://app.test', validateInput: validateLeadDataInput, readData: async input => input };
  const accepted = await handleLeaderboardRequest(request({ period: 'month' }), options);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).board, 'lead-data');
  assert.equal((await handleLeaderboardRequest(request({ period: 'year' }), options)).status, 400);
  assert.equal((await handleLeaderboardRequest(request({ period: 'month' }), { ...options, getUser: () => null })).status, 401);
  assert.equal((await handleLeaderboardRequest(request({ period: 'month' }), { ...options, authorizeUser: () => false })).status, 403);
});

test('both saved reports are read through one sign-in, asking only for each call\'s day, agent and ID', async () => {
  const PID = 'fxvsv9l0lmfwew3feu8jhuf80qidzfyg', ORIGIN = 'https://us1-prod.analytics.engage.ringcentral.com', requests = [];
  const uris = { aav8r2fboaCP: '/md/short', aar8hEE2iLsP: '/md/instant', 'interactionstart.dataset.dt': '/md/date-set', 'interactionstart.date.day.yyyy_mm_dd': '/md/date-label', 'label.agent.agentfullname': '/md/agent', 'label.segment.uii': '/md/call', 'label.anigeolocation.state': '/md/state', aadwtIPjxoof: '/md/time', aaD16BZbLrKz: '/md/loaded' };
  const page = rows => ({ executionResult: { data: rows.map(row => [String(row[3])]), headerItems: [[0, 1, 2].map(column => rows.map(row => ({ attributeHeaderItem: { name: row[column] } })))], paging: { count: [rows.length, 1], offset: [0, 0], total: [rows.length, 1] } } });
  const cookie = (name, value) => ({ 'Set-Cookie': `${name}=${value}; Path=/gdc; Secure; HttpOnly` });
  const executed = [];
  const routes = {
    '/gdc/account/customerlogin': () => new Response('{}', { headers: cookie('GDCAuthSST', 'long') }),
    '/gdc/account/token': () => new Response('{}', { headers: cookie('GDCAuthTT', 'short') }),
    [`/gdc/md/${PID}/identifiers`]: () => Response.json({ identifiers: Object.entries(uris).map(([identifier, uri]) => ({ identifier, uri })) }),
    '/md/short': () => Response.json({ visualizationObject: { meta: { updated: 'short-saved' }, content: saved() } }),
    '/md/instant': () => Response.json({ visualizationObject: { meta: { updated: 'instant-saved' }, content: saved({ state: false }) } }),
    [`/gdc/app/projects/${PID}/executeAfm`]: init => {
      const { afm } = JSON.parse(init.body).execution;
      executed.push(afm);
      const name = !afm.attributes ? 'loaded' : afm.attributes.some(item => item.localIdentifier === 'state') ? 'short' : 'instant';
      return Response.json({ executionResponse: { links: { executionResult: `/gdc/app/projects/${PID}/executionResults/${name}?c=abc&offset=0,0&limit=2,1000&dimensions=2&totals=0,0` } } }, { status: 201 });
    },
    [`/gdc/app/projects/${PID}/executionResults/short`]: () => Response.json(page([['2026-11-03', 'Ana Lee', 'u1', 5]])),
    [`/gdc/app/projects/${PID}/executionResults/instant`]: () => Response.json(page([['2026-11-03', 'Ana Lee', 'u2', 2]])),
    [`/gdc/app/projects/${PID}/executionResults/loaded`]: () => Response.json({ executionResult: { data: ['11032026175927'], headerItems: [], paging: { count: [1], offset: [0], total: [1] } } }),
  };
  const fetch = async (url, init) => {
    requests.push(new URL(url).pathname);
    const route = routes[new URL(url).pathname];
    if (!route) throw new Error(`unexpected request ${url}`);
    return route(init);
  };
  const opened = await openLeadDataReports({ analyticsSession: async () => ({ clientId: 'client-1', claims: 'claims-secret', provider: 'sso', domain: ORIGIN }) }, { fetch, pollMs: 1 });
  assert.equal(opened.version, 'short-saved|instant-saved');
  assert.deepEqual(await opened.readShort('2026-11-01', '2026-11-03'), [{ date: '2026-11-03', name: 'Ana Lee', call: 'u1', seconds: 5 }]);
  assert.deepEqual(await opened.readInstant('2026-11-01', '2026-11-03'), [{ date: '2026-11-03', name: 'Ana Lee', call: 'u2', seconds: 2 }]);
  assert.equal(await opened.dataLoadedAt(), '2026-11-03 17:59:27');
  assert.equal(requests.filter(path => path.endsWith('/customerlogin')).length, 1, 'one sign-in');
  assert.deepEqual(executed.slice(0, 2).map(afm => afm.attributes.map(item => item.displayForm.uri)), [['/md/date-label', '/md/agent', '/md/call', '/md/state'], ['/md/date-label', '/md/agent', '/md/call']]);
  assert.ok(!JSON.stringify(executed).match(/caller-number|notes|recording/), 'no caller columns are asked for');
});

test('rows rank by the chosen count, sort without losing rank, and agents with none are not listed', () => {
  const rows = [{ name: 'Bo Ray', instantDisconnects: 1, shortDuration: 9 }, { name: 'Ana Lee', instantDisconnects: 3, shortDuration: 2 }, { name: 'Cy Fox', instantDisconnects: 0, shortDuration: 4 }, { name: 'Di Moe', instantDisconnects: 3, shortDuration: 5 }];
  const ranked = rankLeadDataRows(rows, 'instantDisconnects');
  assert.deepEqual(ranked.map(row => [row.name, row.rank]), [['Di Moe', 1], ['Ana Lee', 2], ['Bo Ray', 3]]);
  assert.deepEqual(rankLeadDataRows(rows, 'shortDuration').map(row => row.name), ['Bo Ray', 'Di Moe', 'Cy Fox', 'Ana Lee']);
  const named = sortLeadDataRows(ranked, 'instantDisconnects', { field: 'name', direction: 'asc' });
  assert.deepEqual(named.map(row => [row.name, row.rank]), [['Ana Lee', 2], ['Bo Ray', 3], ['Di Moe', 1]]);
  assert.deepEqual(sortLeadDataRows(ranked, 'instantDisconnects', { field: 'count', direction: 'asc' }).map(row => row.name), ['Bo Ray', 'Di Moe', 'Ana Lee']);
  assert.deepEqual(leadDataCompareRows(rows).map(row => row.name), ['Bo Ray', 'Di Moe', 'Cy Fox', 'Ana Lee']);
});

test('an export has both counts, ends with calls that have no agent, and opens names as text', () => {
  const csv = leadDataCsv([{ rank: 1, name: '=Bad, Name', instantDisconnects: 2, shortDuration: 3 }], { instantDisconnects: 4, shortDuration: 5 });
  assert.equal(csv, `Rank,Agent,Instant Disconnects,Short Duration Calls\r\n1,"'=Bad, Name",2,3\r\n,No agent (N/A),4,5\r\n`);
  assert.ok(!leadDataCsv([], null).includes('No agent'));
  assert.equal(leadDataCsvFilename('RingCentral', 'Instant Disconnects', '2026-11-01', '2026-11-03'), 'lead-data-ringcentral-instant-disconnects-2026-11-01-to-2026-11-03.csv');
  assert.equal(leadDataCsvFilename('RingCentral', 'Short Duration Calls', '2026-11-03', '2026-11-03'), 'lead-data-ringcentral-short-duration-calls-2026-11-03.csv');
});

test('Lead Data sits directly under Leaderboard and has its own address', () => {
  assert.deepEqual(WORKSPACE_EXTRA_PAGES.map(page => page.id), ['leaderboard', 'lead-data']);
  assert.equal(WORKSPACE_EXTRA_PAGES[1].label, 'Lead Data');
  assert.deepEqual(resolveWorkspaceRoute('#lead-data'), { view: 'lead-data' });
});

test('the page offers the requested tabs and shares its date controls with the leaderboard', () => {
  assert.deepEqual(LEAD_DATA_SOURCES.map(source => source.label), ['PolicyTek', 'RingCentral', 'Compare side by side']);
  assert.deepEqual(LEAD_DATA_METRICS.map(metric => metric.label), ['Instant Disconnects', 'Short Duration Calls']);
  for (const file of ['app/leaderboard.tsx', 'app/lead-data.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /useLeaderboardDates\(\)/, file);
    assert.match(source, /<LeaderboardPeriodTabs dates=\{dates\}/, file);
    assert.match(source, /<LeaderboardRangeForm dates=\{dates\} \/>/, file);
  }
});

test('the cron checks its hours before touching anything, and the first load is the only out-of-hours read', () => {
  const cron = readFileSync('app/api/cron/lead-data/route.ts', 'utf8');
  assert.ok(cron.indexOf('policytekRefreshActive()') < cron.indexOf('getLeadDataDb()'));
  assert.ok(cron.indexOf('cronAuthorized') < cron.indexOf('policytekRefreshActive()'));
  const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons;
  assert.deepEqual(crons.find(item => item.path === '/api/cron/lead-data'), { path: '/api/cron/lead-data', schedule: '*/5 * * * *' });
  const route = readFileSync('app/api/lead-data/route.ts', 'utf8');
  assert.match(route, /if \(!await leadDataLoaded\(db\)\)/);
});
