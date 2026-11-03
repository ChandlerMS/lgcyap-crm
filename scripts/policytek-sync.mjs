import { readFile } from 'node:fs/promises';
import { parsePolicytekCapture } from '../lib/policytek.mjs';

// This credential can publish aggregate snapshots only. No PolicyTek cookies or database keys.
try {
  const secret = process.env.POLICYTEK_SYNC_SECRET;
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) throw Error('Not configured');
  const init = { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${secret}` } };
  if (process.argv[2] === '--publish' && process.argv[3]) {
    const raw = await readFile(process.argv[3], 'utf8');
    if (Buffer.byteLength(raw) > 3 * 1024 * 1024) throw Error('Capture too large');
    parsePolicytekCapture(JSON.parse(raw));
    init.method = 'POST'; init.headers['Content-Type'] = 'application/json'; init.body = raw;
  } else if (process.argv[2] !== '--plan') throw Error('Use --plan or --publish capture.json');
  const response = await fetch('https://lgcyap-crm.vercel.app/api/policytek-sync', init);
  if (!response.ok) throw Error(`Sync HTTP ${response.status}`);
  console.log(JSON.stringify(await response.json()));
} catch {
  console.error('PolicyTek sync failed. Verify report capture, dates, filters and publisher configuration. Last successful snapshots were retained.');
  process.exitCode = 1;
}
