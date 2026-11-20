import { handleSubmit, reply } from '../lib/handler.mjs';

export function POST(request) {
  return handleSubmit(request);
}

export function GET() {
  return reply(405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
}
