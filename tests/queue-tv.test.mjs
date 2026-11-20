import test from 'node:test';
import assert from 'node:assert/strict';
import { queueTvPage } from '../app/queue/tv-model.mjs';
import { queueReturnPath, queueAccessResponse } from '../lib/queue-host.mjs';
import config from '../next.config.ts';

test('TV roster paging cycles every record and adapts to a shrinking live roster', () => {
  const rows = Array.from({length: 14}, (_, index) => index);
  assert.deepEqual(queueTvPage(rows, 0).rows, [0,1,2,3,4,5]);
  assert.deepEqual(queueTvPage(rows, 1).rows, [6,7,8,9,10,11]);
  assert.deepEqual(queueTvPage(rows, 2).rows, [12,13]);
  assert.deepEqual(queueTvPage(rows, 3).rows, [0,1,2,3,4,5]);
  assert.deepEqual(queueTvPage([4], 7).rows, [4]);
  assert.deepEqual(queueTvPage([], 10).rows, []);
});

test('Queue TV sign-in destinations are restricted to the two fixed source pages', async () => {
  for (const [value,want] of [['/shopper','/shopper'], ['/standard','/standard'], ['/queue-tv/shopper','/shopper'], ['/queue-tv/standard','/standard'], ['https://evil.invalid/standard','/'], ['//evil.invalid/shopper','/'], ['/unknown','/']]) {
    const url = `https://crm.lgcyap.com/queue-access?return_to=${encodeURIComponent(value)}`;
    assert.equal(queueReturnPath(url),want);
    const req = new Request(url,{headers:{Cookie:'__Secure-better-auth.session_token=token.signed'}});
    const options = {baseURL:'https://crm.lgcyap.com',authorize:()=>true,getSession:async()=>({session:{token:'token',expiresAt:new Date(Date.now()+60000)}})};
    const response = await queueAccessResponse(req,options);
    assert.equal(response.headers.get('location'),`https://queue.lgcyap.com${want}`);
    const missing = await queueAccessResponse(req,{...options,getSession:async()=>null});
    const login = new URL(missing.headers.get('location'));
    const callback = new URL(login.searchParams.get('return_to'),'https://crm.lgcyap.com');
    assert.equal(queueReturnPath(callback.href),want);
  }
});

test('Queue TV URL rewrites are host-specific and leave Leaderboard TV URLs intact', async () => {
  const rules = (await config.rewrites()).beforeFiles;
  for (const source of ['shopper','standard']) {
    const queue = rules.find(rule=>rule.source===`/${source}` && rule.destination===`/queue-tv/${source}`);
    assert.deepEqual(queue.has,[{type:'host',value:'queue.lgcyap.com'}]);
    assert.ok(rules.some(rule=>rule.source===`/${source}` && rule.destination===`/leaderboard-tv/${source}`));
  }
});
