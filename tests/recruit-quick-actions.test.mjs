import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresLedger } from '../lib/hubspot-write.mjs';
import { createQuickAction, easternNineAm, handleQuickActionRequest, validateQuickAction } from '../lib/recruit-quick-actions.mjs';
import { pageWindow } from '../app/panel-pager.mjs';

const migration = await readFile(new URL('../migrations/0001_recruiting_ledger.sql', import.meta.url), 'utf8');
const TODAY = '2026-11-18';
const clock = () => Date.parse('2026-11-18T22:00:00Z');
const secret = 'synthetic-only-quick-action-hmac-key-0123456789';
const user = { userId: 'synthetic-user', email: 'editor@example.invalid', displayName: 'Synthetic <Editor>' };
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const access = { hubId: 50894788, appId: 59264745, scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'] };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('the three actions accept only their own fields, with sensible limits', () => {
  assert.deepEqual(validateQuickAction({ requestId: id, kind: 'note', body: '  Called, left a voicemail.  ' }, { today: TODAY }), { requestId: id, kind: 'note', body: 'Called, left a voicemail.', subject: '', dueDate: '' });
  assert.equal(validateQuickAction({ requestId: id, kind: 'task', subject: 'Send licensing guide', dueDate: TODAY }, { today: TODAY }).subject, 'Send licensing guide');
  assert.equal(validateQuickAction({ requestId: id, kind: 'follow-up', dueDate: '2026-11-21', body: 'Ask about exam date' }, { today: TODAY }).dueDate, '2026-11-21');
  const rejects = (input, pattern) => assert.throws(() => validateQuickAction({ requestId: id, ...input }, { today: TODAY }), error => error.code === 'INVALID_QUICK_ACTION' && (!pattern || pattern.test(error.message)));
  rejects({ kind: 'note', body: '   ' }, /Enter the note/);
  rejects({ kind: 'note', body: 'x'.repeat(5001) }, /5000/);
  rejects({ kind: 'note', body: 'ok', dueDate: TODAY });
  rejects({ kind: 'task', dueDate: TODAY }, /task title/);
  rejects({ kind: 'task', subject: 'two\nlines', dueDate: TODAY }, /unusual/);
  rejects({ kind: 'task', subject: 'Call', dueDate: '2026-11-17' }, /today or a later/);
  rejects({ kind: 'task', subject: 'Call', dueDate: '2029-01-01' }, /two years/);
  rejects({ kind: 'task', subject: 'Call', dueDate: '2026-02-30' }, /due date/);
  rejects({ kind: 'follow-up', subject: 'Custom', dueDate: TODAY });
  rejects({ kind: 'follow-up' }, /due date/);
  rejects({ kind: 'note', body: 'ok', hubspot_owner_id: '1' });
  rejects({ kind: 'email', body: 'ok' });
  assert.throws(() => validateQuickAction({ requestId: 'not-a-uuid', kind: 'note', body: 'ok' }, { today: TODAY }), { code: 'INVALID_QUICK_ACTION' });
});

test('tasks are due at 9 AM Eastern in winter and summer', () => {
  assert.equal(new Date(easternNineAm('2026-11-18')).toISOString(), '2026-11-18T14:00:00.000Z');
  assert.equal(new Date(easternNineAm('2026-07-01')).toISOString(), '2026-07-01T13:00:00.000Z');
});

test('panel pages stay in range and count rows from one', () => {
  assert.deepEqual(pageWindow(23, 1, 10), { page: 1, pages: 3, start: 0, end: 10, rows: 23 });
  assert.deepEqual(pageWindow(23, 3, 10), { page: 3, pages: 3, start: 20, end: 23, rows: 23 });
  assert.deepEqual(pageWindow(23, 9, 10), { page: 3, pages: 3, start: 20, end: 23, rows: 23 });
  assert.deepEqual(pageWindow(23, 0, 5), { page: 1, pages: 5, start: 0, end: 5, rows: 23 });
  assert.deepEqual(pageWindow(0, 4, 25), { page: 1, pages: 1, start: 0, end: 0, rows: 0 });
});

function hubspot({ pipeline = '924992938', contacts = [{ id: '501' }], owners = [{ id: '77', email: 'editor@example.invalid', firstName: 'Synthetic', lastName: 'Editor' }], create = () => json({ id: '9001' }, 201) } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, pathname, body });
    assert.equal(init.redirect, 'manual');
    if (pathname === '/oauth/v2/private-apps/get/access-token-info') return json(access);
    if (method === 'GET' && pathname === '/crm/v3/objects/tickets/456') return json({ id: '456', properties: { hs_pipeline: pipeline, subject: 'Recruiting: Synthetic Recruit', recruit_name: 'Synthetic Recruit' }, associations: { contacts: { results: contacts } } });
    if (method === 'GET' && pathname === '/crm/v3/owners/') return json({ results: new URL(url).searchParams.get('archived') === 'true' ? [] : owners });
    if (method === 'POST' && ['/crm/v3/objects/notes', '/crm/v3/objects/tasks', '/crm/v3/objects/meetings'].includes(pathname)) return create();
    throw new Error(`Unexpected HubSpot call ${method} ${pathname}`);
  };
  return { calls, fetchImpl };
}
async function ledger() { const db = new PGlite(); await db.exec(migration); return createPostgresLedger(db); }
const options = async fetchImpl => ({ user, accessToken: 'synthetic-token', hmacSecret: secret, ledger: await ledger(), fetchImpl, now: clock });
const posts = calls => calls.filter(call => call.method === 'POST' && call.pathname !== '/oauth/v2/private-apps/get/access-token-info');

test('a quick note lands on the recruit and its contact, escaped, and a retry never adds a second', async () => {
  const { calls, fetchImpl } = hubspot();
  const settings = await options(fetchImpl);
  const input = { requestId: id, kind: 'note', body: 'Line one <b>\n\nSecond paragraph' };
  const result = await createQuickAction('456', input, settings);
  assert.equal(result.status, 'saved');
  assert.equal(result.hubspotUrl, 'https://app.hubspot.com/contacts/50894788/record/0-5/456');
  const [note] = posts(calls);
  assert.equal(note.pathname, '/crm/v3/objects/notes');
  assert.equal(note.body.properties.hs_note_body, '<p>Line one &lt;b&gt;</p><p>Second paragraph</p><p><em>Added in the CRM by Synthetic &lt;Editor&gt;</em></p>');
  assert.equal(note.body.properties.hs_timestamp, '2026-11-18T22:00:00.000Z');
  assert.deepEqual(note.body.associations.map(item => [item.to.id, item.types[0].associationTypeId]), [['456', 228], ['501', 202]]);
  // Notes need no owner lookup.
  assert.equal(calls.some(call => call.pathname === '/crm/v3/owners/'), false);
  const again = await createQuickAction('456', input, settings);
  assert.equal(again.replayed, true);
  assert.equal(posts(calls).length, 1);
  await assert.rejects(createQuickAction('456', { ...input, body: 'Different text' }, settings), { code: 'REQUEST_ID_REUSED' });
});

test('Add task and Follow up create a task assigned to the signed-in user, due at 9 AM Eastern', async () => {
  const task = hubspot();
  const saved = await createQuickAction('456', { requestId: id, kind: 'task', subject: 'Send licensing guide', dueDate: '2026-11-20', body: 'Include the exam link' }, await options(task.fetchImpl));
  assert.deepEqual([saved.status, saved.subject, saved.dueDate], ['saved', 'Send licensing guide', '2026-11-20']);
  const [created] = posts(task.calls);
  assert.equal(created.pathname, '/crm/v3/objects/tasks');
  assert.deepEqual({ ...created.body.properties, hs_task_body: undefined }, { hs_timestamp: '2026-11-20T14:00:00.000Z', hs_task_subject: 'Send licensing guide', hs_task_body: undefined, hs_task_status: 'NOT_STARTED', hs_task_type: 'TODO', hubspot_owner_id: '77' });
  assert.match(created.body.properties.hs_task_body, /^<p>Include the exam link<\/p><p><em>Task added in the CRM by/);
  assert.deepEqual(created.body.associations.map(item => [item.to.id, item.types[0].associationTypeId]), [['456', 230], ['501', 204]]);
  const followUp = hubspot({ contacts: [] });
  await createQuickAction('456', { requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', kind: 'follow-up', dueDate: '2026-11-25' }, await options(followUp.fetchImpl));
  const [scheduled] = posts(followUp.calls);
  assert.equal(scheduled.body.properties.hs_task_subject, 'Follow up with Synthetic Recruit');
  assert.equal(scheduled.body.properties.hs_task_type, 'CALL');
  assert.deepEqual(scheduled.body.associations.map(item => item.to.id), ['456']);
});

test('quick actions refuse recruits outside the pipeline and users without a HubSpot user, and report HubSpot outcomes honestly', async () => {
  await assert.rejects(createQuickAction('456', { requestId: id, kind: 'note', body: 'x' }, await options(hubspot({ pipeline: '0' }).fetchImpl)), { code: 'RECORD_NOT_FOUND' });
  await assert.rejects(createQuickAction('456', { requestId: id, kind: 'task', subject: 'Call', dueDate: TODAY }, await options(hubspot({ owners: [{ id: '78', email: 'someone.else@example.invalid' }] }).fetchImpl)), { code: 'HUBSPOT_OWNER_NOT_FOUND' });
  await assert.rejects(createQuickAction('nope', { requestId: id, kind: 'note', body: 'x' }, await options(hubspot().fetchImpl)), { code: 'RECORD_NOT_FOUND' });
  // A definite rejection is final for that request; an unconfirmed one stays unconfirmed on retry.
  const rejected = await options(hubspot({ create: () => json({ message: 'bad' }, 400) }).fetchImpl);
  await assert.rejects(createQuickAction('456', { requestId: id, kind: 'note', body: 'x' }, rejected), { code: 'HUBSPOT_REJECTED' });
  await assert.rejects(createQuickAction('456', { requestId: id, kind: 'note', body: 'x' }, rejected), { code: 'QUICK_ACTION_FAILED' });
  const lost = await options(hubspot({ create: () => json({ message: 'busy' }, 503) }).fetchImpl);
  await assert.rejects(createQuickAction('456', { requestId: id, kind: 'note', body: 'x' }, lost), error => error.code === 'SAVE_UNCERTAIN' && error.uncertain);
  await assert.rejects(createQuickAction('456', { requestId: id, kind: 'note', body: 'x' }, lost), { code: 'SAVE_UNCERTAIN' });
});

test('the endpoint keeps the CRM write checks: sign-in, editor list, write switch, production, origin, JSON', async () => {
  const origin = 'https://crm.example.invalid';
  const request = (headers = {}, body = JSON.stringify({ requestId: id, kind: 'note', body: 'x' })) => new Request(`${origin}/api/recruits/456/actions`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body });
  let saves = 0;
  const base = { getUser: async () => user, editorEmails: user.email, writesEnabled: 'true', vercel: '1', vercelEnv: 'production', accessToken: 'synthetic-token', hmacSecret: secret, ledger: { claim() {}, finish() {} }, allowedOrigin: origin, saveData: async (recruitId, input, context) => { saves++; assert.equal(recruitId, '456'); assert.equal(context.user, user); return { status: 'saved', kind: 'note' }; } };
  assert.equal((await handleQuickActionRequest(request(), '456', { ...base, getUser: async () => null })).status, 401);
  for (const change of [{ editorEmails: 'someone@example.invalid' }, { writesEnabled: 'false' }, { vercelEnv: 'preview' }, { ledger: undefined }, { hmacSecret: 'short' }]) {
    assert.equal((await handleQuickActionRequest(request(), '456', { ...base, ...change })).status, 403, JSON.stringify(change));
  }
  assert.equal((await handleQuickActionRequest(request({ Origin: 'https://other.example.invalid' }), '456', base)).status, 403);
  assert.equal((await handleQuickActionRequest(request({ 'Content-Type': 'text/plain' }), '456', base)).status, 400);
  assert.equal((await handleQuickActionRequest(request({}, 'x'.repeat(40 * 1024)), '456', base)).status, 400);
  assert.equal(saves, 0);
  const ok = await handleQuickActionRequest(request(), '456', base);
  assert.equal(ok.status, 201);
  assert.match(ok.headers.get('Cache-Control'), /private, no-store/);
  assert.equal(saves, 1);
});


test('a meeting saves its exact UTC time, owner and recruit associations once', async () => {
  const provider = hubspot();
  const settings = await options(provider.fetchImpl);
  const input = { requestId: id, kind: 'meeting', subject: 'Licensing meeting', startsAt: '2026-11-20T15:00:00.000Z', endsAt: '2026-11-20T15:30:00.000Z', location: 'Office', body: '<Notes>' };
  const result = await createQuickAction('456', input, settings);
  assert.equal(result.status, 'saved');
  const [created] = posts(provider.calls);
  assert.equal(created.pathname, '/crm/v3/objects/meetings');
  assert.equal(created.body.properties.hs_meeting_start_time, input.startsAt);
  assert.equal(created.body.properties.hs_meeting_end_time, input.endsAt);
  assert.equal(created.body.properties.hs_meeting_title, input.subject);
  assert.equal(created.body.properties.hs_meeting_location, 'Office');
  assert.equal(created.body.properties.hubspot_owner_id, '77');
  assert.match(created.body.properties.hs_meeting_body, /&lt;Notes&gt;/);
  assert.deepEqual(created.body.associations.map(item => [item.to.id, item.types[0].associationTypeId]), [['456',216],['501',200]]);
  assert.equal((await createQuickAction('456', input, settings)).replayed, true);
  assert.equal(posts(provider.calls).length,1);
  await assert.rejects(createQuickAction('456', {...input, location:'Changed'}, settings), {code:'REQUEST_ID_REUSED'});
});

test('meeting validation rejects missing titles, invalid times and reversed times before a write', () => {
  const input = { requestId:id, kind:'meeting', subject:'Meeting', startsAt:'2026-11-20T15:00:00.000Z', endsAt:'2026-11-20T15:30:00.000Z' };
  for(const changed of [{subject:''},{startsAt:'2026-02-30T15:00:00.000Z'},{endsAt:input.startsAt},{endsAt:'bad'},{dueDate:TODAY},{startsAt:'2030-11-20T15:00:00.000Z',endsAt:'2030-11-20T16:00:00.000Z'}]) assert.throws(()=>validateQuickAction({...input,...changed},{today:TODAY}),{code:'INVALID_QUICK_ACTION'});
  assert.throws(()=>validateQuickAction({requestId:id,kind:'note',body:'Note',startsAt:input.startsAt},{today:TODAY}),{code:'INVALID_QUICK_ACTION'});
});
