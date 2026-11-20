// Local preview for the hiring-event sites, close to how Vercel serves them:
// static files from <app>/public with clean URLs, /api/<name> from <app>/api/<name>.js
// (Web Request -> Response handlers), and the headers from <app>/vercel.json.
//
//   node hiring-event/apply/scripts/dev-server.mjs hiring-event/apply 3020
//   APPLY_DRY_RUN=1 node hiring-event/apply/scripts/dev-server.mjs hiring-event/apply 3020
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const appDir = resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 3020);
const publicDir = join(appDir, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.json': 'application/json',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

let headerRules = [];
try {
  const config = JSON.parse(await readFile(join(appDir, 'vercel.json'), 'utf8'));
  headerRules = (config.headers ?? []).filter(rule => rule.source === '/(.*)').flatMap(rule => rule.headers);
} catch { /* no vercel.json */ }

async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/\/+$/, '') || '/index';
  for (const candidate of [clean, `${clean}.html`, join(clean, 'index.html')]) {
    const full = resolve(publicDir, `.${candidate}`);
    if (!full.startsWith(publicDir + sep) && full !== publicDir) return null;
    if (await exists(full)) return full;
  }
  return null;
}

createServer(async (req, res) => {
  for (const { key, value } of headerRules) res.setHeader(key, value);
  let url;
  try { url = new URL(req.url, `http://${req.headers.host}`); } catch { res.writeHead(400).end('Bad request'); return; }
  try {
    const api = /^\/api\/([a-z0-9-]+)$/.exec(url.pathname);
    if (api) {
      const file = join(appDir, 'api', `${api[1]}.js`);
      if (!(await exists(file))) { res.writeHead(404).end('Not found'); return; }
      const mod = await import(pathToFileURL(file).href);
      const handler = mod[req.method];
      if (typeof handler !== 'function') { res.writeHead(405).end(); return; }
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const request = new Request(url, { method: req.method, headers: req.headers, ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
      const response = await handler(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = await staticFile(url.pathname);
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end('Server error');
  }
// Only this computer by default. Set HOST=0.0.0.0 to try the form from a phone on the same network.
}).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Serving ${appDir} at http://localhost:${port}`));
