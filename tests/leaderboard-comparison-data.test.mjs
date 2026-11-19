import test from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../app/leaderboard-data.mjs';
const available = (board, rows) => ({ board, status: 'available', rows, source: board });
test('All uses policies sold and annual premium consistently in ranking, sorting and CSV', () => {
  assert.equal(data.LEADERBOARD_BOARDS[0].id, 'all');
  const rows = [{ name: 'A', sales: 3, annualPremium: 600, inboundCalls: 20, soldPerInboundLog: .15 }];
  assert.equal(data.leaderboardTotals(rows, 'all').first, 3);
  assert.equal(data.leaderboardTotals(rows, 'all').second, 600);
  assert.equal(data.leaderboardSortValue(rows[0], 'all', 'calls'), 20);
  assert.match(data.leaderboardCsv(rows, 'all'), /Sales,Calls \/ leads,Sales \/ activity,Annual premium/);
  assert.match(data.leaderboardCsv([{ ...rows[0], annualPremium: -12.34 }], 'all'), /,-12\.34\r\n$/, 'negative premium adjustments remain numeric in exports');
});
test('comparison matches only case and whitespace variants, preserves separate accents and unknown attribution', () => {
  const left = available('shopper', [{ name: ' Ana  Lee ', submitted: 3, premium: 100.1 }, { name: 'José', submitted: 1, premium: 60 }, { name: 'No name', attributed: false, submitted: 2, premium: 70 }]);
  const right = available('whatsapp', [{ name: 'ANA LEE', sales: 5, production: 200.2 }, { name: 'Jose', sales: 1, production: 80 }, { name: 'No name', attributed: false, sales: 4, production: 90 }]);
  const rows = data.leaderboardComparisonRows(left, right);
  assert.equal(rows.length, 5);
  const ana = rows.find(row => row.name === 'Ana Lee');
  assert.deepEqual(ana.left, { sales: 3, premium: 100.1 }); assert.deepEqual(ana.right, { sales: 5, premium: 200.2 });
  assert.equal(rows.find(row => row.name === 'José').right, null);
  assert.equal(rows.find(row => row.name === 'Jose').left, null);
  assert.equal(rows.filter(row => row.name === 'No name').length, 2);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'same display names retain distinct row identities');
  const sorted = data.leaderboardComparisonRows(left, right, 'sales', '', { field: 'name', direction: 'asc' });
  assert.deepEqual(new Set(sorted.map(row => row.id)), new Set(rows.map(row => row.id)), 'row identities survive sorting');
  assert.equal(data.leaderboardComparisonRows(left, right, 'ap', 'ANA lee').length, 1);
});
test('agent names drop start-month and city labels and use only listed pairs, never guesses', async () => {
  const { agentNameKey, AGENT_NAME_ALIASES } = await import('../lib/agent-names.mjs');
  assert.equal(agentNameKey('Sample Agent January 2026'), 'sample agent');
  assert.equal(agentNameKey('  Sample  Agent March 26 '), 'sample agent');
  assert.equal(agentNameKey('Sample Agent Feb'), 'sample agent');
  assert.equal(agentNameKey('Sample Agent TPA'), 'sample agent');
  assert.equal(agentNameKey('Sample Agent Miami'), 'sample agent');
  assert.equal(agentNameKey('Sample May'), 'sample may', 'a label is kept when it would leave one word');
  assert.equal(agentNameKey('Sample Agent Junior'), 'sample agent junior');
  assert.notEqual(agentNameKey('José Sample'), agentNameKey('Jose Sample'), 'accents are not folded');
  assert.notEqual(agentNameKey('Sam Sample'), agentNameKey('Samuel Sample'), 'nicknames need a listed pair');
  for (const [alias, canonical] of AGENT_NAME_ALIASES) {
    assert.equal(alias, alias.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase(), 'pairs are stored as normalized keys');
    assert.equal(agentNameKey(alias), canonical);
    assert.equal(AGENT_NAME_ALIASES.has(canonical), false, 'a canonical name is never itself an alias');
  }
});
test('listed pairs and labels line WhatsApp names up with HubSpot and PolicyTek rows, showing both spellings', async () => {
  const { AGENT_NAME_ALIASES } = await import('../lib/agent-names.mjs');
  const [alias, canonical] = [...AGENT_NAME_ALIASES][0];
  const title = value => value.replace(/\b\p{L}/gu, letter => letter.toUpperCase());
  const left = available('sp', [{ name: title(canonical), sales: 2, annualPremium: 300 }, { name: 'Sample Agent', sales: 1, annualPremium: 100 }]);
  const right = available('whatsapp-sp', [{ name: title(alias), sales: 3, production: 450.5 }, { name: 'Sample Agent January 2026', sales: 4, production: 500 }, { name: 'Sample Agent TPA', sales: 1, production: 50 }]);
  const rows = data.leaderboardComparisonRows(left, right, 'ap');
  assert.equal(rows.length, 2);
  const paired = rows.find(row => row.id === `named:${canonical}`);
  assert.equal(paired.name, `${title(canonical)} (${title(alias)})`);
  assert.deepEqual([paired.left, paired.right], [{ sales: 2, premium: 300 }, { sales: 3, premium: 450.5 }]);
  const labeled = rows.find(row => row.id === 'named:sample agent');
  assert.equal(labeled.name, 'Sample Agent (Sample Agent January 2026, Sample Agent TPA)');
  assert.deepEqual(labeled.right, { sales: 5, premium: 550 });
  assert.equal(data.leaderboardComparisonRows(left, right, 'ap', title(alias)).length, 1, 'search finds the row by either spelling');
});
test('missing source data and financial values remain unavailable and money sums exactly to cents', () => {
  const left = available('sp', [{ name: 'A', sales: 1, annualPremium: .1 }, { name: 'a', sales: 2, annualPremium: .2 }, { name: 'B', sales: 1, annualPremium: null }, { name: 'C', sales: 1, annualPremium: -50 }]);
  const right = { board: 'whatsapp-sp', status: 'unavailable', rows: [{ name: 'A', sales: 500, production: 999 }] };
  const original = structuredClone(left);
  const rows = data.leaderboardComparisonRows(left, right, 'ap');
  assert.deepEqual(rows.find(row => row.name === 'A').left, { sales: 3, premium: .3 });
  assert.equal(rows.find(row => row.name === 'B').left.premium, null);
  assert.equal(rows.find(row => row.name === 'C').left.premium, -50);
  assert.ok(rows.every(row => row.right === null)); assert.deepEqual(left, original);
});
test('comparison CSV retains paired source columns, blanks for missing numbers and literal names', () => {
  const csv = data.leaderboardComparisonCsv([{ name: '=unsafe', left: { sales: 3, premium: -10.25 }, right: null }], 'HubSpot', 'WhatsApp');
  assert.equal(csv, "Agent,HubSpot policies sold,HubSpot annual premium,WhatsApp policies sold,WhatsApp annual premium\r\n'=unsafe,3,-10.25,,\r\n");
});
