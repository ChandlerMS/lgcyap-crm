// Imports a WhatsApp export of the Standard vs Preferred group chat into the WhatsApp Sales "Standard vs Preferred" view.
// usage: node scripts/whatsapp-svp-import.mjs <chat .txt file> [--apply]
// Without --apply nothing is written; the export is parsed and summarized. Output never includes chat text, names or amounts.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import nextEnv from '@next/env';
import { getPool } from '../db/pool.mjs';
import { askConnectionString, ConnectionStringError } from './connection-string.mjs';
import { whatsappChatSales, WhatsappChatError } from '../lib/whatsapp-chat-sales.mjs';
import { importWhatsappSvpChat, WhatsappImportError } from '../lib/whatsapp-sales.mjs';

const apply = process.argv.includes('--apply');
const targets = process.argv.slice(2).filter(arg => arg !== '--apply');

let pool, client;
try {
  if (targets.length !== 1 || !/\.txt$/i.test(targets[0])) throw new WhatsappImportError('Name one chat export .txt file (unzip the WhatsApp export first).');
  const bytes = await readFile(targets[0]);
  const chat = { ...whatsappChatSales(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') };
  const sales = chat.days.reduce((total, row) => total + row.sales, 0), posters = new Set(chat.days.map(row => row.key)).size;
  console.log(`Messages ${chat.messages} from ${chat.firstDate} to ${chat.lastPostAt.replace('T', ' ')} (chat time). Sales ${sales} on ${new Set(chat.days.map(row => row.date)).size} days, ${chat.days.length} agent-days, ${posters} posters.`);
  if (!apply) {
    console.log('No database was changed. Re-run with --apply to import it.');
  } else {
    nextEnv.loadEnvConfig(process.cwd());
    if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) process.env.DATABASE_URL = await askConnectionString();
    pool = getPool();
    client = await pool.connect();
    await client.query(await readFile(new URL('../migrations/0020_whatsapp_svp_sales.sql', import.meta.url), 'utf8'));
    const result = await importWhatsappSvpChat(client, chat);
    console.log(`Imported ${result.salesRows} agent-days, replacing ${result.replacedFrom} to ${result.replacedThrough}. The view now covers ${result.coveredFrom} to ${result.lastPostAt.replace('T', ' ')} (${result.totalRows} agent-days) as of ${result.importedAt}.`);
  }
} catch (error) {
  console.error(error instanceof WhatsappImportError || error instanceof WhatsappChatError || error instanceof ConnectionStringError ? `Import stopped: ${error.message}` : 'Import failed. Nothing was committed. Check the file and database configuration; credentials were not logged.');
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end();
}
