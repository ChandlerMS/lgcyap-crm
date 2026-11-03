import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { database, postgres, type Db, type Queries } from './db';
import { envFrom } from './env';
import { log } from './http';
import { handle, sync } from './index';
import { send, toRequest } from './node';

// Local development server (npm run dev). It serves public/ the way Vercel does and sends everything else to the app.
// Without DATABASE_URL it keeps its data in an embedded Postgres (PGlite) under .data/, so nothing has to be set up.
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.resolve('public');
const TYPES: Record<string, string> = { '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function pglite(dir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  fs.mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir, { parsers: { 20: (v: string) => Number(v) } });
  const on = (q: Pick<typeof db, 'query' | 'exec'>): Queries => ({
    async query(sql, args) { const r = await q.query<Record<string, unknown>>(sql, args); return { rows: r.rows, count: r.affectedRows ?? 0 }; },
    async exec(sql) { await q.exec(sql); },
  });
  return database({ ...on(db), transaction: (fn) => db.transaction((tx) => fn(on(tx))) });
}

const DB = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : await pglite(path.resolve('.data/pglite'));
const env = envFrom(process.env, DB);
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch((e) => log('error', { error: String(e) })); } };

http.createServer(async (req, res) => {
  try {
    const file = path.join(PUBLIC, decodeURIComponent(new URL(req.url || '/', 'http://x').pathname));
    if (file.startsWith(PUBLIC + path.sep) && fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    const request = await toRequest(req);
    await send(res, request ? await handle(request, env, ctx) : new Response(null, { status: 413 }), req.method === 'HEAD');
  } catch (e) {
    log('error', { path: req.url, error: e instanceof Error ? e.stack || e.message : String(e) });
    if (!res.headersSent) { res.statusCode = 500; res.end(); }
  }
}).listen(PORT, () => {
  console.log(`LGCY Onboard on http://localhost:${PORT} (database: ${process.env.DATABASE_URL ? 'DATABASE_URL' : '.data/pglite'})`);
  if (env.DEV_LOGIN_CODES === '1') console.log('DEV_LOGIN_CODES=1: sign-in codes are printed here as dev_login_code.');
});

// Locally there is no cron job; sync once at start so calendars and Indeed show up if Google is set up.
if (env.GOOGLE_CLIENT_ID) sync(env).catch((e) => log('error', { error: String(e) }));
