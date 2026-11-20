import test from 'node:test';
import assert from 'node:assert/strict';
import { hubspotEmailHandoff } from '../lib/hubspot-email.mjs';

test('handoff opens the verified contact in the correct portal with license-specific guidance', () => {
  const handoff = hubspotEmailHandoff({ contactId: '123', route: 'licensed' });
  assert.equal(handoff.contactUrl, 'https://app.hubspot.com/contacts/50894788/record/0-1/123');
  assert.deepEqual(handoff.templates.map(t => t.name), ['Licensed Offer', '24 Hr Post Event Application Reminder']);
  assert.match(handoff.templates[0].url, /135101045$/);
  assert.deepEqual(hubspotEmailHandoff({ contactId: '123', route: 'not_licensed' }).templates.map(t => t.name), ['Unlicensed - Offer', '24 Hr Post Event Application Reminder']);
  assert.deepEqual(hubspotEmailHandoff({ contactId: '123', route: '' }).templates.map(t => t.name), ['24 Hr Post Event Application Reminder']);
});

test('handoff rejects unsafe contact identifiers', () => {
  for (const contactId of ['', '../456', '123?other=1', 'https://example.com']) {
    assert.throws(() => hubspotEmailHandoff({ contactId, route: 'licensed' }));
  }
});
