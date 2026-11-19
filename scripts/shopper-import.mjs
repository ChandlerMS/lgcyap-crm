// Imports PolicyTek "calls-report_*.xlsx" and "applications-report_*.xlsx" exports into the Shopper leaderboard.
// usage: node scripts/shopper-import.mjs <folder or .xlsx files...> [--apply]
// Without --apply nothing is written; the files are validated and summarized. Output never includes agent, caller or customer details.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import readExcelFile from 'read-excel-file/node';
import { getPool } from '../db/pool.mjs';
import { askConnectionString, ConnectionStringError } from './connection-string.mjs';
import { combineShopperReports, importShopperReports, parseShopperReport, ShopperImportError } from '../lib/shopper-reports.mjs';

const apply = process.argv.includes('--apply');
const targets = process.argv.slice(2).filter(arg => arg !== '--apply');
const REPORT = /^(?:calls|applications)-report_.*\.xlsx$/;

async function reportFiles() {
  const files = [];
  for (const target of targets) {
    if ((await stat(target)).isDirectory()) files.push(...(await readdir(target)).filter(file => REPORT.test(file)).map(file => path.join(target, file)));
    else files.push(target);
  }
  return files.sort();
}

let pool, client;
try {
  if (!targets.length) throw new ShopperImportError('Name a folder or one or more calls-report / applications-report files.');
  const files = await reportFiles();
  if (!files.length) throw new ShopperImportError('No "calls-report_*.xlsx" or "applications-report_*.xlsx" files were found.');
  const reports = [];
  for (const file of files) {
    const bytes = await readFile(file);
    const report = parseShopperReport({ fileName: path.basename(file), sha256: createHash('sha256').update(bytes).digest('hex'), sheets: await readExcelFile(bytes) });
    reports.push(report);
    console.log(`${report.kind.padEnd(12)} ${report.firstDate ?? '—'} → ${report.lastDate ?? '—'}  rows ${String(report.records.length).padStart(6)}  ${report.fileName}`);
  }
  const combined = combineShopperReports(reports);
  for (const [kind, report] of Object.entries(combined.kinds)) {
    const premium = kind === 'applications' ? `  premium $${(report.rows.reduce((total, row) => total + row.cents, 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
    console.log(`${kind}: ${report.firstDate} → ${report.lastDate}, ${report.records} ${kind} over ${report.rows.length} agent-days${premium}`);
  }
  const { skipped } = combined;
  console.log(`${combined.agents} agents. Skipped: ${skipped.exportDay} rows from an export's own (unfinished) day, ${skipped.duplicates} rows repeated in another file, ${skipped.notInbound} non-inbound calls, ${skipped.noAgent} rows without an agent.${combined.ambiguousNames ? ` ${combined.ambiguousNames} names differ only by middle initial and were kept apart.` : ''}`);
  if (!apply) {
    console.log('No database was changed. Re-run with --apply to import these days.');
  } else {
    nextEnv.loadEnvConfig(process.cwd());
    if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) process.env.DATABASE_URL = await askConnectionString();
    pool = getPool();
    client = await pool.connect();
    await client.query(await readFile(new URL('../migrations/0017_shopper_reports.sql', import.meta.url), 'utf8'));
    const result = await importShopperReports(client, combined);
    for (const [kind, report] of Object.entries(result.kinds)) console.log(`Imported ${kind} ${report.firstDate} → ${report.lastDate} (${report.agentDays} agent-days) at ${result.importedAt}.`);
    console.log('Other days were not changed.');
  }
} catch (error) {
  console.error(error instanceof ShopperImportError || error instanceof ConnectionStringError ? `Import stopped: ${error.message}` : 'Import failed. Nothing was committed. Check the files and database configuration; credentials were not logged.');
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end();
}
