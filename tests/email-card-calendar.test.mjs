import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function load(directory, entry, name) {
  const outfile = `${directory}/${name}.cjs`;
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
  return (await import(pathToFileURL(`${process.cwd()}/${outfile}`).href)).default;
}

test('the Calendar card pop-up opens a month calendar with Day, Week and Month, moving to any date', async () => {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp('work/calendar-preview-');
  try {
    const CalendarPreview = (await load(directory, './app/calendar-preview.tsx', 'calendar')).default;
    // 10 AM Eastern on Thursday, Nov 19, 2026.
    const now = Date.parse('2026-11-19T15:00:00Z');
    const meetings = [
      { id: 'a', title: 'Interview Pat', scheduledAt: '2026-11-19T16:00:00Z', hubspotUrl: 'https://app.hubspot.com/contacts/50894788/record/0-47/1' },
      { id: 'b', title: 'Offer call', scheduledAt: '2026-11-25T04:30:00Z', hubspotUrl: 'https://evil.example/x' },
      { id: 'c', title: 'Undated' },
    ];
    const markup = renderToStaticMarkup(createElement(CalendarPreview, { meetings, now }));
    assert.match(markup, /role="group" aria-label="Calendar view"><button type="button" aria-pressed="false">Day<\/button><button type="button" aria-pressed="false">Week<\/button><button type="button" aria-pressed="true">Month<\/button>/);
    assert.match(markup, /aria-label="Previous month"/);
    assert.match(markup, /aria-label="Next month"/);
    assert.match(markup, /<input type="date" min="2000-01-01" max="2100-12-31" value="2026-11-19"\/>/);
    assert.match(markup, /<p class="cal-preview-title" aria-live="polite">November 2026<\/p>/);
    // November 2026 runs Sunday Nov 1 to Monday Nov 30: five weeks of cells, today marked.
    assert.equal((markup.match(/class="cal-preview-cell/g) ?? []).length, 35);
    assert.match(markup, /cal-preview-cell is-today"><button[^>]*>19<\/button><div class="cal-preview-event"><span>11:00 AM<\/span><a href="https:\/\/app\.hubspot\.com\/contacts\/50894788\/record\/0-47\/1" target="_blank"/);
    // 11:30 PM Eastern on Nov 24 stays on the 24th, and a link outside HubSpot is not followed.
    assert.match(markup, />24<\/button><div class="cal-preview-event"><span>11:30 PM<\/span><span>Offer call<\/span>/);
    assert.doesNotMatch(markup, /evil\.example|Undated/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the Email card has a clickable title, a gold plus like the other cards, and recruits that open New Email', () => {
  const email = readFileSync('app/recruit-email.tsx', 'utf8');
  assert.match(email, /<button type="button" className="summary-add" title="New Email" disabled=\{disabled\} onClick=\{\(\) => open\(\)\}><span aria-hidden="true">\+<\/span><span className="sr-only">New Email<\/span><\/button>/);
  assert.match(email, /onTitleClick=\{disabled \? undefined : \(\) => open\(\)\}/);
  assert.match(email, /onSelect: \(\) => open\(r\.id, r\.name\)/);
  assert.doesNotMatch(email, /lead=\{<button className="btn btn-quiet email-new-button"/, 'the text button beside the title is gone');
  const chips = readFileSync('app/summary-chips.tsx', 'utf8');
  assert.match(chips, /<button type="button" className="summary-chips-link summary-title-button" onClick=\{onTitleClick\}>/);
  assert.match(readFileSync('app/recruit-meeting-chips.tsx', 'utf8'), /previewWidth=\{760\}\s*previewExtra=\{<CalendarPreview /);
});
