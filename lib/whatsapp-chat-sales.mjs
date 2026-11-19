// Sale posts in a WhatsApp group-chat export ("[M/D/YY, h:mm:ss AM] Sender: text").
// The rules are the ones that reproduced the LAP Daily Agent Reports from the main sales chat:
// - one sale per amount line, so His and Hers lines count separately;
// - "Total", "Both" and "=" lines are dropped when the message has other amounts, and kept when they are its only amount;
// - "on the day/week" and "day total" figures, "$40k"-style figures, amounts inside prose, dates and phone numbers are ignored;
// - an amount without "$" counts when it has cents, or starts the line next to His/Hers, a carrier or an emoji;
// - "$1.884.72", "$2.015.4" and "$3002,76" are read as typos for 1,884.72, 2,015.40 and 3,002.76, and "525$" as $525;
// - the poster is credited, and identical text from the same poster within 30 minutes counts once.

/** Messages name line numbers only, never chat text, names or amounts. */
export class WhatsappChatError extends Error { constructor(message) { super(message); this.name = 'WhatsappChatError'; } }

const HEADER = /^‎?\[(\d{1,2})\/(\d{1,2})\/(\d{2}), (\d{1,2}):(\d{2}):(\d{2})[\s ]?([AP]M)\] (.*)$/;
const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,3}\.\d{3}\.\d{1,2}|\d{3,5},\d{2}(?!\d)|\d+(?:\.\d{1,2})?)`;
// "$1,234.56", but not "$40k", "$2 mil" or "$5 grand".
const DOLLAR = new RegExp(String.raw`\$\s?${NUM}(?![\d,]*\d)(?!\s?[kK]\b)(?!\s?(?:mil|million|grand)\b)`, 'g');
// Dollar sign after the number: "525$ Chubb".
const TRAILING = new RegExp(String.raw`(?<![\d$.,])${NUM}\s?\$(?!\s?\d)`, 'g');
// A number with cents and no "$": "Ethos 595.20", "1,792.68 Americo PT".
const CENTS = /(?<![\d$.,/:-])(\d{1,3}(?:,\d{3})+\.\d{1,2}|\d{3,5}\.\d{1,2})(?![\d/%]|[.,]\d)/;
// A whole number with no "$" at the start of a line: "597 Hers", "Hers 1,763".
const LEADING = /^\s*(?:(?:his|hers|her|him|mr|mrs)\s*[:-]?\s*)?(\d{1,3}(?:,\d{3})+|\d{3,5})(?=\s|$)(?!\s*[-./]?\s*\d)/i;
const SALE_WORD = /\b(?:his|hers|her|him|mr|mrs|ethos|ameri[a-z]*co|aetna|aflac|banner|chubb|corebridge|core|trustage|tru|transamerica|moo|mutual|royal|ahl|giwl|siwl|wl|pt|ptd)\b|[\u{1F300}-\u{1FAFF}]/iu;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]{0,2}\d{3}[\s.-]?\d{4}\b|\b\d{10,11}\b/g;
const DATE = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g;
const TOTAL = /\btotals?\b|^\s*=|\bboth\b/i;
const PERIOD_TOTAL = /\b(?:on|for) the (?:day|week|month)\b|\b(?:day|daily|week|weekly|month|monthly) total\b|\bmtd\b|\bwtd\b|\bytd\b/i;
const ORDINAL_WEEK = /\b(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|last)\s+(?:wed|wednesday|week)/i;
const SKIP = /this message was deleted|<media omitted>|null$/i;
// Words that may come before an amount on a sale line; anything else must be short and not read as prose.
const ALLOWED = new Set(`his hers her him mr mrs ms husband wife pt ptd st nd rd th wed weds wens wednesday third fourth first second of the
month sale sold another new life neighbors neighbor home american omaha mutual fe wl giwl siwl gi si core bridge corebridge corbridge
ethos americo aetna aflac banner chubb chubbs trustage tru trans transamerica moo royal ahl combined approved policy policies
follow up followup callback call back referral`.split(/\s+/));
const PROSE = /\b(?:pays?|paying|paid|was|is|has|had|have|for|about|over|under|like|than|at|only|just|that|check|cost|costs|owe|owes|save|saved|saving|want|wants|get|got|need|needs|said|says|if|when|would|could|should)\b/i;
const MIN_SALE = 100, MAX_SALE = 50000, REPOST_SECONDS = 1800;

function amountValue(text) {
  let value = text;
  if (/^\d{1,3}\.\d{3}\.\d{1,2}$/.test(value)) { const [a, b, c] = value.split('.'); value = `${a}${b}.${c}`; }
  if (/^\d{3,5},\d{2}$/.test(value)) value = value.replace(',', '.');
  return Number(value.replaceAll(',', ''));
}
const inRange = value => value >= MIN_SALE && value < MAX_SALE;
const clean = line => line.replaceAll('<image omitted>', ' ').replaceAll('<This message was edited>', ' ').replace(/[‎‏‪-‮]/g, '').replace(PHONE, ' ');

function prefixOk(prefix) {
  const words = (prefix.match(/[A-Za-z']+/g) ?? []).map(word => word.toLowerCase());
  if (!words.length || words.every(word => ALLOWED.has(word))) return true;
  return words.length <= 2 && !PROSE.test(prefix);
}

/** Sale amounts on one line of a message. */
function lineAmounts(raw) {
  const line = clean(raw), amounts = [];
  for (const match of [...line.matchAll(DOLLAR), ...line.matchAll(TRAILING)]) {
    const value = amountValue(match[1]);
    if (inRange(value) && prefixOk(line.slice(0, match.index))) amounts.push(value);
  }
  if (amounts.length || line.includes('$')) return amounts;
  const undated = line.replace(DATE, ' ');
  const cents = CENTS.exec(undated);
  if (cents && prefixOk(undated.slice(0, cents.index)) && (undated.match(/[A-Za-z]+/g) ?? []).length <= 8) {
    const value = amountValue(cents[1]);
    if (inRange(value)) return [value];
  }
  const leading = LEADING.exec(undated);
  if (leading && SALE_WORD.test(line)) {
    const value = amountValue(leading[1]);
    if (inRange(value)) return [value];
  }
  return [];
}

/** The sale amounts in one message's lines, after dropping totals and day or week summaries. */
export function chatSaleLines(lines) {
  if (SKIP.test(lines.join(' '))) return [];
  const sales = [], totals = [];
  for (const line of lines) {
    const amounts = lineAmounts(line);
    if (!amounts.length) continue;
    const text = clean(line);
    if (PERIOD_TOTAL.test(text) && !ORDINAL_WEEK.test(text)) continue;
    (TOTAL.test(text) ? totals : sales).push(...amounts.map(amount => ({ amount, line })));
  }
  return sales.length ? sales : totals;
}

const pad = value => String(value).padStart(2, '0');
const senderName = value => value.replace(/[‎‏‪-‮]/g, '').replace(/^~\s*/, '').replace(/\s+/g, ' ').trim();

/** Messages in a WhatsApp chat export, with chat-local times. System lines ("X added Y") have no sender. */
export function whatsappChatMessages(text) {
  if (typeof text !== 'string') throw new WhatsappChatError('The chat export must be text.');
  const messages = [];
  text.replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach((raw, index) => {
    const header = HEADER.exec(raw);
    if (!header) { messages.at(-1)?.lines.push(raw); return; }
    const [, month, day, year, hour, minute, second, half, rest] = header;
    const parts = [2000 + Number(year), Number(month), Number(day), Number(hour) % 12 + (half === 'PM' ? 12 : 0), Number(minute), Number(second)];
    const stamp = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
    if (stamp.getUTCMonth() !== parts[1] - 1 || stamp.getUTCDate() !== parts[2] || Number(hour) < 1 || Number(hour) > 12 || parts[4] > 59 || parts[5] > 59) throw new WhatsappChatError(`Line ${index + 1}: the message time is not a real date and time.`);
    const named = rest.includes(': ') && !rest.startsWith('- ');
    const sender = named ? senderName(rest.slice(0, rest.indexOf(': '))) : null;
    messages.push({ index: messages.length, seconds: stamp.getTime() / 1000, date: `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}`, at: `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}T${pad(parts[3])}:${pad(parts[4])}:${pad(parts[5])}`, sender: sender || null, lines: [named ? rest.slice(rest.indexOf(': ') + 2) : rest] });
  });
  return messages;
}

/**
 * Daily sales per poster in a chat export. Days follow the chat's own clock (the exporting phone's time zone).
 * Returns the export's first and last message so an import can replace exactly the days it covers.
 */
export function whatsappChatSales(text) {
  const messages = whatsappChatMessages(text);
  if (!messages.length) throw new WhatsappChatError('No WhatsApp messages were found. Export the chat without media and pass its .txt file.');
  const seen = new Map(), days = new Map();
  let posts = 0, firstAt = messages[0].at, lastAt = messages[0].at;
  for (const message of messages) {
    if (message.at < firstAt) firstAt = message.at;
    if (message.at > lastAt) lastAt = message.at;
    if (!message.sender) continue;
    if (message.sender.length > 200) throw new WhatsappChatError(`Message ${message.index + 1}: the sender name is longer than 200 characters.`);
    for (const { amount, line } of chatSaleLines(message.lines)) {
      const key = `${message.sender}\u0000${clean(line).replace(/\s+/g, ' ').trim().toLowerCase()}`;
      const earlier = seen.get(key) ?? [];
      if (earlier.some(post => Math.abs(post.amount - amount) < 0.005 && post.index !== message.index && message.seconds - post.seconds >= 0 && message.seconds - post.seconds <= REPOST_SECONDS)) continue;
      earlier.push({ amount, index: message.index, seconds: message.seconds });
      seen.set(key, earlier);
      posts += 1;
      const agentKey = message.sender.toLowerCase(), dayKey = `${message.date}|${agentKey}`;
      const entry = days.get(dayKey) ?? { date: message.date, key: agentKey, name: message.sender, sales: 0, cents: 0 };
      entry.sales += 1; entry.cents += Math.round(amount * 100);
      days.set(dayKey, entry);
    }
  }
  const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  return { firstDate: firstAt.slice(0, 10), lastPostAt: lastAt, messages: messages.length, posts, days: rows };
}
