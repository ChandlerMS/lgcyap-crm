import test from 'node:test';
import assert from 'node:assert/strict';
import { saveRecruitStageWithRefresh } from '../app/recruit-stage-save.mjs';
import { readRecruitStageSnapshot, saveRecruit, validateWriteInput } from '../lib/hubspot-write.mjs';
import { normalizeRecruit, handleRecruitRequest, RecruitingError } from '../lib/hubspot.mjs';
import { stageIdForKey, PIPELINE_ID } from '../lib/recruiting-config.mjs';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const oldTime = '2026-11-03T12:00:00.000Z', freshTime = '2026-11-03T12:01:00.000Z';
const raw = (props = {}) => ({ id: '123', archived: false, properties: {
  hs_pipeline: PIPELINE_ID, hs_pipeline_stage: stageIdForKey('training'), recruiting_path: 'genpop', licensing_branch: '',
  hs_lastmodifieddate: oldTime, recruit_name: 'Synthetic Recruit', orientation_office: 'orlando', ...props,
} });
const before = () => normalizeRecruit(raw());
const fresh = () => normalizeRecruit(raw({ hs_lastmodifieddate: freshTime, orientation_office: 'miami' }));
const target = stageIdForKey('completed');
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const saved = recruit => ({ status: 'saved', requestId, recruit: { ...recruit, stageId: target, stageKey: 'completed', editValues: { ...recruit.editValues, hs_pipeline_stage: target } } });

test('a drop refreshes just its recruit and saves once with the fresh version, retaining unrelated edits', async () => {
  const calls = [], latest = fresh(), shown = [];
  const result = await saveRecruitStageWithRefresh(before(), target, { requestId, onRefreshed: row => shown.push(row), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json(url.endsWith('/snapshot') ? { recruit: latest } : saved(latest));
  } });
  assert.deepEqual(calls.map(call => call.url), ['/api/recruits/123/snapshot', '/api/recruits/123']);
  assert.equal(calls[0].options.body, '{}');
  for (const { options } of calls) {
    assert.equal(options.method, 'POST'); assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    requestId, expectedUpdatedAt: freshTime, expectedValues: { hs_pipeline_stage: before().stageId }, changes: { hs_pipeline_stage: target },
  });
  assert.equal(result.recruit.office, 'Miami');
  assert.deepEqual(shown, [latest]);
});

test('a newer stage or routing is displayed and stops the original drag without a save', async () => {
  for (const props of [
    { hs_pipeline_stage: stageIdForKey('offer') }, { hs_pipeline_stage: target },
    { recruiting_path: 'mass_recruiting' }, { licensing_branch: 'licensed' },
  ]) {
    const latest = normalizeRecruit(raw({ hs_lastmodifieddate: freshTime, ...props })); let calls = 0, shown;
    await assert.rejects(saveRecruitStageWithRefresh(before(), target, { requestId, onRefreshed: value => { shown = value; }, fetchImpl: async url => {
      calls++; assert.match(url, /\/snapshot$/); return json({ recruit: latest });
    } }), { code: 'STAGE_CHANGED_BEFORE_SAVE', uncertain: false });
    assert.equal(calls, 1); assert.deepEqual(shown, latest);
  }
});

test('invalid, missing, wrong-record and failed refreshes never reach the write endpoint', async () => {
  for (const respond of [
    () => { throw new Error('Network unavailable'); }, () => new Response('not JSON'), () => json({}, 502),
    () => json({}), () => json({ recruit: { ...fresh(), id: '456' } }),
    () => json({ recruit: { ...fresh(), updatedAt: null } }),
  ]) {
    let calls = 0;
    await assert.rejects(saveRecruitStageWithRefresh(before(), target, { requestId, fetchImpl: async url => {
      calls++; assert.match(url, /\/snapshot$/); return respond();
    } }), { code: 'STAGE_REFRESH_FAILED', uncertain: false });
    assert.equal(calls, 1);
  }
});

test('refresh authorization and rate limits remain distinct and never trigger a write', async () => {
  for (const [status, code] of [[401, 'UNAUTHORIZED'], [403, 'SAVE_UNAVAILABLE'], [429, 'RATE_LIMITED']]) {
    let calls = 0;
    await assert.rejects(saveRecruitStageWithRefresh(before(), target, { requestId, fetchImpl: async () => {
      calls++; return json({ retryAfterSeconds: 30 }, status);
    } }), error => error.code === code && error.status === status && !error.uncertain);
    assert.equal(calls, 1);
  }
});

test('a server-side race after refresh still stops the save and never retries it', async () => {
  const calls = [];
  await assert.rejects(saveRecruitStageWithRefresh(before(), target, { requestId, fetchImpl: async (url, options) => {
    calls.push(url);
    if (url.endsWith('/snapshot')) return json({ recruit: fresh() });
    assert.equal(JSON.parse(options.body).expectedUpdatedAt, freshTime);
    return json({ error: { code: 'RECORD_CHANGED' } }, 409);
  } }), error => error.code === 'RECORD_CHANGED' && !error.uncertain && /Nothing was overwritten/.test(error.message));
  assert.equal(calls.length, 2);
});

test('an uncertain write stays uncertain and is never refreshed or sent again automatically', async () => {
  const calls = [];
  await assert.rejects(saveRecruitStageWithRefresh(before(), target, { requestId, fetchImpl: async url => {
    calls.push(url);
    if (url.endsWith('/snapshot')) return json({ recruit: fresh() });
    throw new Error('Lost write response');
  } }), { code: 'SAVE_UNCERTAIN', uncertain: true });
  assert.equal(calls.length, 2);
});

test('cancellation after the fresh read prevents the subsequent save', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(saveRecruitStageWithRefresh(before(), target, { requestId, signal: controller.signal, fetchImpl: async (_url, options) => {
    calls++; assert.equal(options.signal, controller.signal); controller.abort(); return json({ recruit: fresh() });
  } }), { code: 'SAVE_CANCELLED' });
  assert.equal(calls, 1);
});

test('snapshot provider reads exactly one pipeline-scoped ticket and performs no mutation', async () => {
  const calls = [];
  const recruit = await readRecruitStageSnapshot('123', { accessToken: 'synthetic-credential', fetchImpl: async (url, options) => {
    calls.push({ url, options }); return json(raw({ hs_lastmodifieddate: freshTime }));
  } });
  assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(new URL(calls[0].url).pathname, '/crm/v3/objects/tickets/123');
  assert.equal(recruit.updatedAt, freshTime);
  for (const response of [raw({ hs_pipeline: 'foreign' }), { ...raw(), id: '456' }, { ...raw(), archived: true }]) {
    await assert.rejects(readRecruitStageSnapshot('123', { accessToken: 'synthetic', fetchImpl: async () => json(response) }), { code: 'RECORD_NOT_FOUND' });
  }
  let requests = 0;
  for (const id of ['../123', '0', 'not-an-id']) await assert.rejects(readRecruitStageSnapshot(id, { accessToken: 'synthetic', fetchImpl: async () => { requests++; } }));
  assert.equal(requests, 0);
});

test('client refresh composes with real server version checks: unrelated earlier edits pass, later edits block PATCH', async () => {
  for (const race of [false, true]) {
    let reads = 0, patches = 0, ledgerStatus;
    let current = raw({ hs_lastmodifieddate: freshTime, orientation_office: 'miami' });
    const provider = async (_url, options) => {
      if (options.method === 'PATCH') {
        patches++;
        current = raw({ ...current.properties, ...JSON.parse(options.body).properties, hs_lastmodifieddate: '2026-11-03T12:02:00.000Z' });
        return json({ id: '123' });
      }
      reads++;
      if (race && reads === 2) current = raw({ ...current.properties, hs_lastmodifieddate: '2026-11-03T12:02:00.000Z', orientation_office: 'tampa' });
      return json(current);
    };
    const appFetch = async (url, options) => {
      if (url.endsWith('/snapshot')) return json({ recruit: await readRecruitStageSnapshot('123', { accessToken: 'synthetic', fetchImpl: provider }) });
      try {
        return json(await saveRecruit(validateWriteInput('123', JSON.parse(options.body)), {
          userId: 'test', accessToken: 'synthetic', fetchImpl: provider,
          ledger: { claim: async () => ({ acquired: true }), finish: async value => { ledgerStatus = value.status; return true; } },
        }));
      } catch (error) { return json({ error: { code: error.code } }, error.status); }
    };
    const result = saveRecruitStageWithRefresh(before(), target, { requestId, fetchImpl: appFetch });
    if (race) {
      await assert.rejects(result, { code: 'RECORD_CHANGED', uncertain: false });
      assert.equal(patches, 0); assert.equal(reads, 2); assert.equal(ledgerStatus, 'failed');
    } else {
      assert.equal((await result).recruit.office, 'Miami'); assert.equal(patches, 1); assert.equal(ledgerStatus, 'saved');
    }
  }
});

test('snapshot uses the existing private, authenticated, same-origin empty-JSON read contract', async () => {
  let reads = 0;
  const request = (origin = 'https://crm.example') => new Request('https://crm.example/api/recruits/123/snapshot', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
  });
  const deps = { getUser: async () => ({ userId: 'test' }), authorizeUser: () => true, allowedOrigin: 'https://crm.example', readData: async () => { reads++; return { recruit: fresh() }; } };
  assert.equal((await handleRecruitRequest(request(), { ...deps, getUser: async () => null })).status, 401);
  assert.equal((await handleRecruitRequest(request(), { ...deps, authorizeUser: () => false })).status, 403);
  assert.equal((await handleRecruitRequest(request('https://other.example'), deps)).status, 403);
  assert.equal(reads, 0);
  const response = await handleRecruitRequest(request(), deps);
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  assert.equal((await response.json()).recruit.id, '123');
  const limited = await handleRecruitRequest(request(), { ...deps, readData: async () => { throw new RecruitingError('LIMITED', 'Wait', 429, 15); } });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '15');
});
