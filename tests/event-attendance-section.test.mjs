import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);

// Bundles one client component for this direct Node renderer and returns its exports.
async function load(directory, entry, name) {
  const outfile = `${directory}/${name}.cjs`;
  await build({
    entryPoints: [entry], outfile, bundle: true,
    platform: 'node', format: 'cjs',
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    loader: { '.css': 'empty' }, logLevel: 'silent',
    // The real Next Image component, with its CJS default export normalized for this direct Node renderer.
    plugins: [{
      name: 'next-image-cjs-interop',
      setup(builder) {
        builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'next-image', namespace: 'interop' }));
        builder.onLoad({ filter: /.*/, namespace: 'interop' }, () => ({
          contents: `export { Image as default } from ${JSON.stringify(require.resolve('next/dist/client/image-component.js'))}`,
          loader: 'js', resolveDir: process.cwd(),
        }));
      },
    }],
  });
  return (await import(pathToFileURL(`${process.cwd()}/${outfile}`).href)).default;
}

test('Event Attendance renders as its own page and as a section of the Recruiting Dashboard', async () => {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp('work/attendance-render-');
  try {
    const Board = (await load(directory, './app/event-attendance/event-attendance-board.tsx', 'board')).default;

    const page = renderToStaticMarkup(createElement(Board));
    // The logo's preload link comes first, then the page's main landmark.
    assert.match(page, /^(?:<link [^>]*\/>)*<main\b/);
    assert.match(page, /<h1 id="event-attendance-title">Event Attendance<\/h1>/);
    assert.match(page, /legacy-logo\.png/);
    // From its own page, which may sit in the workspace frame, the Applications title opens the page in the top window.
    assert.match(page, /<h2 id="applications-title"><a class="panel-title-link" href="\/#applications" target="_top">Applications<\/a><\/h2>/);

    // On the dashboard: no second main landmark or h1, no logo, and the section is named by its heading.
    const section = renderToStaticMarkup(createElement(Board, { section: true }));
    assert.match(section, /^<section [^>]*aria-labelledby="event-attendance-title"/);
    assert.match(section, /<h2 id="event-attendance-title"><a class="panel-title-link" href="#event-attendance">Event Attendance<\/a><\/h2>/);
    assert.doesNotMatch(section, /<main\b|<h1\b|legacy-logo\.png|>Legacy Agency Partners</);
    assert.match(section, /Loading hiring event attendance from HubSpot/);

    // The Applications section is the Applications page's list; the funnel, stage chart and old group counts are gone.
    assert.match(section, /<h2 id="applications-title"><a class="panel-title-link" href="#applications">Applications<\/a><\/h2>/);
    assert.match(section, /Online agent applications from apply\.lgcyap\.com, newest first/);
    assert.match(section, /Loading applications from HubSpot/);
    for (const markup of [page, section]) assert.doesNotMatch(markup, /Sign-in → application → hire|Where sign-ins are now|From people who signed in|New applicants|Hide people|apps-title/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Event Attendance list previews leave out stage, location and the HubSpot records link', async () => {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp('work/attendance-columns-');
  try {
    const lists = await load(directory, './app/event-attendance/people-lists.tsx', 'lists');
    for (const name of ['attendeeColumns', 'appliedColumns', 'hiredColumns', 'visitColumns', 'applicantColumns']) {
      const labels = lists[name].map(column => column.label);
      assert.deepEqual(labels.slice(0, 4), ['Name', 'Phone', 'Email', 'Office'], name);
      for (const removed of ['Stage', 'Location', 'Records']) assert.ok(!labels.includes(removed), `${name} has no ${removed} column`);
    }
    const row = { ticketId: '101', name: 'Pat Example QA', email: '', phone: '', office: 'miami', stageId: '1', stage: 'Application', hubspotUrl: 'https://app.hubspot.com/x', day: '2026-11-18', at: '2026-11-18T15:00:00Z', license: '', fromAttendee: false };
    const table = renderToStaticMarkup(createElement(lists.PeopleTable, { title: 'Applied online today', rows: [row], columns: lists.applicantColumns, empty: 'None', actions: () => 'review' }));
    assert.match(table, /<th scope="col">Review and notes<\/th>/);
    assert.doesNotMatch(table, /app\.hubspot\.com|>Application</);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the Approved and Denied review renders the same controls wherever it is used', async () => {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp('work/event-review-');
  try {
    const { useEventReviews } = await load(directory, './app/event-review.tsx', 'review');
    const render = (options, row) => renderToStaticMarkup(createElement(function Probe() { return useEventReviews({ onSignedOut() {}, onStale() {}, ...options }).actions(row); }));
    const reviews = { 77: { status: 'approved', noteId: '41', reviewedAt: '2026-11-18T16:00:00.000Z' } };
    const approved = render({ reviews, reviewComplete: true, canReview: true }, { ticketId: '77', name: 'Pat Example QA' });
    assert.match(approved, /role="group" aria-label="Review for Pat Example QA"/);
    assert.match(approved, /<button type="button" [^>]*aria-label="Approve Pat Example QA" title="Approved" aria-pressed="true">✓<\/button>/);
    assert.match(approved, /<button type="button" [^>]*aria-label="Deny Pat Example QA" title="Denied" aria-pressed="false">×<\/button>/);
    assert.match(approved, />Approved<\/span>/);
    assert.match(approved, /title="Quick note for Pat Example QA"/, 'reviewers can add a note');
    assert.doesNotMatch(render({ reviews, canReview: false }, { ticketId: '77', name: 'Pat' }), /Quick note/, 'only reviewers get the note button');
    // Without review access the buttons show the decision but are disabled; with no ticket there is nothing to review.
    assert.match(render({ reviews, canReview: false }, { ticketId: '77', name: 'Pat' }), /disabled="" aria-label="Approve Pat"/);
    assert.match(render({ reviewComplete: false, canReview: true }, { ticketId: '78', name: 'Sam' }), />Status unavailable</);
    assert.match(render({ canReview: true }, { ticketId: null, name: 'Sam' }), /No recruiting ticket/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Event Attendance emails open New Email with the templates, names take a hover card, and Applications start collapsed', async () => {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp('work/attendance-email-');
  try {
    // One bundle, so the table and the email provider share the same context.
    const { writeFile } = await import('node:fs/promises');
    const entry = `${directory}/entry.tsx`;
    await writeFile(entry, `export { PeopleTable, attendeeColumns } from '../../app/event-attendance/people-lists';\nexport { RecruitEmailProvider } from '../../app/recruit-email';\n`);
    const { PeopleTable, attendeeColumns, RecruitEmailProvider } = await load(directory, `./${entry}`, 'email');
    const row = { ticketId: '101', name: 'Pat Example QA', email: 'pat@example.com', phone: '', office: 'miami', stageId: '1', stage: 'Hiring Event', hubspotUrl: 'https://app.hubspot.com/contacts/50894788/record/0-5/101', signIns: 1, firstDay: '2026-11-18', lastDay: '2026-11-18', appliedAt: null };
    const noTicket = { ...row, ticketId: null, email: 'sam@example.com', name: 'Sam Example QA' };
    const table = props => createElement(PeopleTable, { title: 'Everyone who signed in', rows: [row, noTicket], columns: attendeeColumns, empty: 'None', ...props });

    // In the workspace, a recruit's email is a button that opens New Email; someone without a ticket keeps a mail link.
    const inWorkspace = renderToStaticMarkup(createElement(RecruitEmailProvider, { recruits: [], disabled: false }, table()));
    assert.match(inWorkspace, /<button type="button" class="[^"]*" title="Write an email to Pat Example QA with your templates">pat@example\.com<span class="sr-only"> \(opens New Email\)<\/span><\/button>/);
    assert.match(inWorkspace, /<a href="mailto:sam@example\.com">sam@example\.com<\/a>/);
    assert.match(inWorkspace, /<dialog class="email-dialog(?: [^"]*)?"/);
    // Without the workspace's email (demo data), every address stays a mail link.
    assert.match(renderToStaticMarkup(table()), /<a href="mailto:pat@example\.com">pat@example\.com<\/a>/);

    // A hover handler wraps each name, and the date filter sits under the title.
    const hovered = renderToStaticMarkup(table({ hover: person => ({ 'data-hover': person.name }), filter: createElement('div', { id: 'date-filter' }) }));
    assert.match(hovered, /<h3>Everyone who signed in <span>2<\/span><\/h3>/);
    assert.match(hovered, />Export CSV<\/button>/);
    assert.match(hovered, />Export XLS<\/button>/);
    assert.match(hovered, /<div id="date-filter"><\/div>/);
    assert.match(hovered, /<th scope="row"><span class="[^"]*" data-hover="Pat Example QA"><a href="\/#recruit\/101" target="_top"/);

    // On the dashboard, Applications loads but keeps its list collapsed under the counts until one is selected.
    const Board = (await load(directory, './app/event-attendance/event-attendance-board.tsx', 'board')).default;
    const section = renderToStaticMarkup(createElement(Board, { section: true }));
    assert.doesNotMatch(section, /id="applications-list"/);
    assert.match(section, /Loading applications from HubSpot/);
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('app/applications-page.tsx', 'utf8');
    assert.match(source, /if \(tileOpen\(key\)\) \{ setListOpen\(false\); return; \}/, 'selecting the open count collapses the list');
    assert.match(source, /"aria-expanded": tileOpen\(tile\.key\), "aria-controls": "applications-list"/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
