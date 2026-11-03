import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';

// The app is written as Request -> Response (web standard). Vercel's Node.js functions and the local dev server both
// hand over Node's req/res, so these two convert between them.

const BODY_MAX = 10 * 1024 * 1024; // Vercel itself stops at 4.5 MB; this only guards the local server.

export async function toRequest(req: IncomingMessage): Promise<Request | null> {
  const first = (h: string | string[] | undefined) => String(Array.isArray(h) ? h[0] : h || '').split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto']) || ('encrypted' in req.socket ? 'https' : 'http');
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host) || 'localhost';
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) headers.append(k, x);

  let body: Buffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const parts: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > BODY_MAX) return null; parts.push(chunk); }
    body = Buffer.concat(parts);
  }
  return new Request(new URL(req.url || '/', `${proto}://${host}`), { method: req.method, headers, body });
}

export async function send(res: ServerResponse, r: Response, head = false): Promise<void> {
  res.statusCode = r.status;
  r.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(head || !r.body ? undefined : Buffer.from(await r.arrayBuffer()));
}
