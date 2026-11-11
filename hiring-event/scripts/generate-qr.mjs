// Writes the QR codes for the sign-in site into signinqr/public and updates the
// printed/displayed address in the pages.
//
//   npm run qr                                   # https://lgcyap-signin.vercel.app
//   npm run qr -- https://signin.example.com     # after moving to a custom domain
//
// Each code carries ?s=room (conference room TV) or ?s=lobby (security desk), so the
// HubSpot ticket records where the person scanned.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'signinqr', 'public');
const base = new URL(process.argv[2] ?? 'https://lgcyap-signin.vercel.app');
if (base.protocol !== 'https:') throw new Error('The sign-in address must use https.');
const host = base.host;

export const CODES = {
  room: new URL('/?s=room', base).href,
  lobby: new URL('/?s=lobby', base).href,
};

for (const [name, url] of Object.entries(CODES)) {
  // Error correction Q (25%) survives glare on the TV and wear on paper. A 4-module
  // white quiet zone is part of the SVG, so it scans on any background.
  let svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'Q', margin: 4, color: { dark: '#0A0A0BFF', light: '#FFFFFFFF' } });
  svg = svg.replace('<svg ', `<svg role="img" aria-label="QR code that opens ${host}" `);
  await writeFile(join(root, `qr-${name}.svg`), svg);
  const modules = QRCode.create(url, { errorCorrectionLevel: 'Q' }).modules.size;
  console.log(`qr-${name}.svg  ${url}  (${modules}x${modules} modules)`);
}

// Keep the human-readable address in the pages in step with the codes.
for (const page of ['index.html', 'print.html']) {
  const file = join(root, page);
  const html = await readFile(file, 'utf8');
  const next = html.replace(/(<span data-signin-host>)[^<]*(<\/span>)/g, `$1${host}$2`);
  if (next !== html) { await writeFile(file, next); console.log(`updated address in ${page}`); }
}
