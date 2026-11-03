import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAgents, summarizeQueues, onCallAgents, availableAgents, busyAgents, averageWaitSeconds, createRingCx, ringCxResponse } from '../lib/ringcx.mjs';
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
test('live ENGAGED includes held calls but WORKING and disposition do not', () => {
  assert.deepEqual(summarizeAgents([agent(1,'ENGAGED'),agent(2,'ENGAGED'),agent(3,'WORKING'),agent(4,'PENDING-DISP'),agent(5,'AVAILABLE')]), {loggedIn:5,available:1,onCalls:2,other:2});
});
test('on-call roster shares count scope, deduplicates and only exposes allowed fields', () => {
  const held = {...agent(1,'ENGAGED'),firstName:' Alex ',lastName:'Example',onHoldDts:'2026-11-03T15:00:00Z',email:'private@example.com',callUii:'private-call'};
  const rows=[held,held,agent(2,'ON_CALL'),agent(3,'AVAILABLE'),agent(4,'PENDING-DISP'),agent(5,'ENGAGED',2044)];
  const roster=onCallAgents(rows);
  assert.deepEqual(roster,[{id:'2',name:'Agent 2',status:'On call',todayCalls:null,todaySales:null,sessionCalls:null,stateSeconds:null},{id:'1',name:'Alex Example',status:'On hold',todayCalls:null,todaySales:null,sessionCalls:null,stateSeconds:null}]);
  assert.equal(roster.length,summarizeAgents(rows).onCalls);
  assert.doesNotMatch(JSON.stringify(roster),/private|email|callUii|callAni/);
  assert.deepEqual(onCallAgents([]),[]);
  assert.throws(()=>onCallAgents([held,agent(1,'AVAILABLE')]));
});
test('available roster excludes busy, wrap, working and other groups', () => {
  const rows=[agent(1,'AVAILABLE'),agent(1,'AVAILABLE'),agent(2,'ENGAGED'),agent(3,'WORKING'),agent(4,'PENDING-DISP'),agent(5,'AVAILABLE',2044)];
  assert.deepEqual(availableAgents(rows),[{id:'1',name:'Agent 1',status:'Available',todayCalls:null,todaySales:null,sessionCalls:null,stateSeconds:null}]);
  assert.equal(availableAgents(rows).length,summarizeAgents(rows).available);
});
test('unauthenticated requests never invoke RingCX; private no-store headers', async () => {
  const result = await ringCxResponse({getUser:async()=>null,client:{snapshot:()=>{throw Error('must not call');}}});
  assert.equal(result.status,401); assert.match(result.headers.get('cache-control'),/no-store/);
});
test('daily answered and concurrent connected remain separate; credentials stay private', async () => {
  const calls=[];
  const bodies=[{access_token:'rc-secret'},{accessToken:'cx-secret'},[agent(1,'AVAILABLE')],[{gateId:1,gateGroupId:1973,connected:5,accepted:3}]];
  const client=createRingCx({clientId:'client',clientSecret:'secret',jwt:'jwt',fetch:async(url,init)=>{calls.push({url,init});return Response.json(bodies.shift());}});
  const [first,second]=await Promise.all([client.snapshot(),client.snapshot()]);
  assert.deepEqual(first,second); assert.equal(calls.length,4);
  assert.equal(calls[2].init.headers.Authorization,'Bearer cx-secret');
  assert.equal(first.agents.available,1); assert.equal(first.calls.connected,null); assert.equal(first.calls.answered,3); assert.equal(first.calls.activeConnected,5);
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

 test('weighted answered wait and nullable agent counters', () => {
 const q=(gateId,accepted,totalAnswerTime,gateGroupId=1973)=>({gateId,accepted,totalAnswerTime,gateGroupId,connected:0});
 assert.equal(averageWaitSeconds([q(1,1,100),q(2,9,90),q(3,1,9000,1803)]),19);
 assert.equal(averageWaitSeconds([q(1,0,0)]),null);
 assert.equal(averageWaitSeconds([q(1,1,undefined)]),null);
 const row=availableAgents([{...agent(1,'AVAILABLE'),callsHandled:12,stateTime:3661}])[0];
 assert.equal(row.sessionCalls,12); assert.equal(row.stateSeconds,3661);
 const invalid=availableAgents([{...agent(1,'AVAILABLE'),callsHandled:-1,stateTime:'30'}])[0];
 assert.equal(invalid.sessionCalls,null); assert.equal(invalid.stateSeconds,null);
 });

test('agent queue report uses the RingCentral account id and stays within the group queues; failures explain themselves', async () => {
  const calls=[];
  const bodies=[{access_token:'rc-secret'},{accessToken:'cx-secret'},[{gateId:7,gateGroupId:1973,connected:0,accepted:0},{gateId:8,gateGroupId:1803,connected:0,accepted:0}],{id:980634004,name:'private'},[{agentName:'Agent One',queue:7,answIxnCnt:1}],[]];
  const client=createRingCx({clientId:'c',clientSecret:'s',jwt:'j',fetch:async(url,init)=>{calls.push({url,init});return Response.json(bodies.shift());}});
  const queues=await client.svpQueues();
  assert.deepEqual([[...queues.ids],queues.answeredToday],[['7'],0]);
  assert.deepEqual(await client.agentQueueReport({startDate:'2026-11-03 10:00:00',endDate:'2026-11-03 12:00:00'}),[{agentName:'Agent One',queue:7,answIxnCnt:1}]);
  assert.equal(calls[3].url,'https://platform.ringcentral.com/restapi/v1.0/account/~'); assert.equal(calls[3].init.headers.Authorization,'Bearer rc-secret');
  assert.equal(calls[4].url,'https://ringcx.ringcentral.com/voice/api/cx/integration/v1/accounts/980634004/sub-accounts/50560001/agg-agent-extended-stats');
  assert.equal(calls[4].init.method,'POST'); assert.equal(calls[4].init.headers.Authorization,'Bearer cx-secret');
  assert.deepEqual(JSON.parse(calls[4].init.body),{startDate:'2026-11-03 10:00:00',endDate:'2026-11-03 12:00:00',timeInterval:15,timeZone:'US/Eastern'});
  await client.agentQueueReport({startDate:'a',endDate:'b'}); assert.equal(calls.length,6,'the account id is looked up once');
  const reject=status=>createRingCx({clientId:'c',clientSecret:'s',jwt:'j',fetch:async url=>/oauth\/token/.test(url)?Response.json({access_token:'rc'}):/accesstoken/.test(url)?Response.json({accessToken:'cx'}):/account\/~/.test(url)?Response.json({id:1}):new Response('WEM Access required',{status})});
  await assert.rejects(reject(403).agentQueueReport({startDate:'a',endDate:'b'}),error=>error.code==='RINGCX_ACCESS_DENIED'&&error.detail==='HTTP 403 WEM Access required');
  const limited=reject(429);
  await assert.rejects(limited.agentQueueReport({startDate:'a',endDate:'b'}),error=>error.code==='RINGCX_RATE_LIMITED');
  await assert.rejects(limited.agentQueueReport({startDate:'a',endDate:'b'}),error=>error.code==='RINGCX_RATE_LIMITED'&&error.detail==='','a cooldown makes no further request');
  await assert.rejects(createRingCx().agentQueueReport({startDate:'a',endDate:'b'}),error=>error.code==='RINGCX_NOT_CONFIGURED');
});

test('busy includes all non-available logged-in states without changing active call count', () => {
 const rows=[agent(1,'AVAILABLE'),agent(2,'ENGAGED'),agent(3,'WORKING'),agent(4,'PENDING-DISP'),agent(5,'BREAK'),agent(6,'LUNCH',2044)];
 assert.equal(busyAgents(rows).length,4); assert.equal(summarizeAgents(rows).onCalls,1);
 assert.deepEqual(busyAgents(rows).map(row=>row.status),['On call','Working','Pending disp','Break']);
 assert.equal(busyAgents(rows)[0].todayCalls,null);
});
