// An in-memory stand-in for the HubSpot endpoints the application uses. It records every call
// so tests can check exactly what would be written. No network access.
export function fakeHubSpot({ scopes, hubId = 50894788, tokenInfoStatus = 200, accountPortalId = 50894788, contacts = [], tickets = [], failOn = null } = {}) {
  const state = {
    calls: [],
    contacts: contacts.map(c => ({ ...c, properties: { ...c.properties } })),
    tickets: tickets.map(t => ({ ...t, properties: { ...t.properties } })),
    associations: new Map(), // contactId -> Set(ticketId)
    files: [],
    notes: [],
    nextId: 9000,
  };
  for (const t of state.tickets) {
    if (t.contactId) {
      if (!state.associations.has(t.contactId)) state.associations.set(t.contactId, new Set());
      state.associations.get(t.contactId).add(t.id);
    }
  }
  const allScopes = scopes ?? ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.tickets.read', 'crm.objects.tickets.write', 'files'];
  const json = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  async function fetchImpl(url, init = {}) {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    state.calls.push({ method, pathname, body, auth: init.headers?.Authorization });
    if (failOn && failOn.method === method && pathname.startsWith(failOn.path)) return json(failOn.status ?? 500, { message: 'fail' });

    if (pathname === '/oauth/v2/private-apps/get/access-token-info') {
      return tokenInfoStatus === 200 ? json(200, { hubId, appId: 1, scopes: allScopes }) : json(tokenInfoStatus, { message: 'not found' });
    }
    if (pathname === '/account-info/v3/details' && method === 'GET') return json(200, { portalId: accountPortalId, accountType: 'STANDARD' });
    if (pathname === '/crm/v3/objects/contacts/search') {
      const email = body.filterGroups[0].filters[0].value;
      return json(200, { results: state.contacts.filter(c => c.properties.email === email).map(c => ({ id: c.id, properties: c.properties })) });
    }
    if (pathname === '/crm/v3/objects/contacts' && method === 'POST') {
      const existing = state.contacts.find(c => c.properties.email === body.properties.email);
      if (existing) return json(409, { message: `Contact already exists. Existing ID: ${existing.id}` });
      const id = String(state.nextId++);
      state.contacts.push({ id, properties: { ...body.properties } });
      return json(201, { id });
    }
    let m = /^\/crm\/v3\/objects\/contacts\/(\d+)$/.exec(pathname);
    if (m && method === 'PATCH') {
      Object.assign(state.contacts.find(c => c.id === m[1]).properties, body.properties);
      return json(200, { id: m[1] });
    }
    m = /^\/crm\/v4\/objects\/contacts\/(\d+)\/associations\/tickets$/.exec(pathname);
    if (m) return json(200, { results: [...(state.associations.get(m[1]) ?? [])].map(id => ({ toObjectId: Number(id) })) });
    if (pathname === '/crm/v3/objects/tickets/batch/read') {
      return json(200, { results: body.inputs.map(({ id }) => state.tickets.find(t => t.id === id)).filter(Boolean).map(t => ({ id: t.id, properties: t.properties })) });
    }
    if (pathname === '/crm/v3/objects/tickets' && method === 'POST') {
      const id = String(state.nextId++);
      state.tickets.push({ id, properties: { ...body.properties }, associations: body.associations });
      const contactId = body.associations?.[0]?.to?.id;
      if (contactId) {
        if (!state.associations.has(contactId)) state.associations.set(contactId, new Set());
        state.associations.get(contactId).add(id);
      }
      return json(201, { id });
    }
    m = /^\/crm\/v3\/objects\/tickets\/(\d+)$/.exec(pathname);
    if (m && method === 'PATCH') {
      Object.assign(state.tickets.find(t => t.id === m[1]).properties, body.properties);
      return json(200, { id: m[1] });
    }
    if (pathname === '/files/v3/files' && method === 'POST') {
      const id = String(state.nextId++);
      const file = init.body.get('file');
      state.files.push({ id, name: init.body.get('fileName'), folder: init.body.get('folderPath'), options: JSON.parse(init.body.get('options')), size: file.size, type: file.type });
      return json(201, { id });
    }
    if (pathname === '/crm/v3/objects/notes' && method === 'POST') {
      const id = String(state.nextId++);
      state.notes.push({ id, ...body });
      return json(201, { id });
    }
    return json(404, { message: `no fake for ${method} ${pathname}` });
  }
  return { state, fetchImpl };
}
