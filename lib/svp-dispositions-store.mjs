import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openSnapshot } from './svp-dispositions.mjs';
let pending;
export function readDispositionSnapshot() {
  pending ??= readFile(join(process.cwd(), 'server-data/svp-dispositions.enc'))
    .then(bytes => openSnapshot(bytes, process.env.SVP_DISPOSITIONS_KEY))
    .catch(() => { pending = null; throw new Error('Call history snapshot unavailable'); });
  return pending;
}
