// Private normalized data and key files must remain in ignored work/.
// Usage: node scripts/seal-svp-dispositions.mjs work/svp-calls.json work/svp-dispositions.key
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { sealSnapshot, openSnapshot } from '../lib/svp-dispositions.mjs';
const [source, keyFile] = process.argv.slice(2);
for (const path of [source, keyFile]) if (!path || !resolve(path).startsWith(resolve('work') + sep)) throw new Error('Inputs must be in ignored work/.');
const key = (await readFile(keyFile, 'utf8')).trim(), snapshot = JSON.parse(await readFile(source, 'utf8'));
const encrypted = sealSnapshot(snapshot, key);
if (JSON.stringify(openSnapshot(encrypted, key)) !== JSON.stringify(snapshot)) throw new Error('Snapshot verification failed');
await writeFile('server-data/svp-dispositions.enc', encrypted);
console.log(`Encrypted and verified ${snapshot.rows.length} call rows. No plaintext data or key was published.`);
