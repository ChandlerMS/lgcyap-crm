import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { initializeCustomRecruitStore, createCustomRecruitStore, withCustomRecruitLock } from '../db/custom-recruit-sync.mjs';
import { customRecruitSyncEnabled, runCustomRecruitJob, syncCustomRecruit, customRecruitReadStatus } from '../lib/custom-recruit-job.mjs';
import { PIPELINE_ID, stageIdForKey } from '../lib/recruiting-config.mjs';
import { createRecruitProperties } from '../lib/custom-recruit-model.mjs';
const secret = 'test-only-custom-sync-secret-long-enough';
async function database(t) {
  const db = new PGlite(); t.after(() => db.close());
  const locks = new Set(), commands = [];
  const query = async (sql, args) => {
    if (sql.trim().startsWith('CREATE TABLE')) { await db.exec(sql); return { rows: [] }; }
    return db.query(sql, args);
  };
  let clientId = 0;
  const pool = { query, async connect() {
    const id = ++clientId, held = new Set(); let transaction = false;
    return {
      async query(sql, args) {
        commands.push({ id, sql });
        if (sql === 'BEGIN') { transaction = true; return { rows: [] }; }
        if (sql === 'ROLLBACK') { for (const key of held) locks.delete(key); held.clear(); transaction = false; return { rows: [] }; }
        assert.ok(!/pg_try_advisory_lock\(|pg_advisory_unlock\(/.test(sql), 'session locks cannot survive transaction pooling');
        if (sql.includes('pg_try_advisory_xact_lock')) {
          assert.equal(transaction, true);
          const acquired = !locks.has(args[0]);
          if (acquired) { locks.add(args[0]); held.add(args[0]); }
          return { rows: [{ acquired }] };
        }
        return query(sql, args);
      },
      release() { assert.equal(transaction, false, 'release must follow ROLLBACK'); },
    };
  } };
  await initializeCustomRecruitStore(pool);
  return { db, pool, commands, store: createCustomRecruitStore(pool) };
}
function providerFixture(stage = 'hiring-event') {
  const ticket = { id: '101', properties: { hs_pipeline: PIPELINE_ID, hs_pipeline_stage: stageIdForKey(stage), recruiting_path: 'genpop', recruit_name: 'Private Candidate', source_type: 'FORM' } };
  const recruit = { id: '202', properties: createRecruitProperties(ticket.properties, ticket.id) };
  const writes = [], notes = [];
  const provider = {
    async verifyAndSetup() {}, async applicationNotes() { return { records: notes, more: false }; },
    async applicationNote(id) { return notes.find(note => note.id === id); },
    async associations() { return ['303']; },
    async applicationTicket(application) { writes.push(['ensureTicket', application.id]); return ticket.id; },
    async listRecruits() { return { records: [], more: false }; },
    async changedTickets() { return { records: [], more: false }; }, async changedRecruits() { return { records: [], more: false }; }, async listTickets() { return { records: [], more: false }; },
    async readTicket() { return structuredClone(ticket); }, async pair() { return structuredClone({ ticket, recruit, contactId: '303' }); },
    async patchTicket(id, props) { writes.push(['ticket', props]); Object.assign(ticket.properties, props); },
    async patchRecruit(id, props) { writes.push(['recruit', props]); Object.assign(recruit.properties, props); },
    async linkRecruit(...ids) { writes.push(['link', ...ids]); },
  };
  return { provider, ticket, recruit, writes, notes };
}
const applicationNote = id => ({ id, properties: { hs_note_body: '<p>Agent application (v1) submitted online</p><p><strong>Required items:</strong> Meets all required items</p>' } });

test('custom sync requires production, writes, dedicated flag, database and secret', () => {
  const env = { VERCEL: '1', VERCEL_ENV: 'production', RECRUITING_WRITES_ENABLED: 'true', RECRUITING_CUSTOM_SYNC_ENABLED: 'true', DATABASE_URL: 'postgres://test', BETTER_AUTH_SECRET: secret };
  assert.equal(customRecruitSyncEnabled(env), true);
  for (const key of Object.keys(env)) assert.equal(customRecruitSyncEnabled({ ...env, [key]: '' }), false, key);
  assert.equal(customRecruitSyncEnabled({ ...env, VERCEL_ENV: 'preview' }), false);
});
test('schema initialization repeats and stores metadata without personal values', async t => {
  const { pool, db, store } = await database(t);
  await initializeCustomRecruitStore(pool);
  const f = providerFixture();
  assert.equal((await syncCustomRecruit('101', { pool, store, provider: f.provider, secret })).status, 'synced');
  const state = (await db.query('SELECT * FROM recruit_custom_sync')).rows;
  assert.equal(state[0].ticket_id, '101'); assert.equal(state[0].recruit_id, '202');
  assert.ok(!JSON.stringify(state).includes('Private Candidate'));
  const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'recruit_custom_%'")).rows.map(row => row.column_name);
  assert.ok(!columns.some(column => /name|phone|email|body/.test(column)));
});
test('empty sources finish harmlessly and save cursors', async t => {
  const { pool, store } = await database(t); const f = providerFixture();
  const result = await runCustomRecruitJob({ pool, provider: f.provider, secret });
  assert.equal(result.status, 'synced'); assert.equal(result.processed, 0); assert.equal(result.remaining, false);
  assert.equal((await store.job()).cursor_id, '0'); assert.deepEqual(f.writes, []);
});
test('application source is marked then advances existing genpop hiring event after baseline', async t => {
  const { pool, store } = await database(t); const f = providerFixture(); f.notes.push(applicationNote('401'));
  const originalPatch = f.provider.patchTicket;
  f.provider.patchTicket = async (id, props) => {
    if (props.hs_pipeline_stage) { assert.equal(await store.hasApplication(id), true); assert.equal((await store.get(id)).status, 'synced'); }
    return originalPatch(id, props);
  };
  const result = await runCustomRecruitJob({ pool, provider: f.provider, secret });
  assert.equal(result.status, 'synced'); assert.equal(result.applications, 1); assert.equal(result.synced, 1);
  assert.equal(f.writes[0][0], 'ensureTicket');
  assert.equal(f.ticket.properties.hs_pipeline_stage, stageIdForKey('application'));
  assert.equal(f.recruit.properties.hs_pipeline_stage, createRecruitProperties(f.ticket.properties, '101').hs_pipeline_stage);
});
test('applications never rewind advanced and closed tickets', async t => {
  const { pool, store } = await database(t);
  for (const stage of ['offer', 'training', 'completed', 'withdrawn', 'rejected']) {
    const f = providerFixture(stage); await store.markApplication(`note-${stage}`, '101', '303');
    // Each stage has its own initial baseline, as these are independent recruits.
    await pool.query('DELETE FROM recruit_custom_sync');
    assert.equal((await syncCustomRecruit('101', { pool, provider: f.provider, store, secret })).status, 'synced');
    assert.equal(f.ticket.properties.hs_pipeline_stage, stageIdForKey(stage));
    assert.equal(f.writes.filter(row => row[0] === 'ticket').length, 0);
  }
});
test('a failed application is deferred while later notes progress and retry later', async t => {
  const { pool, store } = await database(t); const f = providerFixture('application');
  f.notes.push(applicationNote('401'), applicationNote('402'));
  const original = f.provider.applicationTicket; let fail = true;
  f.provider.applicationTicket = async app => { if (app.id === '401' && fail) throw Error('source failed'); return original(app); };
  const first = await runCustomRecruitJob({ pool, provider: f.provider, secret });
  assert.equal(first.status, 'needs_attention'); assert.equal(first.applications, 1);
  assert.deepEqual(await store.retryApplications(), ['401']); assert.equal((await store.job()).application_cursor, '402');
  const firstNote = f.notes[0]; f.notes.splice(0); f.provider.applicationNote = async id => { assert.equal(id, '401'); return firstNote; }; fail = false;
  const next = await runCustomRecruitJob({ pool, provider: f.provider, secret });
  assert.equal(next.applications, 1); assert.deepEqual(await store.retryApplications(), []);
});
test('field conflicts propagate to job summary and status links use the fixed portal', async t => {
  const { pool, store } = await database(t); const f = providerFixture();
  f.recruit.properties.recruit_name = 'Different Candidate';
  f.provider.listTickets = async () => ({ records: [{ id: '101' }], more: false });
  const result = await runCustomRecruitJob({ pool, provider: f.provider, secret });
  assert.equal(result.status, 'needs_attention'); assert.equal(result.attention, 1); assert.equal((await store.get('101')).status, 'conflict');
  assert.deepEqual(f.writes, []);
  await store.put('101', { status: 'conflict', recruitId: '202', contactId: '303' });
  const status = await customRecruitReadStatus(pool, [{ id: '101' }, { id: '404' }]);
  assert.equal(status.recruits[0].customRecruitUrl, 'https://app.hubspot.com/contacts/50894788/record/2-72246945/202');
  assert.equal(status.recruits[0].customRecruitSync.status, 'conflict'); assert.equal(status.recruits[1].customRecruitSync.status, 'pending');
  await store.put('101', { status: 'conflict', recruitId: 'javascript:bad' });
  assert.equal((await customRecruitReadStatus(pool, [{ id: '101' }])).recruits[0].customRecruitUrl, undefined);
});
test('an unavailable deferred note does not block a newly arrived application', async t => {
  const { pool, store } = await database(t); const f = providerFixture('application');
  await store.deferApplication('400', 'unavailable');
  f.notes.push(applicationNote('402'));
  f.provider.applicationNote = async () => { throw Error('note read failed'); };
  const result = await runCustomRecruitJob({ pool, provider: f.provider, secret });
  assert.equal(result.applications, 1);
  assert.equal(await store.hasApplication('101'), true);
  assert.equal((await store.job()).application_cursor, '402');
  assert.deepEqual(await store.retryApplications(), ['400']);
});
test('native full scan resumes its durable cursor after deadline and wraps beyond changed window', async t => {
  const { pool, store } = await database(t); const f = providerFixture('application');
  const cursors = [], visited = [];
  const records = ['501', '502'].map(id => ({ id, properties: { hs_lastmodifieddate: '2020-01-01T00:00:00Z' } }));
  f.provider.listRecruits = async cursor => {
    cursors.push(cursor);
    return { records: records.filter(record => Number(record.id) > Number(cursor)), more: false };
  };
  let clock = 0, expire = true;
  f.provider.nativeTicket = async record => {
    visited.push(record.id);
    if (expire) clock = 7001;
    return '101';
  };
  const first = await runCustomRecruitJob({ pool, provider: f.provider, secret, now: () => clock });
  assert.equal(first.remaining, true);
  assert.deepEqual(visited, ['501']);
  assert.equal((await store.job()).custom_cursor, '501');
  expire = false; clock = 0;
  await runCustomRecruitJob({ pool, provider: f.provider, secret, now: () => clock });
  assert.deepEqual(visited, ['501', '502']);
  assert.equal((await store.job()).custom_cursor, '0');
  await runCustomRecruitJob({ pool, provider: f.provider, secret, now: () => clock });
  assert.deepEqual(cursors, ['0', '501', '0']);
  assert.deepEqual(visited, ['501', '502', '501', '502']);
});
test('locks use explicit transactions and release their client-owned keys on rollback', async t => {
  const { pool, commands } = await database(t);
  const result = await withCustomRecruitLock(pool, 'same', async () => {
    assert.equal((await withCustomRecruitLock(pool, 'same', async () => assert.fail('busy callback ran'))).status, 'busy');
    return 'finished';
  });
  assert.equal(result, 'finished');
  await assert.rejects(withCustomRecruitLock(pool, 'same', async () => { throw Error('work failed'); }), /work failed/);
  assert.equal(await withCustomRecruitLock(pool, 'same', async () => 'reacquired'), 'reacquired');
  for (const id of new Set(commands.map(command => command.id))) {
    const sql = commands.filter(command => command.id === id).map(command => command.sql);
    assert.equal(sql[0], 'BEGIN'); assert.equal(sql.at(-1), 'ROLLBACK');
    assert.ok(sql.some(statement => statement.includes('pg_try_advisory_xact_lock')));
    assert.ok(sql.every(statement => !/pg_try_advisory_lock\(|pg_advisory_unlock\(/.test(statement)));
  }
});
test('repeated recent native changes leave time for full scan cursor and ticket processing', async t => {
  const { pool, store } = await database(t); const f = providerFixture('application');
  const visited = [], cursors = [];
  const older = ['501', '502'].map(id => ({ id, properties: {} }));
  f.provider.changedRecruits = async () => ({ records: ['901', '902', '903'].map(id => ({ id, properties: {} })), more: true });
  f.provider.listRecruits = async cursor => { cursors.push(cursor); return { records: older.filter(row => Number(row.id) > Number(cursor)), more: false }; };
  f.provider.listTickets = async () => ({ records: [{ id: '101' }], more: false });
  let clock = 0;
  f.provider.nativeTicket = async row => { visited.push(row.id); clock += 8001; return '101'; };
  for (let job = 0; job < 2; job++) {
    clock = 0;
    const result = await runCustomRecruitJob({ pool, provider: f.provider, secret, now: () => clock });
    assert.equal(result.processed, 1); assert.equal(result.synced, 1);
    if (job === 0) assert.equal(result.remaining, true);
  }
  assert.deepEqual(visited, ['501', '502']);
  assert.deepEqual(cursors, ['0', '501']);
  assert.equal((await store.job()).custom_cursor, '0');
});
test('note and native request timeouts stay inside phase budgets and leave tickets runnable', async t => {
  const { pool } = await database(t); const f = providerFixture('application');
  let clock = 0, activeEnd = null; const budgets = [];
  f.provider.withBudget = async (end, work) => { budgets.push(end); activeEnd = end; try { return await work(); } finally { activeEnd = null; } };
  f.provider.applicationNotes = async () => { clock = activeEnd; throw Error('phase timeout'); };
  f.provider.changedRecruits = async () => { clock = activeEnd; throw Error('phase timeout'); };
  f.provider.listTickets = async () => ({ records: [{ id: '101' }], more: false });
  const result = await runCustomRecruitJob({ pool, provider: f.provider, secret, now: () => clock });
  assert.deepEqual(budgets, [8000, 15000]);
  assert.equal(result.processed, 1); assert.equal(result.synced, 1);
  assert.equal(result.attention, 2); assert.equal(result.remaining, true);
});
test('a recent-custom search timeout preserves earlier full-scan cursor and pending ticket progress', async t => {
  const { pool, store } = await database(t); const f = providerFixture('application');
  const order = []; let clock = 0, activeEnd;
  f.provider.withBudget = async (end, work) => { activeEnd = end; return work(); };
  f.provider.listRecruits = async cursor => { assert.equal(cursor, '0'); order.push('full-scan'); return { records: [{ id: '501', properties: {} }], more: true }; };
  f.provider.nativeTicket = async record => { assert.equal(record.id, '501'); order.push('native-ticket'); return '101'; };
  f.provider.changedRecruits = async () => { order.push('recent-search'); clock = activeEnd; throw Error('recent search timeout'); };
  const pair = f.provider.pair;
  f.provider.pair = async (...args) => { order.push('ticket-sync'); return pair(...args); };
  const result = await runCustomRecruitJob({ pool, provider: f.provider, secret, now: () => clock });
  assert.deepEqual(order, ['full-scan', 'native-ticket', 'recent-search', 'ticket-sync']);
  assert.equal((await store.job()).custom_cursor, '501');
  assert.equal((await store.get('101')).status, 'synced');
  assert.equal(result.processed, 1); assert.equal(result.synced, 1);
  assert.equal(result.attention, 1); assert.equal(result.remaining, true);
});
