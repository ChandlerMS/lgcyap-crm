// Production build, run by Vercel (vercel.json -> buildCommand) or locally with `npm run build`.
// It writes .vercel/output in Vercel's Build Output API format:
//   static/            public/ (brand images), served straight from Vercel's CDN
//   functions/index    the whole app (src/vercel.ts) as one bundled Node.js function
//   config.json        routing: static files first, everything else to the function; plus the daily cron job
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import { common } from './bundle.mjs';

const out = '.vercel/output';
const fn = `${out}/functions/index.func`;
fs.rmSync(out, { recursive: true, force: true });

await esbuild.build({
  ...common,
  entryPoints: ['src/vercel.ts'],
  outfile: `${fn}/index.mjs`,
  // pg's optional native and Cloudflare drivers are never loaded on Vercel.
  external: ['pg-native', 'pg-cloudflare'],
});

fs.writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({
  runtime: 'nodejs24.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  supportsResponseStreaming: true,
  maxDuration: 300,
}, null, 2));

fs.cpSync('public', `${out}/static`, { recursive: true });

fs.writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index' },
  ],
  // Once a day at 11:00 UTC (6 or 7 am Eastern): the most Vercel's Hobby plan allows. While the CRM is open it also
  // syncs every 10 minutes by itself (syncIfDue in src/index.ts). On Pro you can set "*/10 * * * *" here.
  crons: [{ path: '/api/cron', schedule: '0 11 * * *' }],
}, null, 2));

console.log(`Built ${out} (function ${(fs.statSync(`${fn}/index.mjs`).size / 1024).toFixed(0)} KB).`);
