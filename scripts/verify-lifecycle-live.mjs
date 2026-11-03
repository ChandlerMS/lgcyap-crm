// Explicitly approved disposable fixture only. Never used by the normal build.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPool } from '../db/pool.mjs';
import { PIPELINE_ID, RECRUIT_PROPERTIES } from '../lib/recruiting-config.mjs';
import { normalizeRecruit } from '../lib/hubspot.mjs';
import { createPostgresLedger, saveRecruit, validateWriteInput } from '../lib/hubspot-write.mjs';
import { verifyRecruitIntakeAccess } from '../lib/recruit-intake.mjs';
import { createLifecycleProvider, createLifecycleStore, reconcileLifecycle, withLifecycleLock } from '../lib/recruit-lifecycle-sync.mjs';

if (process.argv[2] !== '--approved-test' || process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
  console.error('Live verification requires explicit approval and a Production build.'); process.exitCode = 1;
} else {
  const pool = getPool(), token = process.env.HUBSPOT_ACCESS_TOKEN;
  let contactId, ticketId, phase = 'access', verified = false, archived = false;
  async function api(path, method = 'GET', body) {
    const response = await fetch(`https://api.hubapi.com${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, method === 'DELETE' ? 204 : method === 'POST' && !path.endsWith('/search') ? 201 : 200);
    return response.status === 204 ? null : response.json();
  }
  try {
    await verifyRecruitIntakeAccess({ accessToken: token });
    const existing = await api('/crm/v3/objects/contacts/search', 'POST', { filterGroups: [{ filters: [
      { propertyName: 'firstname', operator: 'EQ', value: 'Lifecycle Sync' }, { propertyName: 'lastname', operator: 'EQ', value: 'Test' },
    ] }], properties: ['firstname', 'lastname'], limit: 2 });
    assert.equal(existing.total, 0, 'An earlier test record needs review before another test.');
    phase = 'create_contact';
    const contact = await api('/crm/v3/objects/contacts', 'POST', { properties: { firstname: 'Lifecycle Sync', lastname: 'Test', recruiting_lifecycle_stage: 'application' } });
    contactId = contact.id;
    assert.match(contactId, /^[1-9]\d{0,19}$/);
    console.log(JSON.stringify({ lifecycleTest: 'contact_created', contactId }));
    const labels = await api('/crm/v4/associations/tickets/contacts/labels');
    const types = labels.results.filter(row => row.category === 'HUBSPOT_DEFINED' && row.label === null);
    assert.equal(types.length, 1);
    phase = 'create_ticket';
    const ticket = await api('/crm/v3/objects/tickets', 'POST', { properties: {
      subject: 'Lifecycle Sync Test', recruit_name: 'Lifecycle Sync Test', hs_pipeline: PIPELINE_ID,
      hs_pipeline_stage: '1473318769', recruiting_path: 'mass_recruiting',
    }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: types[0].typeId }] }] });
    ticketId = ticket.id;
    assert.match(ticketId, /^[1-9]\d{0,19}$/);
    console.log(JSON.stringify({ lifecycleTest: 'ticket_created', contactId, ticketId }));
    await withLifecycleLock(pool, async () => {
      const options = { provider: createLifecycleProvider({ accessToken: token, deadline: Date.now() + 90000 }), store: createLifecycleStore(pool) };
      phase = 'initialize';
      assert.equal((await reconcileLifecycle(ticketId, options)).status, 'synced');
      const beforeContact = await api(`/crm/v3/objects/contacts/${contactId}?properties=lifecyclestage,recruiting_lifecycle_stage`);
      const beforeTicket = normalizeRecruit(await api(`/crm/v3/objects/tickets/${ticketId}?properties=${RECRUIT_PROPERTIES.join(',')}`));
      phase = 'app_ticket_to_contact';
      const input = validateWriteInput(ticketId, { requestId: randomUUID(), expectedUpdatedAt: beforeTicket.updatedAt,
        changes: { hs_pipeline_stage: '1473225368' }, expectedValues: { hs_pipeline_stage: '1473318769' } });
      const saved = await saveRecruit(input, { userId: 'approved-lifecycle-verification', accessToken: token, ledger: createPostgresLedger(pool) });
      assert.equal(saved.status, 'saved');
      assert.equal((await reconcileLifecycle(ticketId, options)).direction, 'ticket_to_contact');
      assert.equal((await options.provider.pair(ticketId)).contactStage, 'phone_interview');
      console.log(JSON.stringify({ lifecycleTest: phase, passed: true }));
      phase = 'contact_to_ticket';
      await api(`/crm/v3/objects/contacts/${contactId}`, 'PATCH', { properties: { recruiting_lifecycle_stage: 'application' } });
      assert.equal((await reconcileLifecycle(ticketId, options)).direction, 'contact_to_ticket');
      assert.equal((await options.provider.pair(ticketId)).ticketStage, '1473318769');
      const afterContact = await api(`/crm/v3/objects/contacts/${contactId}?properties=lifecyclestage,recruiting_lifecycle_stage`);
      assert.equal(afterContact.properties.lifecyclestage, beforeContact.properties.lifecyclestage);
      assert.equal((await reconcileLifecycle(ticketId, options)).direction, undefined);
      console.log(JSON.stringify({ lifecycleTest: phase, passed: true, salesLifecyclePreserved: true, noEchoWrite: true }));
      verified = true;
    });
  } catch {
    console.error(JSON.stringify({ lifecycleTest: 'failed', phase, contactId, ticketId, automaticRetry: false }));
    process.exitCode = 1;
  } finally {
    try {
      // Archive only IDs created in this invocation. Both are recoverable in HubSpot.
      if (ticketId) { await api(`/crm/v3/objects/tickets/${ticketId}`, 'DELETE'); assert.equal((await api(`/crm/v3/objects/tickets/${ticketId}?archived=true`)).archived, true); }
      if (contactId) { await api(`/crm/v3/objects/contacts/${contactId}`, 'DELETE'); assert.equal((await api(`/crm/v3/objects/contacts/${contactId}?archived=true`)).archived, true); }
      archived = true;
    } catch { console.error(JSON.stringify({ lifecycleTest: 'cleanup_needs_review', contactId, ticketId })); process.exitCode = 1; }
    console.log(JSON.stringify({ lifecycleTest: 'complete', verified, archived, contactId, ticketId }));
    await pool.end();
  }
}
