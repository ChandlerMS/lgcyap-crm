import { RecruitingError } from './hubspot.mjs';
import { hubspotJson, noteKind } from './event-attendance.mjs';

// The photo ID an applicant uploads on the apply site. The site stores it as a private File Manager file and attaches it
// to the application note (hs_attachment_ids), which is linked to the recruit's ticket and contact, so HubSpot already
// lists it with the recruit. This read lets recruiting editors see it in the CRM: the file passes through this server
// to the signed-in editor and is never stored or cached here.
const BASE = 'https://api.hubapi.com';
// The apply site accepts files up to 3.5 MB; Vercel Functions cannot return more than 4.5 MB.
export const MAX_PHOTO_BYTES = 4_000_000;
const MAX_REDIRECTS = 3;
const validId = value => /^[1-9]\d{0,19}$/.test(String(value ?? ''));
// HubSpot serves private files from its own hosts only.
const FILE_HOST = /(?:^|\.)(?:hubspotusercontent(?:-[a-z0-9]+)?\.(?:net|com)|hubspot\.(?:com|net)|hubapi\.com)$/i;
const notFound = message => new RecruitingError('PHOTO_ID_NOT_FOUND', message, 404);
const unavailable = () => new RecruitingError('HUBSPOT_UNAVAILABLE', 'HubSpot could not send the photo ID. Please try again later.', 502);

/** The file's real type from its first bytes, for the same types the apply site accepts. */
export function photoType(bytes) {
  const ascii = String.fromCharCode(...bytes.subarray(0, 12));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return { type: 'image/png', ext: 'png' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  if (ascii.startsWith('%PDF-')) return { type: 'application/pdf', ext: 'pdf' };
  if (/^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii.slice(4, 12))) return { type: 'image/heic', ext: 'heic' };
  return null;
}

async function readBounded(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function timed(timeoutMs, run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await run(controller.signal); }
  catch (error) {
    if (error instanceof RecruitingError) throw error;
    if (controller.signal.aborted) throw new RecruitingError('HUBSPOT_TIMEOUT', 'HubSpot took too long to send the photo ID. Please try again.', 504);
    throw unavailable();
  } finally { clearTimeout(timer); }
}

/** A short-lived link to the private file. Reading private files needs the HubSpot "files" permission. */
async function signedUrl(fileId, { accessToken, fetchImpl, timeoutMs }) {
  return timed(timeoutMs, async signal => {
    const response = await fetchImpl(`${BASE}/files/v3/files/${fileId}/signed-url?expirationSeconds=60`, {
      method: 'GET', redirect: 'manual', signal, headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (response.status === 401 || response.status === 403) {
      throw new RecruitingError('HUBSPOT_FILES_ACCESS_REQUIRED', 'The CRM\'s HubSpot connection cannot open private files yet. Ask the app owner to add the "files" permission to the CRM\'s HubSpot app, then try again.', 502);
    }
    if (response.status === 404) throw notFound('The photo ID file is no longer in HubSpot.');
    if (response.status === 429) throw new RecruitingError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait a moment, then try again.', 429);
    if (!response.ok) throw unavailable();
    const bytes = await readBounded(response, 64_000);
    let body;
    try { body = bytes && JSON.parse(new TextDecoder().decode(bytes)); } catch { body = null; }
    if (!body || typeof body.url !== 'string') throw unavailable();
    return body.url;
  });
}

function fileUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  return url.protocol === 'https:' && !url.username && !url.password && FILE_HOST.test(url.hostname) ? url : null;
}

/** The file itself, from HubSpot's file host. No HubSpot credential is sent, and only HubSpot hosts are followed. */
async function download(link, { fetchImpl, timeoutMs }) {
  return timed(timeoutMs, async signal => {
    let url = fileUrl(link);
    for (let hop = 0; url && hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetchImpl(url.href, { method: 'GET', redirect: 'manual', signal, headers: { Accept: '*/*' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('Location');
        url = next ? fileUrl(new URL(next, url).href) : null;
        continue;
      }
      if (response.status === 404 || response.status === 410) throw notFound('The photo ID file is no longer in HubSpot.');
      if (!response.ok) throw unavailable();
      const bytes = await readBounded(response, MAX_PHOTO_BYTES);
      if (!bytes) throw new RecruitingError('PHOTO_ID_TOO_LARGE', 'This photo ID is too large to show here. Open it from the recruit in HubSpot.', 413);
      return bytes;
    }
    throw unavailable();
  });
}

/** The photo ID attached to one application note, checked to be one of the image or PDF types the apply site accepts. */
export async function readApplicationPhoto(noteId, { accessToken = '', fetchImpl = fetch, now = Date.now, timeoutMs = 12000 } = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken) || accessToken.length > 4096) {
    throw new RecruitingError('CONNECTION_NOT_CONFIGURED', 'The secure HubSpot connection has not been configured yet.', 503);
  }
  if (!validId(noteId)) throw notFound('This application could not be found.');
  const options = { accessToken, fetchImpl, timeoutMs, now };
  const note = await hubspotJson(`/crm/v3/objects/notes/${noteId}?properties=hs_note_body,hs_attachment_ids`, {}, options);
  // Only application notes: this is not a general file reader.
  if (!note || String(note.id) !== String(noteId) || noteKind(note.properties?.hs_note_body) !== 'application') throw notFound('This application could not be found.');
  const fileId = String(note.properties?.hs_attachment_ids ?? '').split(';').map(value => value.trim()).find(validId);
  if (!fileId) throw notFound('This application has no photo ID attached in HubSpot.');
  const bytes = await download(await signedUrl(fileId, options), options);
  const kind = photoType(bytes);
  if (!kind) throw new RecruitingError('PHOTO_ID_UNSUPPORTED', 'This photo ID is not an image or PDF the CRM can show. Open it from the recruit in HubSpot.', 415);
  return { bytes, ...kind };
}

/** The photo as a private, uncached response that cannot run as a page. */
export function photoResponse({ bytes, type, ext }) {
  return new Response(bytes, { status: 200, headers: {
    'Cache-Control': 'private, no-store, max-age=0', 'Content-Type': type, 'Content-Length': String(bytes.byteLength),
    'Content-Disposition': `inline; filename="photo-id.${ext}"`, 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer',
  } });
}
