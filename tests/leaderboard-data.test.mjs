import test from 'node:test';
import assert from 'node:assert/strict';
import { leaderboardBarWidth, leaderboardTotals, rankLeaderboardRows, sourceLeaderboardTableRows, sourceLeaderboardValue } from '../app/leaderboard-data.mjs';
import { WORKSPACE_EXTRA_PAGES, resolveWorkspaceRoute } from '../app/recruiting-navigation.mjs';

test('agent rankings use selected metric, secondary metric and stable names without mutating source rows', () => {
  const rows = [{ name: 'Zed', sales: 3, annualPremium: 200 }, { name: 'Alex', sales: 3, annualPremium: 500 }, { name: 'Blair', sales: 1, annualPremium: 700 }];
  assert.deepEqual(rankLeaderboardRows(rows, 'sp', 'sales').map(row => row.name), ['Alex', 'Zed', 'Blair']);
  assert.deepEqual(rankLeaderboardRows(rows, 'sp', 'ap').map(row => row.name), ['Blair', 'Alex', 'Zed']);
  assert.deepEqual(rows.map(row => row.name), ['Zed', 'Alex', 'Blair']);
});

test('missing premium remains unknown and does not manufacture a premium winner or total', () => {
  const rows = [{ name: 'Known', sales: 2, annualPremium: 800 }, { name: 'Missing', sales: 5, annualPremium: null }];
  assert.equal(leaderboardTotals(rows, 'sp').first, 7);
  assert.equal(leaderboardTotals(rows, 'sp').second, null);
  assert.equal(leaderboardTotals(rows, 'sp').activeAgents, 2);
  assert.equal(leaderboardTotals(rows, 'sp', 'sales').top, 'Missing');
  assert.equal(leaderboardTotals(rows, 'sp', 'ap').top, 'Known');
  assert.deepEqual(rankLeaderboardRows(rows, 'sp', 'ap').map(row => row.name), ['Known']);
  assert.equal(leaderboardTotals([{ name: 'Unknown', sales: 2, annualPremium: null }], 'sp', 'ap').top, null);
  assert.equal(leaderboardTotals([{ name: 'Zero', sales: 2, annualPremium: 0 }], 'sp', 'ap').top, null);
});

test('Shopper totals sum submitted policies and premium using actual row values', () => {
  const rows = [{ name: 'Alex', submitted: 3, premium: 600 }, { name: 'Blair', submitted: 1, premium: 900 }];
  const totals = leaderboardTotals(rows, 'shopper', 'sales');
  assert.equal(totals.first, 4); assert.equal(totals.second, 1500); assert.equal(totals.top, 'Alex');
  assert.equal(leaderboardTotals(rows, 'shopper', 'ap').top, 'Blair');
});

test('source return on spend is a ratio of totals, never an average of individual ratios', () => {
  const rows = [{ name: 'One', submitted: 1, premium: 100, leads: 4, spend: 10 }, { name: 'Two', submitted: 1, premium: 100, leads: 5, spend: 100 }];
  assert.equal(leaderboardTotals(rows, 'source').roas, 200 / 110);
  assert.equal(sourceLeaderboardValue(rows[0], 'closeRate'), .25);
  assert.equal(sourceLeaderboardValue(rows[0], 'roas'), 10);
  assert.equal(sourceLeaderboardValue({ premium: 100, spend: 0 }, 'roas'), null);
  assert.equal(sourceLeaderboardValue({ submitted: 0, leads: null }, 'closeRate'), null);
});

test('source tables retain lead-only sources even when no submitted-policy bar can be drawn', () => {
  const rows = [{ name: 'Lead-only source', leads: 10, submitted: 0, premium: 0, spend: 80 }, { name: 'Submitted source', leads: 3, submitted: 1, premium: 500, spend: 20 }];
  assert.equal(rankLeaderboardRows(rows, 'source', 'sales').length, 1);
  assert.deepEqual(sourceLeaderboardTableRows(rows).map(row => row.name), ['Submitted source', 'Lead-only source']);
});

test('chart widths are finite, bounded and do not substitute an unknown metric with a fake bar', () => {
  assert.equal(leaderboardBarWidth(25, 100), 25);
  assert.equal(leaderboardBarWidth(200, 100), 100);
  for (const value of [null, undefined, NaN, Infinity, -1]) assert.equal(leaderboardBarWidth(value, 100), 0);
});

test('every source-performance column sorts with stable ties and missing values last', () => {
  const rows = [{ name: 'beta', leads: 4, submitted: 1, premium: 100, spend: 20 }, { name: 'Alpha', leads: 10, submitted: 2, premium: 200, spend: 10 }, { name: 'alpha', leads: null, submitted: null, premium: null, spend: null }];
  assert.deepEqual(sourceLeaderboardTableRows(rows, { field: 'name', direction: 'asc' }).map(row => row.name), ['Alpha', 'alpha', 'beta']);
  assert.deepEqual(sourceLeaderboardTableRows(rows, { field: 'leads', direction: 'desc' }).map(row => row.name), ['Alpha', 'beta', 'alpha']);
  assert.deepEqual(sourceLeaderboardTableRows(rows, { field: 'closeRate', direction: 'asc' }).map(row => row.name), ['Alpha', 'beta', 'alpha']);
  assert.deepEqual(sourceLeaderboardTableRows(rows, { field: 'roas', direction: 'desc' }).map(row => row.name), ['Alpha', 'beta', 'alpha']);
  assert.deepEqual(rows.map(row => row.name), ['beta', 'Alpha', 'alpha']);
});

test('Leaderboard has its own addressable workspace page', () => {
  assert.equal(WORKSPACE_EXTRA_PAGES.find(page => page.id === 'leaderboard').label, 'Leaderboard');
  assert.deepEqual(resolveWorkspaceRoute('#leaderboard'), { view: 'leaderboard' });
});

test('signed premium adjustments remain real financial values rather than missing or fabricated positive bars', () => {
  const rows = [{ name: 'Positive', sales: 1, annualPremium: 100 }, { name: 'Adjustment', sales: 1, annualPremium: -2.68 }];
  assert.equal(leaderboardTotals(rows, 'sp', 'ap').second, 97.32);
  assert.deepEqual(rankLeaderboardRows(rows, 'sp', 'ap').map(row => row.name), ['Positive', 'Adjustment']);
  assert.equal(rankLeaderboardRows(rows, 'sp', 'ap')[1].annualPremium, -2.68);
  assert.equal(leaderboardBarWidth(-2.68, 100), 0);
});

test('unattributed policies count in totals without inventing an agent or awarding a podium rank', () => {
  const rows = [{ name: 'Writing agent not recorded', attributed: false, sales: 20, annualPremium: 4000 }, { name: 'Known agent', attributed: true, sales: 1, annualPremium: 200 }];
  const totals = leaderboardTotals(rows, 'sp');
  assert.equal(totals.first, 21); assert.equal(totals.second, 4200); assert.equal(totals.activeAgents, 1); assert.equal(totals.top, 'Known agent');
  assert.deepEqual(rankLeaderboardRows(rows, 'sp', 'sales').map(row => row.name), ['Known agent', 'Writing agent not recorded']);
  assert.equal(leaderboardTotals(rows.slice(0, 1), 'sp').top, null);
  assert.equal(leaderboardTotals(rows.slice(0, 1), 'sp').activeAgents, 0);
});

import { filterLeaderboardRows, leaderboardSortFields, sortLeaderboardRows } from '../app/leaderboard-data.mjs';
test('ranked rows re-sort by name, calls, close rate and production per board, keeping ranks and unattributed rows last', () => {
  const ranked = [
    { name: 'Bravo Agent', sales: 9, annualPremium: 900, inboundCalls: 30, soldPerInboundLog: .3 },
    { name: 'alpha agent', sales: 5, annualPremium: 1200, inboundCalls: null, soldPerInboundLog: null },
    { name: 'Charlie Agent', sales: 2, annualPremium: 100, inboundCalls: 4, soldPerInboundLog: .5 },
    { name: 'Writing agent not recorded', attributed: false, sales: 1, annualPremium: 50, inboundCalls: null, soldPerInboundLog: null },
  ];
  const order = (field, direction) => sortLeaderboardRows(ranked, 'sp', { field, direction }).map(row => `${row.rank}:${row.name.split(' ')[0]}`);
  assert.deepEqual(order('rank', 'desc'), ['1:Bravo', '2:alpha', '3:Charlie', '4:Writing']);
  assert.deepEqual(order('name', 'asc'), ['2:alpha', '1:Bravo', '3:Charlie', '4:Writing']);
  assert.deepEqual(order('calls', 'desc'), ['1:Bravo', '3:Charlie', '2:alpha', '4:Writing']);
  assert.deepEqual(order('calls', 'asc'), ['3:Charlie', '1:Bravo', '2:alpha', '4:Writing']);
  assert.deepEqual(order('closeRate', 'desc'), ['3:Charlie', '1:Bravo', '2:alpha', '4:Writing']);
  assert.deepEqual(order('production', 'desc'), ['2:alpha', '1:Bravo', '3:Charlie', '4:Writing']);
  const whatsapp = sortLeaderboardRows([{ name: 'A', production: 5, queueConnected: 1, closeRate: .1 }, { name: 'B', production: 9, queueConnected: 7, closeRate: 0 }], 'whatsapp', { field: 'calls', direction: 'desc' });
  assert.deepEqual(whatsapp.map(row => row.name), ['B', 'A']);
  const shopper = sortLeaderboardRows([{ name: 'A', submitted: 1, premium: 10, leads: 10 }, { name: 'B', submitted: 3, premium: 5, leads: 6 }], 'shopper', { field: 'closeRate', direction: 'desc' });
  assert.deepEqual(shopper.map(row => row.name), ['B', 'A']);
  assert.deepEqual(leaderboardSortFields('source').map(option => option.label), ['Rank', 'Source', 'Leads', 'Close rate', 'Submitted premium']);
  assert.deepEqual(leaderboardSortFields('whatsapp').at(-1).label, 'Total production');
});
test('agent search ignores case, accents and word order', () => {
  const rows = [{ name: 'José Álvarez' }, { name: 'Joseph King' }, { name: 'Ann Lee' }];
  assert.deepEqual(filterLeaderboardRows(rows, '  ALVAREZ ').map(row => row.name), ['José Álvarez']);
  assert.deepEqual(filterLeaderboardRows(rows, 'alvarez jos').map(row => row.name), ['José Álvarez']);
  assert.deepEqual(filterLeaderboardRows(rows, 'jos').length, 2);
  assert.equal(filterLeaderboardRows(rows, '').length, 3);
});
