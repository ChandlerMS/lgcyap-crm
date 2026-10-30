import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

// Exercise the actual production build without real credentials or test-login
// shortcuts. This also ensures old Sites identity headers cannot grant access.
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', BETTER_AUTH_URL: base, RECRUITING_WRITES_ENABLED: 'false', RECRUITING_CONTACT_CREATION_ENABLED: 'false', RECRUITING_INTAKE_ENABLED: 'false' };
// Empty values also prevent Next's dotenv loader from loading real values from
// a developer's .env.local after this child process starts.
for (const key of ['HUBSPOT_ACCESS_TOKEN', 'DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BETTER_AUTH_SECRET', 'RECRUITING_EDITOR_EMAILS', 'GOOGLE_PERSONAL_EMAILS', 'GOOGLE_EXTERNAL_EMAILS']) env[key] = '';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverOutput = (serverOutput + chunk.toString()).slice(-10000); });
try {
  let started = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Production server exited before startup.');
    try { await fetch(base + '/sign-in'); started = true; break; } catch { await delay(200); }
  }
  assert.equal(started, true, 'production server starts');
  const home = await fetch(base, { redirect: 'manual' });
  assert.equal(home.status, 307);
  assert.match(home.headers.get('location') ?? '', /^\/sign-in(?:\?|$)/);
  const signIn = await fetch(base + '/sign-in');
  assert.equal(signIn.status, 200);
  assert.match(await signIn.text(), /Welcome to Legacy/);
  assert.match(signIn.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(signIn.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(signIn.headers.get('x-frame-options'), 'DENY');
  for (const path of ['/api/recruits', '/api/recruits/101', '/api/contacts', '/api/recruit-intake', '/api/leaderboard', ...['customer-success', 'inbox', 'tickets', 'calls', 'contacts', 'tasks', 'calendar', 'meetings'].flatMap(tool => [`/api/hubspot-tools/${tool}`, `/api/hubspot-tools/${tool}/101`])]) {
    for (const forged of [false, true]) {
      const headers = { Origin: base, 'Content-Type': 'application/json' };
      if (forged) Object.assign(headers, {
        'oai-authenticated-user-id': 'forged-user',
        'oai-authenticated-user-email': 'forged@example.invalid',
        Cookie: 'better-auth.session_token=forged.invalid',
      });
      const response = await fetch(base + path, { method: 'POST', headers, body: '{}' });
      assert.equal(response.status, 401, `${path} rejects ${forged ? 'forged' : 'anonymous'} identity`);
      const result = await response.json();
      assert.equal(result.error.code, 'SIGN_IN_REQUIRED');
      assert.equal(result.signInPath, '/sign-in');
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    }
    const get = await fetch(base + path);
    assert.equal(get.status, 405, `${path} GET cannot read or write CRM`);
  }
  const auth = await fetch(base + '/api/auth/get-session');
  assert.equal(auth.status, 503, 'unconfigured auth fails closed');
  console.log('Production HTTP smoke passed: redirect, branded sign-in, private headers, anonymous/forged identity rejection, method restrictions, and unconfigured auth. No CRM calls or record changes.');
} catch (error) {
  console.error(error.message);
  // Output is a credential-free child process; do not echo HTML or environment.
  if (serverOutput.includes('Error:')) console.error(serverOutput.split('\n').filter(line => line.includes('Error:')).slice(0, 3).join('\n'));
  process.exitCode = 1;
} finally {
  if (server.exitCode === null) {
    server.kill();
    await once(server, 'exit').catch(() => {});
  }
}
