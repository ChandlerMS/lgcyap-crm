import test from 'node:test';
import assert from 'node:assert/strict';
import { communicationCommand, communicationPhone, RINGCENTRAL_ORIGIN, ringCentralStatus, ringCentralUrl } from '../app/ringcentral-bridge.mjs';

test('provider URL is pinned to the official PKCE iframe with no secret', () => {
  const url = new URL(ringCentralUrl('publicClient123'));
  assert.equal(url.origin, RINGCENTRAL_ORIGIN);
  assert.equal(url.pathname, '/integration/ringcentral-embeddable/3.0.0/app.html');
  assert.equal(url.searchParams.get('redirectUri'), `${RINGCENTRAL_ORIGIN}/integration/ringcentral-embeddable/3.0.0/redirect.html`);
  for (const key of ['clientSecret','jwt','authorizationCode']) assert.equal(url.searchParams.has(key), false);
  assert.equal(ringCentralUrl('https://foreign.invalid'), null);
  assert.equal(ringCentralUrl(''), null);
});

test('numbers normalize and reject commands, extensions, invalid lengths, and URLs', () => {
  assert.equal(communicationPhone('(202) 555-0123'), '+12025550123');
  assert.equal(communicationPhone('+44 20 7946 0123'), '+442079460123');
  for (const input of ['tel:+12025550123','911','2025550123;911','2025550123 ext 12','+0000000000','2025550123\n911','12345678901234567890',null]) assert.equal(communicationPhone(input), null);
});

test('communication actions only prefill; demo records and unsupported actions never generate commands', () => {
  assert.deepEqual(communicationCommand('call','2025550123'), { type:'rc-adapter-new-call',phoneNumber:'+12025550123',toCall:false });
  assert.deepEqual(communicationCommand('text','2025550123'), { type:'rc-adapter-new-sms',phoneNumber:'+12025550123',conversation:true });
  for (const action of ['call','text','send','ringcx']) assert.equal(communicationCommand(action,'2025550123',true),null);
  assert.equal(communicationCommand('ringcx','2025550123'),null);
  assert.equal(communicationCommand('call','911'),null);
});

test('status messages require both exact origin and the specific iframe window', () => {
  const source = {};
  const message = {origin:RINGCENTRAL_ORIGIN,source,data:{type:'rc-login-status-notify',loggedIn:true}};
  assert.deepEqual(ringCentralStatus(message,source),{loggedIn:true});
  assert.equal(ringCentralStatus({...message,origin:'https://apps.ringcentral.com.evil.invalid'},source),null);
  assert.equal(ringCentralStatus(message,{}),null);
  assert.equal(ringCentralStatus({...message,source:null},null),null);
  assert.equal(ringCentralStatus({...message,data:{type:'rc-login-status-notify',loggedIn:'true'}},source),null);
  assert.equal(ringCentralStatus({...message,data:{type:'rc-message-updated-notify',message:'private'}},source),null);
});
