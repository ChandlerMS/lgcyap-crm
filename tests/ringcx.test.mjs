import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAgents, summarizeQueues, createRingCx, ringCxResponse } from '../lib/ringcx.mjs';
const agent = (agentId, agentState, agentGroupId = 2498) => ({ agentId, agentState, agentGroupId, callAni: 'private' });
test('unique target agents only; wrap and other states never count as available', () => {
  assert.deepEqual(summarizeAgents([agent(1,'AVAILABLE'),agent(1,'AVAILABLE'),agent(2,'ON_CALL'),agent(3,'WRAP_UP'),agent(4,'AVAILABLE',2044)]), {loggedIn:3,available:1,onCalls:1,other:1});
  assert.throws(() => summarizeAgents([agent(1,'AVAILABLE'),agent(1,'ON_CALL')]));
  assert.throws(() => summarizeAgents({items:[]}));
  assert.throws(() => summarizeAgents([{}]));
});
test('queue scope is exact and incomplete counters never silently become zero', () => {
  assert.deepEqual(summarizeQueues([{gateId:1,gateGroupId:1973,connected:5,accepted:3},{gateId:2,gateGroupId:1803,connected:50,accepted:30}]), {queues:1,connected:5,accepted:3});
  assert.throws(() => summarizeQueues([]));
  assert.throws(() => summarizeQueues([{gateId:1,gateGroupId:1973,connected:5}]));
});
test('unauthenticated requests never invoke RingCX; private no-store headers', async () => {
  const result = await ringCxResponse({getUser:async()=>null,client:{snapshot:()=>{throw Error('must not call');}}});
  assert.equal(result.status,401); assert.match(result.headers.get('cache-control'),/no-store/);
});
test('token exchange, coalescing and redaction; unverified daily metrics stay null', async () => {
  const calls=[];
  const bodies=[{access_token:'rc-secret'},{accessToken:'cx-secret'},[agent(1,'AVAILABLE')],[{gateId:1,gateGroupId:1973,connected:5,accepted:3}]];
  const client=createRingCx({clientId:'client',clientSecret:'secret',jwt:'jwt',fetch:async(url,init)=>{calls.push({url,init});return Response.json(bodies.shift());}});
  const [first,second]=await Promise.all([client.snapshot(),client.snapshot()]);
  assert.deepEqual(first,second); assert.equal(calls.length,4);
  assert.equal(calls[2].init.headers.Authorization,'Bearer cx-secret');
  assert.equal(first.agents.available,1); assert.equal(first.calls.connected,null); assert.equal(first.calls.answered,null);
  assert.doesNotMatch(JSON.stringify(first),/private|rc-secret|cx-secret|callAni|agentId/);
  await client.snapshot(); assert.equal(calls.length,4);
});
test('upstream failures are sanitized and trigger cooldown', async () => {
  let requests=0;
  const client=createRingCx({clientId:'c',clientSecret:'s',jwt:'j',fetch:async()=>{requests++;return new Response('SECRET',{status:429,headers:{'retry-after':'60'}});}});
  const response=await ringCxResponse({getUser:async()=>({}),client});
  assert.equal(response.status,503); assert.doesNotMatch(await response.text(),/SECRET/);
  await assert.rejects(client.snapshot()); assert.equal(requests,1);
});
