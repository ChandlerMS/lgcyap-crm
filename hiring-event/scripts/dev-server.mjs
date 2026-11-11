// Local preview for the hiring-event sites, close to how Vercel serves them:
// static files from <app>/public with clean URLs, /api/<name> from <app>/api/<name>.js
// (Web Request -> Response handlers), and the headers from <app>/vercel.json.
//
//   node hiring-event/scripts/dev-server.mjs hiring-event/signin 3010 --dry-run
// --dry-run sets SIGNIN_DRY_RUN=1: the sign-in validates everything and writes nothing.
// --lan also listens on the local network (for testing on a phone); by default only
// this computer can connect.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const [dirArg, portArg] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (process.argv.includes('--dry-run')) process.env.SIGNIN_DRY_RUN = '1';
const appDir = resolve(dirArg ?? '.');
const port = Number(portArg ?? 3010);
const hostname = process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
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
  // Everything, URL parsing included, stays inside the try: a malformed request gets a
  // 400 instead of crashing the preview. The path comes from req.url only; the Host
  // header is never parsed (the sign-in handler reads it as a plain string).
  let url;
  try {
    url = new URL(req.url ?? '/', `http://localhost:${port}`);
    decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request');
    return;
  }
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
}).listen(port, hostname, () => console.log(`Serving ${appDir} at http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}${hostname === '0.0.0.0' ? ' (also on the local network)' : ''}`));
