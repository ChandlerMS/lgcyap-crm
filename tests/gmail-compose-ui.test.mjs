import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, act } from 'react';

async function composer(run, respond = () => null) {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/gmail-compose-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.example.test' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  window.HTMLInputElement.prototype.attachEvent = function () {};
  window.HTMLInputElement.prototype.detachEvent = function () {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  let popupCalls = 0;
  window.open = () => { popupCalls++; return null; };
  const requests = [];
  const templates = [{ id: 'licensed', name: 'Licensed offer', route: 'licensed', subject: 'Your offer', fields: ['acceptBy', 'contractingDate', 'contractingTime'] }];
  const recipient = { name: 'Alex Recruit', email: 'alex@example.test', firstName: 'Alex', route: 'licensed' };
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, body });
    const custom = await respond({ url, body, recipient, templates });
    if (custom) return custom;
    if (url === '/api/gmail') return Response.json({ connected: true, available: true, email: 'staff@example.test', inboxUrl: 'https://mail.google.com/mail/u/staff@example.test/#inbox', draftsUrl: 'https://mail.google.com/mail/u/staff@example.test/#drafts' });
    if (body.action === 'status') return Response.json({ sender: 'staff@example.test', available: true, templates });
    if (body.action === 'prepare') return Response.json({ recipient, templates });
    if (body.action === 'preview') return Response.json({ recipient, subject: body.subject, html: '<html><body><h1>Complete branded offer</h1><p>All terms and dates</p></body></html>', previewToken: 'signed-preview' });
    if (body.action === 'draft') return Response.json({ created: true, draftId: 'draft-1', gmailUrl: 'https://mail.google.com/mail/u/staff@example.test/#all/thread1', draftsUrl: 'https://mail.google.com/mail/u/staff@example.test/#drafts', notice: 'Draft created. Review and send in Gmail.' });
    throw Error('Unexpected API request');
  };
  let root;
  const { createRoot } = await import('react-dom/client');
  try {
    await writeFile(`${dir}/entry.tsx`, `import React from 'react'; import {RecruitEmailProvider,useRecruitEmail} from '../../app/recruit-email'; function Open(){const {open}=useRecruitEmail(); return <button onClick={()=>open('123','Alex Recruit')}>Compose for Alex</button>}; export default function App({disabled=false}){return <RecruitEmailProvider recruits={[{id:'123',name:'Alex Recruit',email:'alex@example.test'}]} disabled={disabled}><Open/></RecruitEmailProvider>}`);
    await build({ entryPoints: [`${dir}/entry.tsx`], outfile: `${dir}/component.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], logLevel: 'silent' });
    const App = createRequire(import.meta.url)(`${process.cwd()}/${dir}/component.cjs`).default;
    root = createRoot(document.getElementById('app'));
    await act(async () => root.render(h(App)));
    const button = label => [...document.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label);
    const click = async label => { const item = button(label); assert.ok(item, `button ${label} exists`); await act(async () => item.click()); };
    const fill = async (label, value) => {
      const field = [...document.querySelectorAll('label')].find(item => item.textContent.startsWith(label));
      const input = field?.querySelector('input,select,textarea'); assert.ok(input, `field ${label} exists`);
      await act(async () => {
        const prototype = input.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
        input.dispatchEvent(new window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      });
    };
    await run({ requests, click, fill, button, popupCalls: () => popupCalls, render: async disabled => act(async () => root.render(h(App, { disabled }))) });
  } finally {
    if (root) await act(async () => root.unmount());
    dom.window.close(); Object.assign(globalThis, { window: previous.window, document: previous.document, fetch: previous.fetch });
    if (previous.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    await rm(dir, { recursive: true, force: true });
  }
}

const fillOffer = async ({ fill }) => { await fill('Template', 'licensed'); await fill('Accept by', '2026-12-01'); await fill('Contracting date', '2026-12-02'); await fill('Contracting time', '10:30'); };

test('Gmail composer requires a complete preview before one draft and retains explicit links when popups are blocked', async () => {
  await composer(async ui => {
    assert.equal(ui.requests.length, 0, 'hidden composer does not refresh Google credentials');
    await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /staff@example.test/);
    assert.match(document.body.textContent, /includes sending/i);
    assert.equal(ui.button('Create draft and open Gmail'), undefined);
    await fillOffer(ui);
    await ui.click('Preview email');
    const frame = document.querySelector('iframe[title="Complete email preview"]');
    assert.equal(frame.getAttribute('sandbox'), '');
    assert.match(frame.getAttribute('srcdoc'), /Complete branded offer.*All terms and dates/);
    await ui.click('Create draft and open Gmail');
    const draft = ui.requests.filter(request => request.body?.action === 'draft');
    assert.equal(draft.length, 1);
    assert.equal(draft[0].body.previewToken, 'signed-preview');
    assert.match(draft[0].body.requestId, /^[\w-]{16,}$/);
    assert.equal(draft[0].body.fields.contractingTime, '10:30');
    assert.equal(ui.popupCalls(), 1);
    assert.ok(document.querySelector('a[href$="#all/thread1"]'));
    assert.ok(document.querySelector('a[href$="#drafts"]'));
    assert.match(document.body.textContent, /Draft created/);
    assert.doesNotMatch(document.body.textContent, /Email sent|Message sent/);
    await ui.click('Close email'); await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /Draft created/);
    assert.equal(ui.requests.filter(request => request.body?.action === 'draft').length, 1);
  });
});

test('editing a preview requires another review and custom messages use the same draft flow', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex');
    await ui.fill('Subject', 'Hello Alex'); await ui.fill('Message', 'A custom message');
    await ui.click('Preview email');
    assert.ok(ui.button('Create draft and open Gmail'));
    await ui.fill('Subject', 'Revised subject');
    assert.equal(ui.button('Create draft and open Gmail'), undefined);
    await ui.click('Preview email'); await ui.click('Create draft and open Gmail');
    const draft = ui.requests.find(request => request.body?.action === 'draft').body;
    assert.equal(draft.templateId, ''); assert.equal(draft.body, 'A custom message'); assert.equal(draft.subject, 'Revised subject');
  });
});

test('uncertain draft result blocks retries across close and reopen until the user checks Drafts', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex'); await fillOffer(ui); await ui.click('Preview email');
    await ui.click('Create draft and open Gmail');
    assert.match(document.body.textContent, /Check Gmail Drafts/i);
    assert.equal(ui.button('Create draft and open Gmail'), undefined);
    await ui.click('Close email'); await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /Check Gmail Drafts/i);
    assert.equal(ui.requests.filter(request => request.body?.action === 'draft').length, 1);
    assert.equal(ui.popupCalls(), 0);
    assert.ok(document.querySelector('a[href$="#drafts"]'));
  }, ({ body }) => body?.action === 'draft' ? Response.json({ error: 'Check Gmail Drafts before trying again.', code: 'DRAFT_UNCERTAIN', uncertain: true }, { status: 502 }) : null);
});

test('late preview responses cannot restore old content after an edit', async () => {
  let completePreview;
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Original'); await ui.fill('Message', 'Original body');
    await act(async () => { ui.button('Preview email').click(); await Promise.resolve(); });
    await ui.fill('Subject', 'New subject');
    await act(async () => completePreview(Response.json({ recipient: { name: 'Alex Recruit', email: 'alex@example.test' }, subject: 'Original', html: '<p>Stale</p>', previewToken: 'old' })));
    assert.equal(document.querySelector('iframe'), null);
    assert.equal(ui.button('Create draft and open Gmail'), undefined);
  }, ({ body }) => body?.action === 'preview' ? new Promise(resolve => { completePreview = resolve; }) : null);
});

test('demo mode makes no Gmail requests and hides draft actions', async () => {
  await composer(async ui => { await ui.render(true); await ui.click('Compose for Alex'); assert.equal(document.querySelector('dialog').open, false); assert.equal(ui.requests.length, 0); assert.equal(ui.button('Connect Gmail'), undefined); });
});

test('a lost draft response is treated as uncertain without opening Gmail or retrying', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'A custom message');
    await ui.click('Preview email'); await ui.click('Create draft and open Gmail');
    assert.match(document.body.textContent, /Check Gmail Drafts/);
    assert.equal(ui.popupCalls(), 0);
    assert.equal(ui.requests.filter(item => item.body?.action === 'draft').length, 1);
    assert.equal(ui.button('Create draft and open Gmail'), undefined);
  }, ({ body }) => { if (body?.action === 'draft') throw Error('network lost'); return null; });
});

test('closing during draft creation preserves its eventual result and does not open an orphan popup', async () => {
  let finishDraft;
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'A custom message'); await ui.click('Preview email');
    await act(async () => { const create = ui.button('Create draft and open Gmail'); create.click(); create.click(); });
    assert.equal(ui.requests.filter(item => item.body?.action === 'draft').length, 1);
    await ui.click('Close email');
    await act(async () => finishDraft(Response.json({ created: true, draftId: 'draft-2', gmailUrl: 'https://mail.google.com/mail/?authuser=staff%40example.test#all/thread2', draftsUrl: 'https://mail.google.com/mail/?authuser=staff%40example.test#drafts' })));
    assert.equal(ui.popupCalls(), 0);
    await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /Draft created/);
    assert.ok(document.querySelector('a[href$="#all/thread2"]'));
    assert.equal(ui.requests.filter(item => item.body?.action === 'draft').length, 1);
  }, ({ body }) => body?.action === 'draft' ? new Promise(resolve => { finishDraft = resolve; }) : null);
});

test('an authenticated account change clears the previous employee draft receipt', async () => {
  let email = 'staff@example.test';
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'Private message');
    await ui.click('Preview email'); await ui.click('Create draft and open Gmail'); await ui.click('Close email');
    email = 'other@example.test';
    await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /other@example.test/);
    assert.doesNotMatch(document.body.textContent, /Draft created|Private message|staff@example.test/);
    assert.equal(document.querySelector('a[href$="#all/thread1"]'), null);
    assert.equal(document.querySelector('[role="combobox"]').value, '');
  }, ({ url, body }) => url === '/api/gmail' ? Response.json({ connected: true, available: true, email, inboxUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#inbox`, draftsUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#drafts` }) : body?.action === 'status' ? Response.json({ sender: email, available: true, templates: [] }) : null);
});


test('a browser popup exception preserves a confirmed draft and its explicit Gmail link', async () => {
  await composer(async ui => {
    window.open = () => { throw Error('popup blocked'); };
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'A custom message');
    await ui.click('Preview email'); await ui.click('Create draft and open Gmail');
    assert.match(document.body.textContent, /Draft created/);
    assert.equal(ui.button('I checked Gmail Drafts — start another email'), undefined);
    assert.ok(document.querySelector('a[href$="#all/thread1"]'));
  });
});
