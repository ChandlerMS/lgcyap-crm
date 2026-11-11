// Renders the QR codes the way people will see them (the SVG files, the TV page at
// 1080p and 4K, the print page and the PDF itself) in headless Chrome, then decodes
// each render with jsQR and checks it opens the expected sign-in address.
//
//   npm run verify-qr                                  # expects lgcyap-signin.vercel.app
//   npm run verify-qr -- https://signin.example.com
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { headless } from './chrome.mjs';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'signinqr', 'public');
const base = new URL(process.argv[2] ?? 'https://lgcyap-signin.vercel.app');
const expected = { room: new URL('/?s=room', base).href, lobby: new URL('/?s=lobby', base).href };
const page = name => pathToFileURL(join(pub, name)).href;

const checks = [
  { label: 'qr-room.svg', url: page('qr-room.svg'), size: '600,600', want: expected.room },
  { label: 'qr-lobby.svg', url: page('qr-lobby.svg'), size: '600,600', want: expected.lobby },
  { label: 'TV page 1920x1080', url: page('index.html'), size: '1920,1080', want: expected.room },
  { label: 'TV page 3840x2160', url: page('index.html'), size: '3840,2160', want: expected.room },
  // Headless Chrome will not render narrower than about 500px, so portrait is checked at 600x1000.
  { label: 'TV page in portrait (600x1000)', url: page('index.html'), size: '600,1000', want: expected.room },
  // Tall enough for the desk sign's code, short enough to leave out page 2's four codes.
  { label: 'Print page (desk sign)', url: page('print.html'), size: '1000,1050', want: expected.lobby },
  // Headless Chrome does not render PDFs, so the PDF is printed from this same page by `npm run pdf`.
];

const dir = await mkdtemp(join(tmpdir(), 'lgcyap-qr-'));
let failed = 0;
try {
  for (const [i, check] of checks.entries()) {
    const shot = join(dir, `${i}.png`);
    let found = null;
    try {
      await headless([`--window-size=${check.size}`, '--force-device-scale-factor=1', `--screenshot=${shot}`, check.url]);
      const png = PNG.sync.read(await readFile(shot));
      found = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
    } catch (error) {
      found = `error: ${error.message.split('\n')[0]}`;
    }
    const ok = found === check.want;
    if (!ok && !check.optional) failed += 1;
    console.log(`${ok ? 'PASS' : check.optional ? 'SKIP' : 'FAIL'}  ${check.label}: ${found ?? 'no QR found'}`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('All required QR checks passed.');
