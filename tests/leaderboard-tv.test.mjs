import test from 'node:test';
import assert from 'node:assert/strict';
import { TV_BOARD_PAGES, TV_BOARDS, TV_DEFAULTS, tvBoardLabel, tvConfig, tvSearch, tvSlide } from '../app/leaderboard-tv/tv-model.mjs';

test('TV settings come from the link and fall back to safe defaults', () => {
  const defaults = tvConfig('');
  assert.deepEqual(defaults.boards, TV_DEFAULTS.boards);
  assert.deepEqual(defaults.periods, ['day']);
  assert.equal(defaults.seconds, 20);
  assert.equal(defaults.rows, 10);
  assert.deepEqual(defaults.slides.map(slide => slide.key), ['sp:day', 'shopper:day']);
  const custom = tvConfig('?boards=Shopper,sp,bogus,sp&periods=day,month&seconds=3&rows=40');
  assert.deepEqual(custom.slides.map(slide => slide.key), ['shopper:day', 'shopper:month', 'sp:day', 'sp:month']);
  assert.equal(custom.seconds, 8);
  assert.equal(custom.rows, 15);
  assert.deepEqual(tvConfig('board=source&period=week').slides.map(slide => slide.key), ['source:week']);
  assert.deepEqual(tvConfig('boards=nothing&periods=year').slides.map(slide => slide.key), ['sp:day', 'shopper:day']);
  assert.equal(tvBoardLabel('sp'), 'Standard vs. Preferred');
});

test('WhatsApp Sales is not a TV board, even when a link asks for it', () => {
  assert.deepEqual(TV_BOARDS, ['sp', 'shopper', 'source']);
  assert.deepEqual(tvConfig('boards=whatsapp').slides.map(slide => slide.key), ['sp:day', 'shopper:day']);
  assert.deepEqual(tvConfig('boards=whatsapp,shopper').slides.map(slide => slide.key), ['shopper:day']);
  assert.equal(tvConfig('', 'whatsapp').boards.join(), 'sp,shopper');
});

test('/standard and /shopper each show one board; their links may still choose periods', () => {
  assert.deepEqual(TV_BOARD_PAGES, { standard: 'sp', shopper: 'shopper' });
  assert.deepEqual(tvConfig('', 'sp').slides.map(slide => slide.key), ['sp:day']);
  // The page's board wins over a boards option in its link.
  assert.deepEqual(tvConfig('boards=shopper,source&periods=day,month&seconds=45', 'sp').slides.map(slide => slide.key), ['sp:day', 'sp:month']);
  assert.deepEqual(tvConfig('', 'shopper').slides.map(slide => slide.key), ['shopper:day']);
  // Only the TV options are kept from a page's search params.
  assert.equal(tvSearch({ periods: 'day,month', seconds: '30', utm: 'x', rows: '<script>', boards: ['a', 'b'] }), 'periods=day%2Cmonth&seconds=30');
  assert.equal(tvSearch({}), '');
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
  assert.deepEqual(tvSlide(null, 'shopper'), { available: false, message: 'This leaderboard is not available right now.' });
});
