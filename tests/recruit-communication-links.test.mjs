import test from 'node:test';
import assert from 'node:assert/strict';
import { communicationAction, safeRecruitCommunicationUrl } from '../app/recruit-communication-links.mjs';

const recordUrl = 'https://app.hubspot.com/contacts/50894788/record/0-5/12345';
const trackedUrl = `${recordUrl}?utm_source=codex&utm_medium=ai_agent&utm_campaign=legacy_recruiting_live`;

test('native HubSpot shortcuts preserve the recruiting record and only add the verified email interaction', () => {
  assert.equal(safeRecruitCommunicationUrl('12345', recordUrl), recordUrl);
  assert.equal(safeRecruitCommunicationUrl('12345', trackedUrl), recordUrl);
  assert.equal(communicationAction('12345', trackedUrl, 'call').href, recordUrl);
  assert.equal(communicationAction('12345', trackedUrl, 'email').href, `${recordUrl}?interaction=email`);
  assert.match(communicationAction('12345', recordUrl, 'call').reason, /then choose Call/);
  assert.equal(new URL(communicationAction('12345', trackedUrl, 'call').href).search, '');
  assert.deepEqual([...new URL(communicationAction('12345', trackedUrl, 'email').href).searchParams], [['interaction', 'email']]);
});

test('foreign origins, credentials, wrong records and unapproved interactions cannot become shortcuts', () => {
  for (const url of [
    'http://app.hubspot.com/contacts/50894788/record/0-5/12345',
    'https://app.hubspot.com.evil.invalid/contacts/50894788/record/0-5/12345',
    'https://evil.invalid/contacts/50894788/record/0-5/12345',
    'https://user:secret@app.hubspot.com/contacts/50894788/record/0-5/12345',
    'https://app.hubspot.com/contacts/1/record/0-5/12345',
    'https://app.hubspot.com/contacts/50894788/record/0-1/12345',
    'https://app.hubspot.com/contacts/50894788/record/0-5/67890',
    `${recordUrl}?redirect=https://evil.invalid`, `${recordUrl}#email`,
    `${recordUrl}?interaction=call`, `${recordUrl}?interaction=email`,
    'javascript:alert(1)', 'mailto:person@example.invalid', 'tel:+12025550123',
  ]) {
    assert.equal(safeRecruitCommunicationUrl('12345', url), null);
    assert.equal(communicationAction('12345', url, 'email').href, null);
    assert.equal(communicationAction('12345', url, 'call').href, null);
  }
});

test('missing or malformed record identities and unsupported actions stay disabled', () => {
  for (const id of ['', '0', '012345', '../12345', '12345?email', 12345]) {
    assert.equal(safeRecruitCommunicationUrl(id, recordUrl), null);
    assert.equal(communicationAction(id, recordUrl, 'call').href, null);
  }
  assert.equal(communicationAction('12345', undefined, 'email').href, null);
  for (const action of ['unknown', 'logged-call', 'email&send=true']) assert.equal(communicationAction('12345', recordUrl, action).href, null);
});

test('tracking values are discarded rather than forwarded into HubSpot interactions', () => {
  const untrustedTracking = `${recordUrl}?utm_source=${encodeURIComponent('https://evil.invalid/?interaction=call')}`;
  assert.equal(communicationAction('12345', untrustedTracking, 'email').href, `${recordUrl}?interaction=email`);
});
