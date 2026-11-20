import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
test('attendance details isolate the selected day and record type and expose recruit actions', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/count-test-');
  try {
    await build({ entryPoints: ['app/event-attendance/attendance-count.tsx'], outfile: `${dir}/count.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const { AttendanceDetails } = require(`${process.cwd()}/${dir}/count.cjs`);
    const person = { ticketId: '123', name: 'Selected Recruit', phone: '4075551234', email: 'test@example.com', office: 'orlando', stage: 'Hiring Event', stageId: '1', hubspotUrl: 'https://app.hubspot.com/contacts/1/ticket/123', day: '2026-11-18', at: '2026-11-18T18:00:00Z', heardAbout: 'Friend', license: 'Yes', imported: false };
    const props = { visits: [person, { ...person, name: 'Wrong day', day: '2026-11-17' }], applicants: [{ ...person, name: 'Online Applicant', fromAttendee: true }], canAdd: true };
    const signins = renderToStaticMarkup(createElement(AttendanceDetails, { ...props, selection: { kind: 'sign-ins', day: person.day } }));
    assert.match(signins, /Selected Recruit/); assert.match(signins, /Friend/); assert.doesNotMatch(signins, /Wrong day|Online Applicant/);
    for (const label of ['Call', 'Text', 'Email', 'Add Task', 'Add Follow-Up', 'Add Meeting', 'Add to Calendar']) assert.ok(signins.includes(label), label);
    const apps = renderToStaticMarkup(createElement(AttendanceDetails, { ...props, selection: { kind: 'applications', day: person.day } }));
    assert.match(apps, /Online Applicant/); assert.doesNotMatch(apps, /Selected Recruit|Wrong day/);
    const empty = renderToStaticMarkup(createElement(AttendanceDetails, { ...props, selection: { kind: 'applications', day: '2026-11-16' } }));
    assert.match(empty, /No online applications/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
