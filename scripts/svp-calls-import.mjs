// Imports "Agent_Daily_Calls_YYYY-MM_Month_YYYY.xlsx" workbooks into the Standard vs. Preferred Calls and Close metrics.
// usage: node scripts/svp-calls-import.mjs <folder or .xlsx files...> [--apply]
// Without --apply nothing is written; the files are validated and summarized. Output never includes agent names.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import readExcelFile from 'read-excel-file/node';
import { getPool } from '../db/pool.mjs';
import { askConnectionString, ConnectionStringError } from './connection-string.mjs';
import { importSvpCallsReports, parseSvpCallsReport, svpCallsReportMonth, SvpCallsImportError } from '../lib/svp-calls.mjs';

const apply = process.argv.includes('--apply');
const targets = process.argv.slice(2).filter(arg => arg !== '--apply');

async function reportFiles() {
  const files = [];
  for (const target of targets) {
    if ((await stat(target)).isDirectory()) files.push(...(await readdir(target)).filter(file => /^Agent_Daily_Calls_.*\.xlsx$/.test(file)).map(file => path.join(target, file)));
    else files.push(target);
  }
  return files.sort((a, b) => svpCallsReportMonth(path.basename(a)).localeCompare(svpCallsReportMonth(path.basename(b))));
}

let pool, client;
try {
  if (!targets.length) throw new SvpCallsImportError('Name a folder or one or more Agent_Daily_Calls files.');
  const files = await reportFiles();
  if (!files.length) throw new SvpCallsImportError('No "Agent_Daily_Calls_*.xlsx" files were found.');
  const reports = [];
  for (const file of files) {
    const bytes = await readFile(file);
    const report = parseSvpCallsReport({ fileName: path.basename(file), sha256: createHash('sha256').update(bytes).digest('hex'), sheets: await readExcelFile(bytes) });
    reports.push(report);
    console.log(`${report.month}  ${report.firstDate} → ${report.lastDate}  days ${String(report.days).padStart(2)}  agent-days ${String(report.calls.length).padStart(5)}  calls ${report.calls.reduce((total, row) => total + row.connected, 0)}`);
  }
  if (!apply) {
    console.log(`Validated ${reports.length} monthly call reports. No database was changed. Re-run with --apply to import them.`);
  } else {
    nextEnv.loadEnvConfig(process.cwd());
    if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) process.env.DATABASE_URL = await askConnectionString();
    pool = getPool();
    client = await pool.connect();
    await client.query(await readFile(new URL('../migrations/0007_svp_calls.sql', import.meta.url), 'utf8'));
    const result = await importSvpCallsReports(client, reports);
    console.log(`Imported ${result.months.length} months (${result.rows} agent-days) at ${result.importedAt}. Other months were not changed.`);
  }
} catch (error) {
  console.error(error instanceof SvpCallsImportError || error instanceof ConnectionStringError ? `Import stopped: ${error.message}` : 'Import failed. Nothing was committed. Check the files and database configuration; credentials were not logged.');
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end();
}
