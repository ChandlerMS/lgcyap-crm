import test from 'node:test';
import assert from 'node:assert/strict';
import { offerTemplates, renderOffer } from '../lib/recruit-email.mjs';
import { handleGmailCompose } from '../lib/gmail-compose.mjs';

test('application reminder is available without configured offers and works for every licensing route', () => {
  const reminder = offerTemplates({}).find(t => t.id === 'application-reminder');
  assert.ok(reminder);
  assert.equal(reminder.name, '24 Hr Post Event Application Reminder');
  for (const route of ['licensed', 'not_licensed', '']) {
    const result = renderOffer(reminder, { firstName: 'Alex', route }, { eventDate: '2020-01-01', applicationDeadline: '2099-01-04' });
    assert.match(result.text, /Hi Alex/);
    assert.match(result.html, /https:\/\/lgcyap-apply.vercel.app\//);
    assert.doesNotMatch(result.text, /\{\{|\[Day/);
  }
  assert.throws(() => renderOffer(reminder, { firstName: 'Alex' }, { eventDate: '2020-01-01' }));
});

test('shared composer offers the reminder for licensed, unlicensed, and unknown recipients', async () => {
  for (const route of ['licensed', 'not_licensed', '']) {
    const response = await handleGmailCompose(new Request('https://crm.lgcyap.com/api/recruit-email', {
      method: 'POST', headers: { origin: 'https://crm.lgcyap.com', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare', recruitId: '123' }),
    }), {
      getUser: async () => ({ userId: 'test', email: 'test@lgcyap.com' }),
      env: { BETTER_AUTH_URL: 'https://crm.lgcyap.com', RECRUITING_EDITOR_EMAILS: 'test@lgcyap.com' },
      recipient: async () => ({ firstName: 'Alex', email: 'alex@example.com', route }),
    });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).templates.some(t => t.id === 'application-reminder'));
  }
});
