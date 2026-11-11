// Prints signinqr/public/print.html to the Letter-size PDF for the security desk.
//
//   npm run pdf
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { headless } from './chrome.mjs';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'signinqr', 'public');
const out = join(pub, 'Legacy-Sign-In-QR-Security-Desk.pdf');

await headless(['--no-pdf-header-footer', '--run-all-compositor-stages-before-draw', `--print-to-pdf=${out}`, pathToFileURL(join(pub, 'print.html')).href]);
const { size } = await stat(out);
console.log(`wrote ${out} (${Math.round(size / 1024)} KB)`);
