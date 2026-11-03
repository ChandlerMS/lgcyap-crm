// One-time Google approval for LGCY Onboard, run on your own computer. Opens Google's permission page, catches
// the answer on http://localhost:53682, and stores the resulting refresh token:
//   default    -> written into .env.local (local development)
//   --put      -> sent straight to the Vercel project's Production environment variables (`vercel env add`),
//                 never printed. Needs the folder linked to the project first: `npx vercel link`.
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local, and http://localhost:53682/oauth2callback listed
// as an authorized redirect URI on that OAuth client.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const root = new URL('..', import.meta.url);
const varsFile = new URL('.env.local', root);

function readVars() {
  const out = {};
  if (fs.existsSync(varsFile)) for (const line of fs.readFileSync(varsFile, 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) out[m[1]] = m[2]; }
  return { ...out, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('GOOGLE_'))) };
}

function writeVar(name, value) {
  let text = fs.existsSync(varsFile) ? fs.readFileSync(varsFile, 'utf8') : '';
  text = new RegExp(`^${name}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=${value}`) : text + (text.endsWith('\n') || !text ? '' : '\n') + `${name}=${value}\n`;
  fs.writeFileSync(varsFile, text);
}

export async function approve({ secret, scopes, account, what }) {
  const vars = readVars();
  if (!vars.GOOGLE_CLIENT_ID || !vars.GOOGLE_CLIENT_SECRET) { console.error('Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first (see README).'); process.exit(1); }
  const put = process.argv.includes('--put');
  const state = crypto.randomBytes(16).toString('hex');
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: vars.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', access_type: 'offline', prompt: 'consent',
    scope: ['openid', 'email', ...scopes].join(' '), state, ...(account ? { login_hint: account } : {}),
  });
  console.log(`\nApproval for ${what}.\nSign in as ${account || 'the right Google account'} and allow access:\n\n  ${url}\n`);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const q = new URL(req.url, REDIRECT).searchParams;
      if (!req.url.startsWith('/oauth2callback')) { res.writeHead(404).end(); return; }
      const ok = q.get('state') === state && q.get('code');
      res.writeHead(200, { 'content-type': 'text/html' }).end(ok ? '<p style="font:16px sans-serif">Done. You can close this tab.</p>' : '<p>That did not work; see the terminal.</p>');
      server.close();
      ok ? resolve(q.get('code')) : reject(new Error(q.get('error') || 'state mismatch'));
    }).listen(PORT, 'localhost');
  });

  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: vars.GOOGLE_CLIENT_ID, client_secret: vars.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
  const d = await r.json();
  if (!d.refresh_token) { console.error('Google did not return a refresh token:', d.error || r.status); process.exit(1); }
  const email = d.id_token ? JSON.parse(Buffer.from(d.id_token.split('.')[1], 'base64url').toString()).email : '?';
  const missing = scopes.filter((s) => !(d.scope || '').includes(s));
  if (missing.length) console.warn('Warning: these permissions were not granted:', missing.join(', '));
  if (account && email.toLowerCase() !== account.toLowerCase()) console.warn(`Warning: approved as ${email}, expected ${account}.`);

  if (put) {
    const p = spawn('npx', ['vercel', 'env', 'add', secret, '--environment', 'production', '--sensitive', '--force'], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' });
    p.stdin.end(d.refresh_token);
    const code = await new Promise((res) => p.on('close', res));
    if (code) { console.error(`Saving ${secret} to Vercel failed; see the message above (is the folder linked? npx vercel link).`); process.exit(1); }
    console.log(`${secret} saved to Vercel's Production environment variables (approved as ${email}). Redeploy for it to take effect.`);
  } else {
    writeVar(secret, d.refresh_token);
    console.log(`${secret} written to .env.local (approved as ${email}). Run again with --put to save it to Vercel.`);
  }
}
