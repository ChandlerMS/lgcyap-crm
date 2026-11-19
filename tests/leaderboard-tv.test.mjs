import test from 'node:test';
import assert from 'node:assert/strict';
import { TV_DEFAULTS, tvBoardLabel, tvConfig, tvSlide } from '../app/leaderboard-tv/tv-model.mjs';
import { rowLimitHeight } from '../app/row-limit.mjs';

test('TV settings come from the link and fall back to safe defaults', () => {
  const defaults = tvConfig('');
  assert.deepEqual(defaults.boards, TV_DEFAULTS.boards);
  assert.deepEqual(defaults.periods, ['day']);
  assert.equal(defaults.seconds, 20);
  assert.equal(defaults.rows, 10);
  assert.deepEqual(defaults.slides.map(slide => slide.key), ['sp:day', 'shopper:day', 'whatsapp:day']);
  const custom = tvConfig('?boards=Shopper,sp,bogus,sp&periods=day,month&seconds=3&rows=40');
  assert.deepEqual(custom.slides.map(slide => slide.key), ['shopper:day', 'shopper:month', 'sp:day', 'sp:month']);
  assert.equal(custom.seconds, 8);
  assert.equal(custom.rows, 15);
  assert.deepEqual(tvConfig('board=source&period=week').slides.map(slide => slide.key), ['source:week']);
  assert.deepEqual(tvConfig('boards=nothing&periods=year').slides.map(slide => slide.key), ['sp:day', 'shopper:day', 'whatsapp:day']);
  assert.equal(tvBoardLabel('sp'), 'Standard vs. Preferred');
});

test('a slide ranks by premium, keeps unattributed rows out, and shows the CRM totals', () => {
  const rows = [
    { name: 'Agent B', sales: 2, annualPremium: 2400 },
    { name: 'Agent A', sales: 3, annualPremium: 5100 },
    { name: 'No agent', attributed: false, sales: 1, annualPremium: 900 },
    { name: 'Agent C', sales: 0, annualPremium: 0 },
  ];
  const slide = tvSlide({ status: 'available', rows, calls: { total: 40, soldPerInboundLog: 0.15 }, fetchedAt: '2026-11-18T22:00:00.000Z' }, 'sp', 10);
  assert.equal(slide.available, true);
  assert.deepEqual(slide.rows, [{ rank: 1, name: 'Agent A', value: 5100, count: 3 }, { rank: 2, name: 'Agent B', value: 2400, count: 2 }]);
  assert.equal(slide.max, 5100);
  assert.deepEqual(slide.stats.map(stat => [stat.label, stat.value]), [['Policies sold', 6], ['Annual premium', 8400], ['Close rate', 0.15], ['Calls', 40]]);
  assert.equal(slide.valueLabel, 'Annual premium');
  // Shopper uses the PolicyTek report totals and its leads for calls and close rate.
  const shopper = tvSlide({ status: 'available', rows: [{ name: 'Agent A', submitted: 2, premium: 3000, leads: 10 }], reportTotals: { submitted: 4, premium: 6000, leads: 20, spend: 0 } }, 'shopper', 10);
  assert.deepEqual(shopper.stats.map(stat => [stat.label, stat.value]), [['Submitted', 4], ['Submitted premium', 6000], ['Close rate', 0.2], ['Calls', 20]]);
});

test('a slide shows at most the configured rows and says how many more there are', () => {
  const rows = Array.from({ length: 13 }, (_, index) => ({ name: `Agent ${index}`, sales: 1, annualPremium: 1000 + index }));
  const slide = tvSlide({ status: 'available', rows }, 'sp', 10);
  assert.equal(slide.rows.length, 10);
  assert.equal(slide.more, 3);
  assert.equal(slide.rows[0].name, 'Agent 12');
});

test('an unavailable board explains itself instead of showing zeros', () => {
  assert.deepEqual(tvSlide({ status: 'connection-required', rows: [], error: { message: 'Connect PolicyTek.' } }, 'shopper'), { available: false, message: 'Connect PolicyTek.' });
  assert.equal(tvSlide(null, 'whatsapp').available, false);
});

test('dashboard panels size to exactly ten rows, measured from the real rows', () => {
  const rect = (top, bottom) => ({ top, bottom });
  const rows = heights => { let y = 155; return heights.map(height => { const top = y; y += height; return { getBoundingClientRect: () => rect(top, top + height) }; }); };
  const wrap = body => ({ clientTop: 0, scrollTop: 0, getBoundingClientRect: () => rect(100, 450), querySelectorAll: () => body });
  // A 55px header and varied rows: the panel ends right after the tenth row.
  const tall = rows([94, 73, 50, 94, 73, 92, 50, 73, 94, 85, 73, 50]);
  assert.equal(rowLimitHeight(wrap(tall), 10), 55 + 94 + 73 + 50 + 94 + 73 + 92 + 50 + 73 + 94 + 85 + 1);
  // Ten rows or fewer never scroll.
  assert.equal(rowLimitHeight(wrap(rows([50, 50, 50])), 10), null);
  // Measuring while scrolled gives the same answer.
  const scrolled = rows([50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50]).map(row => ({ getBoundingClientRect: () => { const { top, bottom } = row.getBoundingClientRect(); return rect(top - 120, bottom - 120); } }));
  assert.equal(rowLimitHeight({ ...wrap(scrolled), scrollTop: 120 }, 10), 55 + 500 + 1);
});
