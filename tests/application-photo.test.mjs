import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PHOTO_BYTES, photoResponse, photoType, readApplicationPhoto } from '../lib/application-photo.mjs';
import { handleRecruitRequest } from '../lib/hubspot.mjs';

// A fake HubSpot. Synthetic notes and bytes only: no real applicant data or files.
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1]);
const SIGNED = 'https://50894788.fs1.hubspotusercontent-na1.net/hubfs/50894788/Agent%20Applications/photo.jpg?Expires=1&Signature=x';
const applicationNote = (attachments = '777') => ({ id: '555', properties: {
  hs_note_body: '<p><strong>Agent application (v3.1) submitted online, Nov 18, 2026</strong></p><p><strong>Photo ID:</strong> Attached to this note (private file)</p>',
  hs_attachment_ids: attachments,
} });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function hubspot({ note = applicationNote(), signedStatus = 200, signedUrl = SIGNED, file = () => new Response(JPEG, { status: 200 }) } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization ?? null, redirect: init?.redirect });
    const { pathname, hostname } = new URL(url);
    if (hostname === 'api.hubapi.com' && pathname === '/crm/v3/objects/notes/555') return note ? json(note) : json({}, 404);
    if (hostname === 'api.hubapi.com' && pathname === '/files/v3/files/777/signed-url') return signedStatus === 200 ? json({ url: signedUrl, type: 'IMG', extension: 'jpg' }) : json({ status: 'error' }, signedStatus);
    return file(url);
  };
  return { fetchImpl, calls };
}
const read = (fake, noteId = '555') => readApplicationPhoto(noteId, { accessToken: 'test-token', fetchImpl: fake.fetchImpl });

test('an application photo ID is read from the note attachment, and the file host never gets the HubSpot token', async () => {
  const fake = hubspot();
  const photo = await read(fake);
  assert.deepEqual([photo.type, photo.ext, photo.bytes.byteLength], ['image/jpeg', 'jpg', JPEG.byteLength]);
  assert.deepEqual(fake.calls.map(call => [new URL(call.url).pathname, Boolean(call.auth), call.redirect]), [
    ['/crm/v3/objects/notes/555', true, 'manual'], ['/files/v3/files/777/signed-url', true, 'manual'],
    ['/hubfs/50894788/Agent%20Applications/photo.jpg', false, 'manual'],
  ]);
});

test('the photo comes back private, uncached and unable to run as a page', async () => {
  const response = photoResponse(await read(hubspot()));
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), JPEG);
});

test('only application notes with an attachment are read', async () => {
  const signIn = { id: '555', properties: { hs_note_body: '<p><strong>Hiring event sign-in</strong></p>', hs_attachment_ids: '777' } };
  await assert.rejects(read(hubspot({ note: signIn })), { code: 'PHOTO_ID_NOT_FOUND' });
  await assert.rejects(read(hubspot({ note: applicationNote('') })), { code: 'PHOTO_ID_NOT_FOUND', message: /no photo ID/ });
  await assert.rejects(read(hubspot(), '../files'), { code: 'PHOTO_ID_NOT_FOUND' });
  await assert.rejects(readApplicationPhoto('555', { accessToken: '', fetchImpl: hubspot().fetchImpl }), { code: 'CONNECTION_NOT_CONFIGURED' });
});

test('a connection without the files permission says what the owner must add', async () => {
  await assert.rejects(read(hubspot({ signedStatus: 403 })), { code: 'HUBSPOT_FILES_ACCESS_REQUIRED', message: /"files" permission/ });
  await assert.rejects(read(hubspot({ signedStatus: 404 })), { code: 'PHOTO_ID_NOT_FOUND' });
});

test('files are fetched only from HubSpot hosts over HTTPS, including after a redirect', async () => {
  await assert.rejects(read(hubspot({ signedUrl: 'https://example.com/photo.jpg' })), { code: 'HUBSPOT_UNAVAILABLE' });
  await assert.rejects(read(hubspot({ signedUrl: 'http://cdn2.hubspot.net/photo.jpg' })), { code: 'HUBSPOT_UNAVAILABLE' });
  await assert.rejects(read(hubspot({ signedUrl: 'https://evil-hubspot.net/photo.jpg' })), { code: 'HUBSPOT_UNAVAILABLE' });
  const away = hubspot({ file: () => new Response(null, { status: 302, headers: { Location: 'https://example.com/photo.jpg' } }) });
  await assert.rejects(read(away), { code: 'HUBSPOT_UNAVAILABLE' });
  assert.ok(!away.calls.some(call => call.url.startsWith('https://example.com')));
  let hops = 0;
  const onward = hubspot({ file: () => (hops++ ? new Response(JPEG, { status: 200 }) : new Response(null, { status: 302, headers: { Location: 'https://cdn2.hubspot.net/hubfs/photo.jpg' } })) });
  assert.equal((await read(onward)).type, 'image/jpeg');
});

test('only the image and PDF types the apply site accepts are returned, and never more than the size limit', async () => {
  const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
  await assert.rejects(read(hubspot({ file: () => new Response(html, { status: 200 }) })), { code: 'PHOTO_ID_UNSUPPORTED' });
  await assert.rejects(read(hubspot({ file: () => new Response(new Uint8Array(MAX_PHOTO_BYTES + 1), { status: 200 }) })), { code: 'PHOTO_ID_TOO_LARGE' });
  const text = value => new TextEncoder().encode(value);
  assert.equal(photoType(text('%PDF-1.7 rest'))?.type, 'application/pdf');
  assert.equal(photoType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0]))?.type, 'image/png');
  assert.equal(photoType(text('RIFF\0\0\0\0WEBPVP8 '))?.type, 'image/webp');
  assert.equal(photoType(text('\0\0\0\x18ftypheic'))?.type, 'image/heic');
  assert.equal(photoType(text('GIF89a......')), null);
});

test('the request checks still apply before a photo is sent', async () => {
  const origin = 'https://crm.example.test';
  const request = (headers = {}) => new Request(`${origin}/api/applications/555/photo-id`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: '{}' });
  let reads = 0;
  const base = { allowedOrigin: origin, getUser: async () => ({ email: 'editor@example.test' }), authorizeUser: user => user.email === 'editor@example.test', readData: async () => { reads += 1; return photoResponse(await read(hubspot())); } };
  assert.equal((await handleRecruitRequest(request(), { ...base, getUser: async () => null })).status, 401);
  assert.equal((await handleRecruitRequest(request(), { ...base, getUser: async () => ({ email: 'viewer@example.test' }) })).status, 403);
  assert.equal((await handleRecruitRequest(request({ Origin: 'https://other.example.test' }), base)).status, 403);
  assert.equal(reads, 0);
  const response = await handleRecruitRequest(request(), base);
  assert.deepEqual([response.status, response.headers.get('Content-Type'), reads], [200, 'image/jpeg', 1]);
  const failed = await handleRecruitRequest(request(), { ...base, readData: () => read(hubspot({ signedStatus: 403 })) });
  assert.deepEqual([failed.status, (await failed.json()).error.code], [502, 'HUBSPOT_FILES_ACCESS_REQUIRED']);
});
