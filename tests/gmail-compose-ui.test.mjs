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
    if (url === '/api/gmail' && body?.action === 'acknowledge-send') return Response.json({ acknowledged: true });
    if (url === '/api/gmail') return Response.json({ connected: true, canRead: true, available: true, email: 'staff@example.test', inboxUrl: 'https://mail.google.com/mail/u/staff@example.test/#inbox', draftsUrl: 'https://mail.google.com/mail/u/staff@example.test/#drafts' });
    if (body.action === 'status') return Response.json({ sender: 'staff@example.test', available: true, templates });
    if (body.action === 'prepare') return Response.json(body.replyMessageId ? { recipient: { name: 'Original Sender', email: 'sender@example.test' }, templates: [], subject: 'Re: Original subject' } : { recipient, templates });
    if (body.action === 'preview') return Response.json({ recipient, subject: body.subject, html: '<html><body><h1>Complete branded offer</h1><p>All terms and dates</p></body></html>', previewToken: 'signed-preview' });
    if (body.action === 'send') return Response.json({ sent: true, messageId: 'message-1', threadId: 'thread1', notice: 'Email sent.' });
    throw Error('Unexpected API request');
  };
  let root;
  const { createRoot } = await import('react-dom/client');
  try {
    await writeFile(`${dir}/entry.tsx`, `import React from 'react'; import {RecruitEmailProvider,useRecruitEmail} from '../../app/recruit-email'; function Open(){const {open,openReply}=useRecruitEmail(); return <><button onClick={()=>open('123','Alex Recruit')}>Compose for Alex</button><button onClick={()=>openReply('original-1')}>Reply to original</button></>}; export default function App({disabled=false}){return <RecruitEmailProvider recruits={[{id:'123',name:'Alex Recruit',email:'alex@example.test'}]} disabled={disabled}><Open/></RecruitEmailProvider>}`);
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

test('templates can be selected and previewed before one explicit in-app send', async () => {
  await composer(async ui => {
    assert.equal(ui.requests.length, 0, 'hidden composer does not refresh Google credentials');
    await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /staff@example.test/);
    assert.match(document.body.textContent, /read and send email/i);
    assert.equal(ui.button('Send email'), undefined);
    await fillOffer(ui);
    await ui.click('Preview email');
    assert.equal(ui.requests.find(request => request.body?.action === 'preview').body.fields.acceptBy, '2026-12-01');
    const frame = document.querySelector('iframe[title="Complete email preview"]');
    assert.equal(frame.getAttribute('sandbox'), '');
    assert.match(frame.getAttribute('srcdoc'), /Complete branded offer.*All terms and dates/);
    await ui.click('Send email');
    const send = ui.requests.filter(request => request.body?.action === 'send');
    assert.equal(send.length, 1);
    assert.equal(send[0].body.previewToken, 'signed-preview');
    assert.match(send[0].body.requestId, /^[\w-]{16,}$/);
    assert.equal(send[0].body.fields.contractingTime, '10:30');
    assert.equal(ui.popupCalls(), 0);
    assert.equal(document.querySelector('a[href*="mail.google.com"]'), null);
    assert.match(document.body.textContent, /Email sent/);
    assert.ok(document.querySelector('a[href="#email"]'));
    await ui.click('Close email'); await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /Email sent/);
    assert.equal(ui.requests.filter(request => request.body?.action === 'send').length, 1);
  });
});

test('editing a preview requires another review and custom messages use the same send flow', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex');
    assert.equal(document.querySelector('label input[type="text"]').maxLength, 200);
    await ui.fill('Subject', 'Hello Alex'); await ui.fill('Message', 'A custom message');
    await ui.click('Preview email');
    assert.ok(ui.button('Send email'));
    await ui.fill('Subject', 'Revised subject');
    assert.equal(ui.button('Send email'), undefined);
    await ui.click('Preview email'); await ui.click('Send email');
    const send = ui.requests.find(request => request.body?.action === 'send').body;
    assert.equal(send.templateId, ''); assert.equal(send.body, 'A custom message'); assert.equal(send.subject, 'Revised subject');
  });
});

test('uncertain send result blocks retries across close and reopen until the user checks Sent', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex'); await fillOffer(ui); await ui.click('Preview email');
    await ui.click('Send email');
    assert.match(document.body.textContent, /Check Sent email/i);
    assert.equal(ui.button('Send email'), undefined);
    await ui.click('Close email'); await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /Check Sent email/i);
    assert.equal(ui.requests.filter(request => request.body?.action === 'send').length, 1);
    assert.equal(ui.popupCalls(), 0);
    assert.ok(document.querySelector('a[href="#email"]'));
  }, ({ body }) => body?.action === 'send' ? Response.json({ error: 'Check Sent email before trying again.', code: 'SEND_UNCERTAIN', uncertain: true }, { status: 502 }) : null);
});

test('late preview responses cannot restore old content after an edit', async () => {
  let completePreview;
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Original'); await ui.fill('Message', 'Original body');
    await act(async () => { ui.button('Preview email').click(); await Promise.resolve(); });
    await ui.fill('Subject', 'New subject');
    await act(async () => completePreview(Response.json({ recipient: { name: 'Alex Recruit', email: 'alex@example.test' }, subject: 'Original', html: '<p>Stale</p>', previewToken: 'old' })));
    assert.equal(document.querySelector('iframe'), null);
    assert.equal(ui.button('Send email'), undefined);
  }, ({ body }) => body?.action === 'preview' ? new Promise(resolve => { completePreview = resolve; }) : null);
});

test('demo mode makes no Gmail requests and hides send actions', async () => {
  await composer(async ui => { await ui.render(true); await ui.click('Compose for Alex'); assert.equal(document.querySelector('dialog').open, false); assert.equal(ui.requests.length, 0); assert.equal(ui.button('Connect Gmail'), undefined); });
});

test('a lost send response is treated as uncertain without opening Gmail or retrying', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'A custom message');
    await ui.click('Preview email'); await ui.click('Send email');
    assert.match(document.body.textContent, /Check Sent email/);
    assert.equal(ui.popupCalls(), 0);
    assert.equal(ui.requests.filter(item => item.body?.action === 'send').length, 1);
    assert.equal(ui.button('Send email'), undefined);
  }, ({ body }) => { if (body?.action === 'send') throw Error('network lost'); return null; });
});

test('closing during sending preserves its eventual result and does not open an orphan popup', async () => {
  let finishSend;
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'A custom message'); await ui.click('Preview email');
    await act(async () => { const create = ui.button('Send email'); create.click(); create.click(); });
    assert.equal(ui.requests.filter(item => item.body?.action === 'send').length, 1);
    await ui.click('Close email');
    await act(async () => finishSend(Response.json({ sent: true, messageId: 'message-2', threadId: 'thread2', notice: 'Email sent.' })));
    assert.equal(ui.popupCalls(), 0);
    await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /Email sent/);
    assert.ok(document.querySelector('a[href="#email"]'));
    assert.equal(ui.requests.filter(item => item.body?.action === 'send').length, 1);
  }, ({ body }) => body?.action === 'send' ? new Promise(resolve => { finishSend = resolve; }) : null);
});

test('an authenticated account change clears the previous employee send receipt', async () => {
  let email = 'staff@example.test';
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'Private message');
    await ui.click('Preview email'); await ui.click('Send email'); await ui.click('Close email');
    email = 'other@example.test';
    await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /other@example.test/);
    assert.doesNotMatch(document.body.textContent, /Email sent|Private message|staff@example.test/);
    assert.equal(document.querySelector('a[href$="#all/thread1"]'), null);
    assert.equal(document.querySelector('[role="combobox"]').value, '');
  }, ({ url, body }) => url === '/api/gmail' ? Response.json({ connected: true, canRead: true, available: true, email, inboxUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#inbox`, draftsUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#drafts` }) : body?.action === 'status' ? Response.json({ sender: email, available: true, templates: [] }) : null);
});



test('templates can be previewed while disconnected and Send requires inbox authorization', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex'); await fillOffer(ui); await ui.click('Preview email');
    assert.ok(document.querySelector('iframe'));
    assert.ok(ui.button('Send email').disabled);
    assert.ok(ui.button('Reconnect Gmail'));
    assert.equal(ui.requests.some(item => item.body?.action === 'send'), false);
  }, ({ url }) => url === '/api/gmail' ? Response.json({ available: true, connected: true, canRead: false, email: 'staff@example.test' }) : null);
});

test('Reply uses the server-verified message recipient and sends the reviewed reply in app', async () => {
  await composer(async ui => {
    await ui.click('Reply to original');
    assert.match(document.body.textContent, /sender@example.test/);
    assert.equal(document.querySelector('[role="combobox"]'), null);
    assert.ok(document.querySelector('select'), 'reply also offers the shared template selector');
    assert.equal(document.querySelector('input[type="text"]').value, 'Re: Original subject');
    assert.equal(document.querySelector('input[type="text"]').readOnly, true);
    assert.equal(document.querySelector('input[type="text"]').maxLength, 1000);
    await ui.fill('Message', 'My reply'); await ui.click('Preview email'); await ui.click('Send email');
    const input = ui.requests.find(item => item.body?.action === 'send').body;
    assert.equal(input.replyMessageId, 'original-1'); assert.equal(input.recruitId, undefined);
    assert.equal(input.to, undefined); assert.equal(input.body, 'My reply'); assert.equal(input.previewToken, 'signed-preview');
    assert.equal(ui.popupCalls(), 0);
  });
});


test('disconnected employees can inspect eligible templates and the complete preview', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex');
    assert.ok(ui.button('Connect Gmail')); await fillOffer(ui); await ui.click('Preview email');
    assert.ok(document.querySelector('iframe[title="Complete email preview"]'));
    assert.equal(ui.button('Send email').disabled, true); assert.equal(ui.requests.some(item => item.body?.action === 'send'), false);
  }, ({ url }) => url === '/api/gmail' ? Response.json({ available: true, connected: false, canRead: false, email: 'staff@example.test' }) : null);
});

test('an uncertain send requires explicit acknowledgement after viewing the in-app Sent link', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'My message');
    await ui.click('Preview email'); await ui.click('Send email');
    const sentLink = document.querySelector('a[href="#email"]');
    await act(async () => sentLink.click()); assert.equal(document.querySelector('dialog').open, false);
    await ui.click('Compose for Alex'); assert.match(document.body.textContent, /Check Sent email/);
    await ui.click('I checked Sent — start another email');
    assert.doesNotMatch(document.body.textContent, /Check Sent email/);
    assert.equal(document.querySelector('[role="combobox"]').value, '');
    assert.equal(ui.requests.filter(item => item.body?.action === 'send').length, 1);
  }, ({ body }) => body?.action === 'send' ? Response.json({ error: 'Check Sent email before trying again.', uncertain: true, code: 'SEND_UNCERTAIN' }, { status: 502 }) : null);
});

test('switching through demo mode preserves an uncertain send until acknowledgement', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'My message');
    await ui.click('Preview email'); await ui.click('Send email');
    await ui.render(true); await ui.render(false); await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /Check Sent email/);
    assert.equal(ui.button('Send email'), undefined);
    assert.equal(ui.requests.filter(item => item.body?.action === 'send').length, 1);
  }, ({ body }) => body?.action === 'send' ? Response.json({ uncertain: true, code: 'SEND_UNCERTAIN', error: 'Check Sent email before trying again.' }, { status: 502 }) : null);
});


test('a fresh composer recovers the durable send lock and clears it only after explicit successful acknowledgement', async () => {
  let acknowledgements = 0, unresolved = true;
  await composer(async ui => {
    assert.equal(ui.requests.length, 0);
    await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /Check Sent email/);
    assert.equal(ui.button('Send email'), undefined);
    assert.equal(ui.requests.some(item => item.body?.action === 'prepare'), false);
    assert.equal(acknowledgements, 0, 'opening the composer never acknowledges a send');
    await ui.click('I checked Sent — start another email');
    assert.match(document.body.textContent, /Another message is still sending/);
    assert.match(document.body.textContent, /Check Sent email/);
    assert.equal(document.querySelector('[role="combobox"]'), null);
    await ui.click('I checked Sent — start another email');
    assert.equal(acknowledgements, 2);
    assert.doesNotMatch(document.body.textContent, /Check Sent email/);
    assert.equal(document.querySelector('[role="combobox"]').value, '');
  }, ({ url, body }) => {
    if (url !== '/api/gmail') return null;
    if (body?.action === 'acknowledge-send') {
      assert.equal(body.requestId, '11111111-1111-4111-8111-111111111111');
      acknowledgements++;
      if (acknowledgements === 1) return Response.json({ error: 'Another message is still sending. Try again later.' }, { status: 409 });
      unresolved = false; return Response.json({ acknowledged: true });
    }
    return Response.json({ available: true, connected: true, canRead: true, email: 'staff@example.test', unresolvedSend: unresolved, acknowledgeAfter: '2026-11-19T10:02:00Z', unresolvedRequestId: '11111111-1111-4111-8111-111111111111' });
  });
});

test('acknowledgement network errors keep the recovered send lock', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.click('I checked Sent — start another email');
    assert.match(document.body.textContent, /Check Sent email/);
    assert.match(document.body.textContent, /could not be acknowledged/i);
    assert.equal(document.querySelector('[role="combobox"]'), null);
    assert.equal(ui.requests.filter(item => item.body?.action === 'acknowledge-send').length, 1);
  }, ({ url, body }) => {
    if (url !== '/api/gmail') return null;
    if (body?.action === 'acknowledge-send') throw Error('Network error');
    return Response.json({ available: true, connected: true, canRead: true, email: 'staff@example.test', unresolvedSend: true, acknowledgeAfter: null, unresolvedRequestId: '11111111-1111-4111-8111-111111111111' });
  });
});

test('authoritative unresolved status replaces a confirmed receipt and blocks composing', async () => {
  let unresolved = false;
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'My message');
    await ui.click('Preview email'); await ui.click('Send email'); await ui.click('Close email');
    unresolved = true; await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /Check Sent email/);
    assert.match(document.body.textContent, /different unresolved send/i);
    assert.doesNotMatch(document.body.textContent, /Email sent/);
    assert.equal(document.querySelector('[role="combobox"]'), null);
    assert.equal(ui.requests.some(item => item.body?.action === 'acknowledge-send'), false);
  }, ({ url }) => url === '/api/gmail' ? Response.json({ available: true, connected: true, canRead: true, email: 'staff@example.test', unresolvedSend: unresolved, unresolvedRequestId: unresolved ? '22222222-2222-4222-8222-222222222222' : null, acknowledgeAfter: null }) : null);
});


test('authoritative status replaces an outdated receipt ID and a rejected acknowledgement keeps the new lock', async () => {
  let oldRequestId = '';
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'My message');
    await ui.click('Preview email'); await ui.click('Send email');
    oldRequestId = ui.requests.find(item => item.body?.action === 'send').body.requestId;
    await ui.click('Close email'); await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /different unresolved send/i);
    assert.equal(ui.requests.some(item => item.body?.action === 'acknowledge-send'), false);
    await ui.click('I checked Sent — start another email');
    assert.equal(ui.requests.find(item => item.body?.action === 'acknowledge-send').body.requestId, '22222222-2222-4222-8222-222222222222');
    assert.match(document.body.textContent, /The unresolved send has changed/);
    assert.match(document.body.textContent, /Check Sent email/);
    assert.equal(document.querySelector('[role="combobox"]'), null);
  }, ({ url, body }) => {
    if (body?.action === 'send') return Response.json({ uncertain: true, code: 'SEND_UNCERTAIN', error: 'Original send could not be confirmed.' }, { status: 502 });
    if (url !== '/api/gmail') return null;
    if (body?.action === 'acknowledge-send') return Response.json({ error: 'The unresolved send has changed. Refresh before acknowledging.' }, { status: 409 });
    return Response.json({ available: true, connected: true, canRead: true, email: 'staff@example.test', unresolvedSend: Boolean(oldRequestId), unresolvedRequestId: oldRequestId ? '22222222-2222-4222-8222-222222222222' : null });
  });
});

test('an unconfirmed acknowledgement response never clears the recovered send lock', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.click('I checked Sent — start another email');
    assert.match(document.body.textContent, /Check Sent email/); assert.match(document.body.textContent, /could not be acknowledged/i);
    assert.equal(document.querySelector('[role="combobox"]'), null);
  }, ({ url, body }) => url !== '/api/gmail' ? null : body?.action === 'acknowledge-send' ? Response.json({}) : Response.json({ available: true, connected: true, canRead: true, email: 'staff@example.test', unresolvedSend: true, unresolvedRequestId: '11111111-1111-4111-8111-111111111111' }));
});

test('reopening recovers the request ID for an older receipt before acknowledgement', async () => {
  let statusChecks = 0;
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.click('I checked Sent — start another email');
    assert.match(document.body.textContent, /Close and reopen email/);
    assert.equal(ui.requests.some(item => item.body?.action === 'acknowledge-send'), false);
    await ui.click('Close email'); await ui.click('Compose for Alex'); await ui.click('I checked Sent — start another email');
    const acknowledgement = ui.requests.find(item => item.body?.action === 'acknowledge-send');
    assert.equal(acknowledgement.body.requestId, '11111111-1111-4111-8111-111111111111');
    assert.doesNotMatch(document.body.textContent, /Check Sent email/);
  }, ({ url, body }) => {
    if (url !== '/api/gmail' || body?.action) return null;
    statusChecks++;
    return Response.json({ available: true, connected: true, canRead: true, email: 'staff@example.test', unresolvedSend: true, unresolvedRequestId: statusChecks === 1 ? null : '11111111-1111-4111-8111-111111111111' });
  });
});

test('a send blocked by another unresolved request acknowledges only the server-returned request ID', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'My message');
    await ui.click('Preview email'); await ui.click('Send email'); await ui.click('I checked Sent — start another email');
    const requestedId = ui.requests.find(item => item.body?.action === 'send').body.requestId;
    const acknowledgedId = ui.requests.find(item => item.body?.action === 'acknowledge-send').body.requestId;
    assert.notEqual(requestedId, acknowledgedId);
    assert.equal(acknowledgedId, '22222222-2222-4222-8222-222222222222');
    assert.doesNotMatch(document.body.textContent, /Check Sent email/);
  }, ({ body }) => body?.action === 'send' ? Response.json({ uncertain: true, code: 'SEND_UNCERTAIN', unresolvedRequestId: '22222222-2222-4222-8222-222222222222', error: 'Check the earlier send in Sent email.' }, { status: 409 }) : null);
});


test('a lost new send response recovers another tab’s authoritative unresolved UUID before explicit acknowledgement', async () => {
  let lostResponse = false;
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'My message');
    await ui.click('Preview email'); await ui.click('Send email');
    const localId = ui.requests.find(item => item.body?.action === 'send').body.requestId;
    await ui.click('Close email'); await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /different unresolved send/i);
    assert.equal(ui.requests.some(item => item.body?.action === 'acknowledge-send'), false);
    await ui.click('I checked Sent — start another email');
    const acknowledgedId = ui.requests.find(item => item.body?.action === 'acknowledge-send').body.requestId;
    assert.equal(acknowledgedId, '11111111-1111-4111-8111-111111111111'); assert.notEqual(acknowledgedId, localId);
    assert.doesNotMatch(document.body.textContent, /Check Sent email/);
  }, ({ url, body }) => {
    if (body?.action === 'send') { lostResponse = true; throw Error('Network response lost'); }
    if (url !== '/api/gmail' || body?.action) return null;
    return Response.json({ available: true, connected: true, canRead: true, email: 'staff@example.test', unresolvedSend: lostResponse, unresolvedRequestId: lostResponse ? '11111111-1111-4111-8111-111111111111' : null });
  });
});

test('an explicit clear server status retains a local uncertain UUID until acknowledgement', async () => {
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.fill('Subject', 'Hello'); await ui.fill('Message', 'My message');
    await ui.click('Preview email'); await ui.click('Send email'); await ui.click('Close email'); await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /Check Sent email/);
    await ui.click('I checked Sent — start another email');
    assert.equal(ui.requests.find(item => item.body?.action === 'acknowledge-send').body.requestId, ui.requests.find(item => item.body?.action === 'send').body.requestId);
  }, ({ url, body }) => body?.action === 'send' ? Response.json({ uncertain: true, code: 'SEND_UNCERTAIN', error: 'Original send could not be confirmed.' }, { status: 502 }) : url === '/api/gmail' && !body?.action ? Response.json({ available: true, connected: true, canRead: true, email: 'staff@example.test', unresolvedSend: false, unresolvedRequestId: null }) : null);
});

test('a delayed acknowledgement cannot clear a newer authoritative recovery warning', async () => {
  let lookups = 0, acknowledgements = 0, finishFirstAcknowledgement;
  await composer(async ui => {
    await ui.click('Compose for Alex'); await ui.click('I checked Sent — start another email');
    await ui.click('Close email'); await ui.click('Compose for Alex');
    assert.match(document.body.textContent, /different unresolved send/i);
    await act(async () => finishFirstAcknowledgement(Response.json({ acknowledged: true })));
    assert.match(document.body.textContent, /Check Sent email/);
    await ui.click('I checked Sent — start another email');
    assert.equal(ui.requests.filter(item => item.body?.action === 'acknowledge-send')[1].body.requestId, '22222222-2222-4222-8222-222222222222');
    assert.doesNotMatch(document.body.textContent, /Check Sent email/);
  }, ({ url, body }) => {
    if (url !== '/api/gmail') return null;
    if (body?.action === 'acknowledge-send') {
      acknowledgements++;
      return acknowledgements === 1 ? new Promise(resolve => { finishFirstAcknowledgement = resolve; }) : Response.json({ acknowledged: true });
    }
    lookups++;
    return Response.json({ available: true, connected: true, canRead: true, email: 'staff@example.test', unresolvedSend: true, unresolvedRequestId: lookups === 1 ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222' });
  });
});
