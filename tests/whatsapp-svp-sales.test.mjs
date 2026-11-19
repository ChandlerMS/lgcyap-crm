import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { chatSaleLines, whatsappChatMessages, whatsappChatSales, WhatsappChatError } from '../lib/whatsapp-chat-sales.mjs';
import { importWhatsappSvpChat, readWhatsappSvpLeaderboard, WhatsappImportError } from '../lib/whatsapp-sales.mjs';
import { rankLeaderboardRows, leaderboardTotals } from '../app/leaderboard-data.mjs';

// Fictional chat in WhatsApp's export format. Names, numbers and amounts are synthetic.
const CHAT = [
  'Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.',
  '[7/6/26, 9:00:00 AM] Agent Alpha: $1,234.56 🦅 PT',
  '[7/6/26, 9:05:00 AM] Agent Alpha: $1,234.56  🦅 PT',
  '[7/6/26, 9:45:00 AM] Agent Alpha: $1,234.56 🦅 PT',
  '[7/6/26, 10:00:00 AM] Agent Bravo: His $1,000 Americo 8/1',
  'Hers $500.50 Americo 8/1',
  '',
  'Total $1,500.50',
  '[7/6/26, 10:30:00 AM] Agent Charlie: Total: $900',
  '[7/6/26, 11:00:00 AM] Agent Alpha: $6,500 on the day',
  '[7/6/26, 11:10:00 AM] Agent Delta: 1476 Amerioco',
  '[7/6/26, 11:20:00 AM] Agent Delta: $2.015.4 🧟 9/01',
  '[7/6/26, 11:30:00 AM] Agent Delta: 525$ Chubb',
  '[7/6/26, 11:35:00 AM] Agent Delta: $3002,76 Ethos PT <This message was edited>',
  '[7/6/26, 11:40:00 AM] Agent Echo: Call me at 407-555-0100 about the $40k month',
  '[7/6/26, 11:50:00 AM] Agent Echo: Lead cost is going up to $1,300/week.',
  '[7/6/26, 12:00:00 PM] - Agent Admin added Agent Foxtrot',
  '[7/6/26, 12:10:00 PM] Agent Echo: This message was deleted',
  '[7/7/26, 9:00:00 AM] agent alpha: $300 🐮 PT',
  '[7/7/26, 9:01:00 AM] Agent Bravo: 595.20 Ethos 7/20',
  '[7/7/26, 2:17:34 PM] Agent Foxtrot: Nice work today',
].join('\r\n');
const SHA = 'b'.repeat(64);
const NOW = Date.parse('2026-07-08T16:00:00Z');
const schema = await readFile(new URL('../migrations/0020_whatsapp_svp_sales.sql', import.meta.url), 'utf8');
async function database() { const db = new PGlite(); await db.exec(schema); await db.exec(schema); return db; }
const custom = (from, to) => ({ board: 'whatsapp-sp', period: 'custom', from, to });
const chatFrom = (lines, sha = SHA) => ({ ...whatsappChatSales(lines.join('\n')), sha256: sha });

test('chat parsing applies the sale-post rules: His/Hers, totals, reposts, typos, prose, phones and system lines', () => {
  const parsed = whatsappChatSales(CHAT);
  assert.equal(parsed.firstDate, '2026-07-06'); assert.equal(parsed.lastPostAt, '2026-07-07T14:17:34'); assert.equal(parsed.messages, 17);
  assert.deepEqual(parsed.days.map(({ date, key, sales, cents }) => [date, key, sales, cents]), [
    ['2026-07-06', 'agent alpha', 2, 246912],
    ['2026-07-06', 'agent bravo', 2, 150050],
    ['2026-07-06', 'agent charlie', 1, 90000],
    ['2026-07-06', 'agent delta', 4, 701916],
    ['2026-07-07', 'agent alpha', 1, 30000],
    ['2026-07-07', 'agent bravo', 1, 59520],
  ]);
  assert.equal(parsed.posts, 11);
  assert.deepEqual(chatSaleLines(['$1,200 his', '$800 hers', '= $2,000']).map(sale => sale.amount), [1200, 800]);
  assert.deepEqual(chatSaleLines(['Combined $2,000']).map(sale => sale.amount), [2000]);
  assert.deepEqual(chatSaleLines(['$750 3rd wed ethos']).map(sale => sale.amount), [750]);
  assert.deepEqual(chatSaleLines(['$40k month', '$9,000 for the week', 'she pays $120 a month']), []);
  assert.equal(whatsappChatMessages(CHAT).find(message => message.lines[0].includes('added')).sender, null);
});

test('a repost is the whole post again; a new post sharing one line still counts in full', () => {
  const parsed = whatsappChatSales([
    '[7/6/26, 9:00:00 AM] Agent Alpha: $500 His Ethos',
    '$300 Hers Ethos',
    '[7/6/26, 9:10:00 AM] Agent Alpha: $500 His Ethos',
    '$300 Hers Ethos',
    '[7/6/26, 9:20:00 AM] Agent Alpha: $500 His Ethos',
    '$700 Hers Ethos',
    '[7/6/26, 9:25:00 AM] Agent Alpha: $500 His Ethos',
  ].join('\n'));
  // 9:10 repeats 9:00 in full and counts once; 9:20 and 9:25 are different posts even though they share a line.
  assert.deepEqual(parsed.days.map(({ sales, cents }) => [sales, cents]), [[5, 250000]]);
});

test('chat errors name lines only, never chat text', () => {
  assert.throws(() => whatsappChatSales('Private Person: $500'), WhatsappChatError);
  assert.throws(() => whatsappChatSales('[2/30/26, 9:00:00 AM] Private Person: $500'), error => error instanceof WhatsappChatError && /Line 1/.test(error.message) && !/Private|500/.test(error.message));
});

test('the view ranks imported chat sales, marks the export cut-off and keeps Calls and Close empty', async () => {
  const db = await database();
  try {
    const result = await importWhatsappSvpChat(db, { ...whatsappChatSales(CHAT), sha256: SHA }, NOW);
    assert.deepEqual([result.coveredFrom, result.lastPostAt, result.salesRows, result.totalRows], ['2026-07-06', '2026-07-07T14:17:34', 6, 6]);
    const full = await readWhatsappSvpLeaderboard(custom('2026-07-06', '2026-07-07'), { db, now: NOW });
    assert.equal(full.status, 'available'); assert.equal(full.partial, true); assert.equal(full.dataThrough, '2026-07-07');
    assert.match(full.notice, /ends Jul 7, 2026 at 2:17 PM/); assert.match(full.notice, /no dialer calls/);
    assert.equal(full.fetchedAt, new Date(NOW).toISOString());
    assert.deepEqual(rankLeaderboardRows(full.rows, 'whatsapp-sp', 'ap').map(row => [row.name, row.sales, row.production]), [['Agent Delta', 4, 7019.16], ['agent alpha', 3, 2769.12], ['Agent Bravo', 3, 2095.7], ['Agent Charlie', 1, 900]]);
    assert.ok(full.rows.every(row => row.queueConnected === null && row.closeRate === null));
    assert.deepEqual([leaderboardTotals(full.rows, 'whatsapp-sp', 'ap').first, leaderboardTotals(full.rows, 'whatsapp-sp', 'ap').second], [11, 12783.98]);
    const firstDay = await readWhatsappSvpLeaderboard(custom('2026-07-06', '2026-07-06'), { db, now: NOW });
    assert.equal(firstDay.partial, false); assert.doesNotMatch(firstDay.notice, /ends/);
    const earlier = await readWhatsappSvpLeaderboard(custom('2026-07-01', '2026-07-05'), { db, now: NOW });
    assert.equal(earlier.partial, true); assert.deepEqual(earlier.rows, []); assert.match(earlier.notice, /starts Jul 6, 2026/);
  } finally { await db.close(); }
});

test('a newer export replaces only the days it covers; older or gapped exports are refused and change nothing', async () => {
  const db = await database();
  try {
    await importWhatsappSvpChat(db, { ...whatsappChatSales(CHAT), sha256: SHA }, NOW);
    const rows = async () => (await db.query("SELECT to_char(sale_date, 'YYYY-MM-DD') AS d, agent_key, sales, production_cents::integer AS cents FROM whatsapp_svp_sales_daily ORDER BY 1, 2")).rows.map(row => [row.d, row.agent_key, row.sales, row.cents]);
    const before = await rows();
    const older = chatFrom(['[7/6/26, 9:00:00 AM] Agent Alpha: $100 PT', '[7/7/26, 1:00:00 PM] Agent Alpha: $200 PT']);
    await assert.rejects(importWhatsappSvpChat(db, older, NOW), error => error instanceof WhatsappImportError && /before the posts already imported/.test(error.message));
    const gap = chatFrom(['[7/9/26, 9:00:00 AM] Agent Alpha: $100 PT']);
    await assert.rejects(importWhatsappSvpChat(db, gap, NOW), error => error instanceof WhatsappImportError && /gap/.test(error.message));
    // Starting mid-day on the last imported day: neither copy of 7/7 is whole, so it is refused rather than shrinking 7/7.
    const lastDay = chatFrom(['[7/7/26, 3:00:00 PM] Agent Golf: $100 PT', '[7/8/26, 6:00:00 PM] Agent Golf: $2,000 PT']);
    await assert.rejects(importWhatsappSvpChat(db, lastDay, NOW), error => error instanceof WhatsappImportError && /may be incomplete/.test(error.message));
    assert.deepEqual(await rows(), before);
    // A full export through 7/8 replaces everything it covers.
    const full = await importWhatsappSvpChat(db, chatFrom([CHAT, '[7/8/26, 6:00:00 PM] Agent Golf: $2,000 PT'], 'c'.repeat(64)), NOW + 1000);
    assert.deepEqual([full.replacedFrom, full.replacedThrough, full.totalRows], ['2026-07-06', '2026-07-08', 7]);
    // A phone that joined mid-day on 7/7 exports from there: its 7/7 lacks the morning posts, so the stored 7/7 is kept
    // and only 7/8 onward is replaced.
    const later = chatFrom(['[7/7/26, 10:00:00 AM] Agent Golf: $1,000 PT', '[7/8/26, 6:00:00 PM] Agent Golf: $2,000 PT', '[7/9/26, 5:00:00 PM] Agent Golf: $3,000 PT'], 'd'.repeat(64));
    const result = await importWhatsappSvpChat(db, later, NOW + 2000);
    assert.deepEqual([result.replacedFrom, result.replacedThrough, result.coveredFrom, result.salesRows, result.totalRows], ['2026-07-08', '2026-07-09', '2026-07-06', 2, 8]);
    assert.deepEqual(await rows(), [...before, ['2026-07-08', 'agent golf', 1, 200000], ['2026-07-09', 'agent golf', 1, 300000]]);
    const view = await readWhatsappSvpLeaderboard(custom('2026-07-06', '2026-07-09'), { db, now: NOW });
    assert.match(view.notice, /ends Jul 9, 2026 at 5:00 PM/);
    await assert.rejects(importWhatsappSvpChat(db, { ...later, sha256: 'nope' }, NOW), WhatsappImportError);
  } finally { await db.close(); }
});
