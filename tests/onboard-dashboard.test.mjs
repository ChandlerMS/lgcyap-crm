import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../vendor/lgcy-onboard/src/pages/app.html', import.meta.url), 'utf8');
const dashboard = html.slice(html.indexOf('function vDashboard() {'), html.indexOf('// Columns with appointments'));

function render(stages) {
  const candidates = stages.map(stage => ({ stage, notes: [], source: 'Synthetic', recruiter: 'Test' }));
  return runInNewContext(`${dashboard}\nvDashboard()`, {
    V: () => candidates, CANDS: candidates, TASKS: [], TODAY: new Date('2026-11-03T12:00:00Z'),
    STAGES: [{ id: 'applied', name: 'Applied', color: '#fff' }, { id: 'cholito', name: 'Hired', color: '#fff' }],
    daysBetween: () => 0, nextAppt: () => null, isAdmin: () => false, ME: 'Test',
    upcomingSessions: () => [], SESSIONS: [{ roster: [], cap: 25 }], CLASSES: [{ roster: [], cap: 15 }],
    sessLabel: () => 'Synthetic session', esc: value => value, av: () => '',
  });
}

test('empty Version 2 dashboard explains the missing cohort and never renders invalid percentages', () => {
  const rendered = render([]);
  assert.match(rendered, /No applicants yet/);
  assert.doesNotMatch(rendered, /NaN|Infinity/);
  assert.match(rendered, /width:0%/);
});

test('Version 2 hire percentages retain zero, rounded partial, and complete cohort results', () => {
  for (const [stages, expected] of [[['applied'], 0], [['cholito', 'applied', 'applied'], 33], [['cholito'], 100]]) {
    assert.match(render(stages), new RegExp(`${expected}% of all applicants`));
  }
});
