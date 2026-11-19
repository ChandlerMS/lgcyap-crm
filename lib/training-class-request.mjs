import { editorAllowed, hostingAllowsWrites } from './hubspot-write.mjs';
import { isAllowedOrigin } from './hubspot.mjs';
import { classError, trainingClassError } from './training-classes.mjs';
export function canManageClasses(user, env) {
  return editorAllowed(user, env.RECRUITING_EDITOR_EMAILS) && env.RECRUITING_WRITES_ENABLED === 'true' && hostingAllowsWrites({ vercel: env.VERCEL, vercelEnv: env.VERCEL_ENV });
}
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
const json = (value, status = 200) => Response.json(value, { status, headers });
async function inputJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw classError('Send class details as JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw classError('Enter class details.');
  let size = 0, body = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); throw classError('The class request is too large.', 413); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally { reader.releaseLock(); }
  let input;
  try { input = JSON.parse(body); } catch { throw classError('Enter valid class details.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw classError('Enter valid class details.');
  return input;
}
export async function handleTrainingClasses(request, { getUser, env, list, save, cancel }) {
  try {
    const user = await getUser();
    if (!user) throw classError('Sign in to view training classes.', 401);
    if (!editorAllowed(user, env.RECRUITING_EDITOR_EMAILS)) throw classError('This account does not have CRM access.', 403);
    const canManage = canManageClasses(user, env);
    if (request.method === 'GET') return json({ classes: await list(), canManage });
    if (request.method !== 'POST') return json({ error: 'Use GET or POST.' }, 405);
    if (!canManage) throw classError('Class management is read-only in this environment or for this account.', 403);
    if (!isAllowedOrigin(request, env.BETTER_AUTH_URL)) throw classError('Open the CRM directly before changing classes.', 403);
    const input = await inputJson(request);
    if (!['save', 'cancel'].includes(input.action)) throw classError('Choose save or cancel.');
    const result = input.action === 'save' ? await save(input, user.email) : await cancel(input, user.email);
    return json({ class: result });
  } catch (error) {
    const result = trainingClassError(error);
    return json({ error: result.error }, result.status);
  }
}
