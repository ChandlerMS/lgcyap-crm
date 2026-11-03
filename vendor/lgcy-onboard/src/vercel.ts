import { waitUntil } from '@vercel/functions';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { postgres } from './db';
import { envFrom } from './env';
import { log } from './http';
import { handle } from './index';
import { send, toRequest } from './node';

// The Vercel Function. scripts/build.mjs bundles this file into .vercel/output/functions/index.func, and every path
// that isn't a static file (public/) is routed here.
let env: Env | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    env ||= envFrom(process.env, postgres(process.env.DATABASE_URL));
    const request = await toRequest(req);
    const response = request ? await handle(request, env, { waitUntil }) : new Response(null, { status: 413 });
    await send(res, response, req.method === 'HEAD');
  } catch (e) {
    log('error', { path: req.url, error: e instanceof Error ? e.stack || e.message : String(e) });
    if (!res.headersSent) { res.statusCode = 500; res.end(); }
  }
}
