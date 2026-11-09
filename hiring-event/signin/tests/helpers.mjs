// Shared fixtures. Names, emails and phones are obviously fake.
export function jpegBlob(size = 4000) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return new Blob([bytes], { type: 'image/jpeg' });
}

export function validForm(overrides = {}) {
  const { licenseFront: _front, licenseBack: _back, ...rest } = overrides;
  const fields = {
    firstName: 'Testy', lastName: 'McSample', email: 'Testy.Sample@Example.invalid', phone: '(407) 555-0142',
    office: 'orlando', heardAbout: 'referral', referredBy: 'Pat Example', licenseStatus: 'licensed',
    contractedBefore: 'no', npn: '12345678', consent: 'yes', source: 'lobby', elapsedMs: '45000', website: '',
    ...rest,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.append(key, value);
  if (!('licenseFront' in overrides)) form.append('licenseFront', jpegBlob(), 'license-front.jpg');
  if (overrides.licenseBack === undefined) form.append('licenseBack', jpegBlob(5000), 'license-back.jpg');
  return form;
}

function json(status, body, headers = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/**
 * Fake HubSpot. `routes` maps "METHOD /path" (path without query) to a function
 * (call) => Response | [status, body]. Unmatched calls return 404. Every call is recorded.
 */
export function fakeHubSpot(routes = {}) {
  const calls = [];
  const defaults = {
    'POST /oauth/v2/private-apps/get/access-token-info': () => [200, { hubId: 50894788, appId: 1, scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.tickets.read', 'crm.objects.tickets.write', 'files'] }],
    'POST /crm/v3/objects/contacts/search': () => [200, { total: 0, results: [] }],
    'POST /crm/v3/objects/contacts': () => [201, { id: '501' }],
    'GET /crm/v4/objects/contacts/501/associations/tickets': () => [200, { results: [] }],
    'POST /crm/v3/objects/tickets': () => [201, { id: '901' }],
    'POST /files/v3/files': call => [201, { id: String(7000 + calls.filter(c => c.key === call.key).length) }],
    'POST /crm/v3/objects/notes': () => [201, { id: '3001' }],
  };
  const table = { ...defaults, ...routes };
  async function fetchImpl(url, init = {}) {
    const parsed = new URL(url);
    const key = `${init.method ?? 'GET'} ${parsed.pathname}`;
    let body = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep text */ } }
    const call = { key, url: parsed, init, body, headers: init.headers ?? {} };
    calls.push(call);
    const route = table[key];
    if (!route) return json(404, { message: 'not found' });
    const result = await route(call);
    if (result instanceof Response) return result;
    const [status, payload, headers] = result;
    return json(status, payload, headers);
  }
  return { fetchImpl, calls, find: key => calls.filter(c => c.key === key) };
}

export function signInRequest(form, { origin = 'https://lgcyap-signin.vercel.app', host = 'lgcyap-signin.vercel.app', contentType } = {}) {
  const request = new Request(`https://${host}/api/submit`, { method: 'POST', body: form });
  const headers = new Headers(request.headers);
  if (origin) headers.set('origin', origin);
  headers.set('host', host);
  if (contentType) headers.set('content-type', contentType);
  return new Request(request, { headers });
}
