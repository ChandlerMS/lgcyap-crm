// Imports "LAP Daily Agent Report - YYYY-MM Month.xlsx" workbooks into the WhatsApp Sales leaderboard.
// usage: node scripts/whatsapp-import.mjs <folder or .xlsx files...> [--apply]
// Without --apply nothing is written; the files are validated and summarized. Output never includes agent names or amounts.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import readExcelFile from 'read-excel-file/node';
import { getPool } from '../db/pool.mjs';
import { importWhatsappReports, parseWhatsappReport, whatsappReportMonth, WhatsappImportError } from '../lib/whatsapp-sales.mjs';

const apply = process.argv.includes('--apply');
const targets = process.argv.slice(2).filter(arg => arg !== '--apply');

async function reportFiles() {
  const files = [];
  for (const target of targets) {
    if ((await stat(target)).isDirectory()) files.push(...(await readdir(target)).filter(file => /^LAP Daily Agent Report - .*\.xlsx$/.test(file)).map(file => path.join(target, file)));
    else files.push(target);
  }
  return files.sort((a, b) => whatsappReportMonth(path.basename(a)).localeCompare(whatsappReportMonth(path.basename(b))));
}

async function readReport(file) {
  const bytes = await readFile(file);
  const sheets = Object.fromEntries((await readExcelFile(bytes)).map(({ sheet, data }) => [sheet, data]));
  return parseWhatsappReport({ fileName: path.basename(file), sha256: createHash('sha256').update(bytes).digest('hex'), agentDetail: sheets['Agent Detail'], queueCallData: sheets['Queue Call Data'] ?? null });
}

/** Asks for the connection string without echoing it; kept in memory for this run only. Accepts a bare URL or a pasted DATABASE_URL="…" line. */
async function askConnectionString() {
  if (!process.stdin.isTTY) throw new WhatsappImportError('DATABASE_URL is not set. Run this in a terminal to paste the connection string when asked.');
  const { createInterface } = await import('node:readline');
  const prompt = 'Paste the database connection string (it will not be shown), then press Enter: ';
  process.stdout.write(prompt);
  const lines = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  lines._writeToOutput = () => {};
  // A pasted multi-line snippet arrives as several lines at once: keep the first DATABASE_URL (or any postgres URL),
  // then swallow the rest of the paste so none of it reaches the shell after this script exits.
  return new Promise((resolve, reject) => {
    let found = null, settle = null;
    lines.on('line', line => {
      const preferred = /^\s*(?:export\s+)?DATABASE_URL\s*=/.test(line), url = line.match(/postgres(?:ql)?:\/\/[^\s"']+/)?.[0];
      if (url && (!found || (preferred && !found.preferred))) found = { url, preferred };
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (found) { lines.close(); process.stdout.write('\nConnection string received.\n'); resolve(found.url); }
        else process.stdout.write(`\nThat did not contain a postgres:// connection string. ${prompt}`);
      }, 800);
    });
    lines.on('close', () => { clearTimeout(settle); if (!found) reject(new WhatsappImportError('No connection string was entered.')); });
  });
}

let pool, client;
try {
  if (!targets.length) throw new WhatsappImportError('Name a folder or one or more report files.');
  const files = await reportFiles();
  if (!files.length) throw new WhatsappImportError('No "LAP Daily Agent Report - *.xlsx" files were found.');
  const reports = [];
  for (const file of files) {
    const report = await readReport(file);
    reports.push(report);
    console.log(`${report.month}  agent-days ${String(report.sales.length).padStart(5)}  queue rows ${String(report.queue.length).padStart(5)}  latest activity ${report.lastActivityDate ?? '—'}`);
  }
  if (!apply) {
    console.log(`Validated ${reports.length} monthly reports. No database was changed. Re-run with --apply to import them.`);
  } else {
    nextEnv.loadEnvConfig(process.cwd());
    if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) process.env.DATABASE_URL = await askConnectionString();
    pool = getPool();
    client = await pool.connect();
    await client.query(await readFile(new URL('../migrations/0006_whatsapp_sales.sql', import.meta.url), 'utf8'));
    const result = await importWhatsappReports(client, reports);
    console.log(`Imported ${result.months.length} months (${result.salesRows} agent-days, ${result.queueRows} queue rows) at ${result.importedAt}. Other months were not changed.`);
  }
} catch (error) {
  console.error(error instanceof WhatsappImportError ? `Import stopped: ${error.message}` : 'Import failed. Nothing was committed. Check the files and database configuration; credentials were not logged.');
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end();
}
