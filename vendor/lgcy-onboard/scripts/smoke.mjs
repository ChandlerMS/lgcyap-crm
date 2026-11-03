// Checks a running LGCY Onboard (local or deployed) from the outside, signed out:
//   npm run smoke                          (the dev server, http://localhost:3000)
//   npm run smoke -- https://<your-project>.vercel.app
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${got})`}`); if (!ok) failed++; };
const get = async (p, init) => { const r = await fetch(base + p, { redirect: 'manual', ...init }); return { r, t: await r.text() }; };
const title = (t) => (t.match(/<title>([^<]*)/) || [])[1];

let x = await get('/');
check('/ signed out is the sign-in page', x.r.status === 200 && title(x.t) === 'LGCY Onboard · Sign in', `${x.r.status} ${title(x.t)}`);
x = await get('/login');
check('/login is the sign-in page', title(x.t) === 'LGCY Onboard · Sign in', title(x.t));
x = await get('/app.html');
check('the CRM page is not served signed out', title(x.t) === 'LGCY Onboard · Sign in', title(x.t));
x = await get('/apply');
check('/apply is the public application', x.r.status === 200 && title(x.t) === 'Legacy Agent Application' && x.t.includes('const TOKEN = "";'), `${x.r.status} ${title(x.t)}`);
x = await get('/brand/favicon-32.png');
check('brand images are public', x.r.status === 200 && /image\/png/.test(x.r.headers.get('content-type') || ''), `${x.r.status} ${x.r.headers.get('content-type')}`);
x = await get('/api/me');
check('/api/me needs sign-in', x.r.status === 401 && x.t === '{"error":"sign_in"}', `${x.r.status} ${x.t}`);
x = await get('/api/login/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"not-an-email"}' });
check('sign-in rejects a bad email', x.t === '{"ok":false,"why":"email"}', x.t);
x = await get('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://elsewhere.example' }, body: '{}' });
check('writes from other sites are refused', x.r.status === 403, x.r.status);
x = await get('/api/cron');
check('the cron job needs its secret', x.r.status === 401, x.r.status);

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
