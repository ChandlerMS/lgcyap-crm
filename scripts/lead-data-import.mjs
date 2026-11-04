// Imports the "Instant Hangups - Daily Totals" and "Short Duration Calls - Daily Totals" workbooks into Lead Data's RingCentral numbers.
// usage: node scripts/lead-data-import.mjs <workbook.xlsx> <workbook.xlsx> [--apply]
// Without --apply nothing is written; the files are validated and summarized. Output never includes agent names or caller details.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import readExcelFile from 'read-excel-file/node';
import { getPool } from '../db/pool.mjs';
import { askConnectionString, ConnectionStringError } from './connection-string.mjs';
import { importLeadDataWorkbooks, LeadDataImportError, leadDataWorkbookDays, parseLeadDataWorkbook } from '../lib/lead-data-workbooks.mjs';

const apply = process.argv.includes('--apply');
const targets = process.argv.slice(2).filter(arg => arg !== '--apply');

let pool, client;
try {
  if (targets.length !== 2) throw new LeadDataImportError('Name both workbooks: Instant Hangups and Short Duration Calls.');
  const workbooks = [];
  for (const file of targets) workbooks.push(parseLeadDataWorkbook({ fileName: path.basename(file), sheets: await readExcelFile(await readFile(file)) }));
  const days = leadDataWorkbookDays(workbooks);
  const dates = days.map(day => day.date).sort(), total = field => days.reduce((sum, day) => sum + day[field], 0);
  console.log(`${dates[0]} → ${dates.at(-1)}  agent-days ${days.length}  Instant Disconnects ${total('instantDisconnects')}  Short Duration Calls ${total('shortDuration')}`);
  if (!apply) {
    console.log('Validated both workbooks. No database was changed. Re-run with --apply to import them.');
  } else {
    nextEnv.loadEnvConfig(process.cwd());
    if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) process.env.DATABASE_URL = await askConnectionString();
    pool = getPool();
    client = await pool.connect();
    for (const file of ['0011_lead_data.sql', '0012_lead_data_workbooks.sql']) await client.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    const result = await importLeadDataWorkbooks(client, days);
    console.log(`Imported ${result.rows} agent-days. Other dates were not changed.`);
    console.log(`The RingCX reports hold Instant Disconnects ${result.reports.instantDisconnects} and Short Duration Calls ${result.reports.shortDuration} over the same dates; ${result.differingAgentDays} agent-days differ. The page keeps the reports' count for any date they have.`);
  }
} catch (error) {
  console.error(error instanceof LeadDataImportError || error instanceof ConnectionStringError ? `Import stopped: ${error.message}` : 'Import failed. Nothing was committed. Check the files and database configuration; credentials were not logged.');
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end();
}
