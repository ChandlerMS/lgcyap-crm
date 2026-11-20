// Imports "LAP Daily Agent Report - YYYY-MM Month.xlsx" workbooks into the WhatsApp Sales leaderboard.
// usage: node scripts/whatsapp-import.mjs <folder or .xlsx files...> [--apply]
// Without --apply nothing is written; the files are validated and summarized. Output never includes agent names or amounts.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import readExcelFile from 'read-excel-file/node';
import { getPool } from '../db/pool.mjs';
import { askConnectionString, ConnectionStringError } from './connection-string.mjs';
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
  console.error(error instanceof WhatsappImportError || error instanceof ConnectionStringError ? `Import stopped: ${error.message}` : 'Import failed. Nothing was committed. Check the files and database configuration; credentials were not logged.');
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end();
}
