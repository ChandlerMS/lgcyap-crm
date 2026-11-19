import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEmailInput, renderOffer, emailMime, sendGmail, cleanOfferHtml, verifiedRecipient } from '../lib/recruit-email.mjs';

test('offer sanitization keeps dark background behind white text and removes active content', () => {
  const html = cleanOfferHtml('<p style="background:rgb(17,17,17);color:rgb(255,255,255)" onclick="alert(1)">Offer</p><script>alert(1)</script><a href="javascript:alert(1)">Bad</a>');
  assert.match(html, /background:rgb\(17,17,17\)/);
  assert.doesNotMatch(html, /onclick|script|javascript/);
});

test('recipient verification rejects conflicting contacts and uses current licensing declaration', async () => {
  let contacts = ['2'];
  let ticketEmail = 'recruit@example.com';
  const fetchImpl = async url => Response.json(url.includes('/tickets/1?') ? { id:'1', properties:{ hs_pipeline:'924992938', licensing_branch:'licensed', intake_license_status:'unlicensed', recruit_email:ticketEmail } } : url.includes('/batch/read') ? { status:'COMPLETE', results:[{from:{id:'1'},to:contacts.map(toObjectId=>({toObjectId}))}] } : {id:'2',properties:{email:'recruit@example.com',firstname:'Recruit'}});
  assert.equal((await verifiedRecipient('1',{accessToken:'test',fetchImpl})).route,'not_licensed');
  contacts = ['2','3'];
  await assert.rejects(verifiedRecipient('1',{accessToken:'test',fetchImpl}), /exactly one/);
  contacts = ['2']; ticketEmail = 'different@example.com';
  await assert.rejects(verifiedRecipient('1',{accessToken:'test',fetchImpl}), /different email/);
});

test('mail rejects header injection, missing placeholders and wrong license route', () => {
  assert.throws(() => validateEmailInput({ subject: 'Hi\r\nBcc: attacker@example.com', body: 'Hello' }));
  const template = { id: 'licensed', route: 'licensed', html: 'Hi {{firstName}} {{acceptBy}}', text: 'Hi {{firstName}} {{acceptBy}}' };
  assert.throws(() => renderOffer(template, { firstName: 'A', route: 'not_licensed' }, { acceptBy: '2026-12-01' }));
  assert.throws(() => renderOffer(template, { firstName: 'A', route: 'licensed' }, {}));
  assert.match(renderOffer(template, { firstName: '<script>', route: 'licensed' }, { acceptBy: '2026-12-01' }).html, /&lt;script&gt;/);
});

test('MIME safely encodes Unicode and includes inline logo', () => {
  const raw = emailMime({ from: 'staff@example.com', to: 'recruit@example.com', subject: 'Welcome — offer', text: 'Hello', html: '<p>Hello</p>', assets: [{ cid: 'logo', data: 'aGVsbG8=' }] });
  const mime = Buffer.from(raw, 'base64url').toString();
  assert.match(mime, /Content-ID: <logo>/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.throws(() => emailMime({ from: 'x\r\nBcc: z', to: 'a@b.com', subject: 'Hello', text: 'Hello' }));
});

test('Gmail requires provider acceptance and never automatically retries', async () => {
  let calls = 0;
  await assert.rejects(sendGmail('token', 'mime', async () => { calls++; throw new Error('timeout'); }), /uncertain/i);
  assert.equal(calls, 1);
  await assert.rejects(sendGmail('token', 'mime', async () => new Response('{}', { status: 200 })), /uncertain/i);
  assert.equal(await sendGmail('token', 'mime', async () => Response.json({ id: 'message-123' })), 'message-123');
});
