const CONTACT_FIELDS = ['firstname', 'lastname', 'phone', 'email', 'notes_last_contacted'];
const id = value => typeof value === 'number' && !Number.isSafeInteger(value) ? null : /^[1-9]\d{0,19}$/.test(String(value ?? '')) ? String(value) : null;
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) || null : null;
function timestamp(value) {
  if (!['string', 'number'].includes(typeof value) || value === '') return null;
  const raw = String(value), millis = /^\d+$/.test(raw) ? Number(raw) : /^\d{4}-\d{2}-\d{2}T/.test(raw) ? Date.parse(raw) : NaN;
  const calendar = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (calendar) { const [, year, month, day] = calendar.map(Number); if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null; }
  return Number.isFinite(millis) && Math.abs(millis) <= 8.64e15 ? new Date(millis).toISOString() : null;
}

/** Optional bounded association reads. Never infer contact identity from names or email. */
export async function enrichRecruitContacts(recruits, { accessToken, fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  const rows = recruits.map(recruit => ({ ...recruit, contactId: null, contactStatus: 'unavailable' }));
  const deadline = performance.now() + 12000;
  async function read(path, body) {
    if (performance.now() >= deadline) throw Error('budget');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, deadline - performance.now()));
    try {
      const response = await fetchImpl(`https://api.hubapi.com${path}`, { method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw Error('unavailable');
      const reader = response.body?.getReader(); if (!reader) throw Error('payload');
      const chunks = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw Error('payload'); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder().decode(bytes));
    } finally { clearTimeout(timer); }
  }
  for (let start = 0; start < Math.min(rows.length, 1000); start += 100) {
    const group = rows.slice(start, start + 100), requested = new Set(group.map(row => row.id));
    try {
      const associations = await read('/crm/v4/associations/tickets/contacts/batch/read', { inputs: [...requested].map(id => ({ id })) });
      if (associations.status !== 'COMPLETE' || !Array.isArray(associations.results) || associations.results.length > group.length || associations.errors?.length) throw Error('payload');
      const bindings = new Map();
      for (const result of associations.results) {
        const from = id(result?.from?.id);
        if (!from || !requested.has(from) || bindings.has(from) || !Array.isArray(result.to) || result.to.length > 1000) throw Error('payload');
        const ids = new Set(result.to.map(item => id(item?.toObjectId)));
        if (ids.has(null)) throw Error('payload');
        bindings.set(from, result.paging?.next ? { status: 'ambiguous', id: null } : ids.size === 1 ? { status: 'unique', id: [...ids][0] } : { status: ids.size ? 'ambiguous' : 'missing', id: null });
      }
      const contactIds = [...new Set([...bindings.values()].filter(item => item.id).map(item => item.id))];
      const facts = new Map();
      if (contactIds.length) {
        const contacts = await read('/crm/v3/objects/contacts/batch/read', { properties: CONTACT_FIELDS, inputs: contactIds.map(id => ({ id })) });
        if (contacts.status !== 'COMPLETE' || !Array.isArray(contacts.results) || contacts.results.length > contactIds.length || contacts.errors?.length) throw Error('payload');
        for (const contact of contacts.results) {
          const contactId = id(contact?.id);
          if (!contactId || !contactIds.includes(contactId) || facts.has(contactId) || contact.archived || !contact.properties || typeof contact.properties !== 'object' || CONTACT_FIELDS.some(field => !Object.hasOwn(contact.properties, field) || contact.properties[field] !== null && typeof contact.properties[field] !== 'string')) throw Error('payload');
          facts.set(contactId, contact.properties);
        }
      }
      for (const recruit of group) {
        const binding = bindings.get(recruit.id); if (!binding) continue;
        recruit.contactStatus = binding.status === 'missing' ? 'unlinked' : binding.status;
        if (!binding.id) continue;
        const contact = facts.get(binding.id); if (!contact) { recruit.contactStatus = 'unavailable'; continue; }
        recruit.contactStatus = 'available';
        recruit.contactId = binding.id; recruit.firstName = text(contact.firstname, 100); recruit.lastName = text(contact.lastname, 100);
        recruit.phone = text(contact.phone, 80) ?? recruit.phone; recruit.email = text(contact.email, 254) ?? recruit.email;
        recruit.contactName = [recruit.firstName, recruit.lastName].filter(Boolean).join(' ') || null;
        const contactTime = timestamp(contact.notes_last_contacted), ticketTime = recruit.lastContactedAt;
        if (contactTime && (!ticketTime || contactTime > ticketTime)) { recruit.lastContactedAt = contactTime; recruit.lastContactedSource = 'contact'; }
        else if (contactTime && contactTime === ticketTime) recruit.lastContactedSource = 'ticket-and-contact';
      }
    } catch { /* Optional enrichment must not hide recruiting records or guess identities. */ }
  }
  return rows;
}
