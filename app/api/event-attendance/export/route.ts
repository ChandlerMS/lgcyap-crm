import { getAppUser } from '@/app/app-auth';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { ApplicationExportError } from '@/lib/applications-export.mjs';
import { startApplicationExport } from '@/lib/attendance-export-oauth.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const user = await getAppUser();
    if (!editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS)) throw new ApplicationExportError('Sign in to the CRM before exporting.', 401);
    const start = startApplicationExport(request, { user, env: process.env });
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApplicationExportError('Send the export filters as JSON.');
    const text = await request.text();
    if (text.length > 350000) throw new ApplicationExportError('The export filters are too large.', 413);
    let input;
    try { input = JSON.parse(text); } catch { throw new ApplicationExportError('The export filters are invalid.'); }
    return await start(input);
  } catch (error) {
    const known = error instanceof ApplicationExportError;
    return Response.json({ error: known ? error.message : 'Google Drive export is temporarily unavailable.' }, { status: known ? error.status : 503, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
  }
}
