import { getMigrations } from 'better-auth/db/migration';
import { getAuth, getAuthSetupIssues } from '../lib/auth-server.mjs';
import { getPool } from '../db/pool.mjs';

// Explicit command only: never imported from an API handler, start, or build.
if (process.argv.slice(2).some(arg => !['--check', '--apply'].includes(arg))
  || (process.argv.includes('--check') && process.argv.includes('--apply'))) {
  console.error('Use --check to inspect the authentication schema or --apply to migrate it.');
  process.exitCode = 1;
} else {
  const missing = getAuthSetupIssues();
  if (missing.length) {
    console.error(`Authentication configuration is incomplete: ${missing.join(', ')}.`);
    process.exitCode = 1;
  } else {
    try {
      const auth = getAuth();
      const plan = await getMigrations(auth.options);
      if (process.argv.includes('--apply')) {
        await plan.runMigrations();
        console.info('Authentication migrations applied.');
      } else {
        const pending = plan.toBeCreated.length + plan.toBeAdded.length + plan.toBeAddedIndexes.length;
        console.info(JSON.stringify({ authenticationSchemaReady: pending === 0, tablesToCreate: plan.toBeCreated.map(table => table.table), tablesToUpdate: plan.toBeAdded.map(table => table.table), indexesToCreate: plan.toBeAddedIndexes.length }));
        if (pending) process.exitCode = 2;
      }
    } catch {
      console.error('Authentication schema operation failed. Check database access and configuration.');
      process.exitCode = 1;
    } finally { await getPool().end(); }
  }
}
