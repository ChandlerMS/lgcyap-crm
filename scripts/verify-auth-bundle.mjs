import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
// Build verification: source tests do not exercise Turbopack's differing SSR/API asset handling.
const traceFile = resolve('.next/server/app/page.js.nft.json');
const trace = JSON.parse(await readFile(traceFile, 'utf8'));
const chunks = await Promise.all(trace.files.filter(file => file.endsWith('.js') && file.includes('/chunks/')).map(file => readFile(resolve(dirname(traceFile), file), 'utf8')));
const bundle = chunks.join('\n');
assert.ok(bundle.includes('CREATE TABLE IF NOT EXISTS crm_access_overrides'), 'CRM access schema must be bundled into the server-rendered auth path');
assert.ok(!bundle.includes('/_next/static/media/0013_admin_access'), 'CRM authentication must not read a public SQL asset URL');
console.log('Production auth bundle contains executable schema SQL with no public-asset filesystem lookup.');
