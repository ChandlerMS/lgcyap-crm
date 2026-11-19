import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openTaskChips } from '../app/recruit-task-chips.mjs';
import { upcomingMeetingChips } from '../app/dashboard-activity.mjs';

const source = path => readFileSync(path, 'utf8');

test('the Today row, its totals and Add Recruits, Recruits and Agents sit inside the collapsed Recruiting pipeline', () => {
  const workspace = source('app/recruiting-workspace.tsx');
  assert.match(workspace, /<h1 id="page-title" className="sr-only" tabIndex=\{-1\}>Recruiting Dashboard<\/h1>/);
  assert.match(workspace, /<details className="dashboard-pipeline"><summary>Recruiting pipeline<\/summary><div className="dashboard-pipeline-body">\s*<RecruitingPeriodControls headingLevel=\{2\}[^\n]*Add Recruits[^\n]*Agents/);
  assert.doesNotMatch(workspace, /<details className="dashboard-pipeline" open/);
  // The dashboard keeps one centered width from 1080p to 4K.
  assert.match(workspace, /className=\{route\.view === "today" && !route\.id \? "content dashboard-content" : route\.view === "sales" \|\| route\.view === "calls" \? "content sales-calls-content" : "content"\}/);
  assert.match(source('app/globals.css'), /main\.content\.dashboard-content \{ max-width: 1680px; margin-inline: auto; \}/);
});

test('summary card hover lists carry each item\'s details', () => {
  const now = Date.parse('2026-11-03T03:30:00Z');
  const [task] = openTaskChips([{ id: '2', title: 'Send forms', status: 'In Progress', subtitle: 'High · Call', owner: 'Pat Recruiter', scheduledAt: '2026-10-30T14:00:00Z' }], now);
  assert.deepEqual(task.facts, [['Due', 'Oct 30, 2026 · 3 days overdue'], ['Status', 'In Progress'], ['Priority · type', 'High · Call'], ['Owner', 'Pat Recruiter']]);
  const [meeting] = upcomingMeetingChips([{ id: 'm', title: 'Interview', status: 'Scheduled', subtitle: 'Orlando office', owner: 'Pat Recruiter', scheduledAt: '2026-11-04T14:00:00Z', endedAt: '2026-11-04T14:30:00Z' }], now);
  assert.deepEqual(meeting.facts, [['When', 'Wed, Nov 4, 9:00 AM – 9:30 AM'], ['Outcome', 'Scheduled'], ['Location', 'Orlando office'], ['Owner', 'Pat Recruiter']]);
  // Every item is listed (no "+N more" cut-off), Email has a list too, and the list closes when the pointer leaves it.
  const chips = source('app/summary-chips.tsx');
  assert.match(chips, /items\.map\(chip => <li key=\{chip\.id\}>/);
  assert.doesNotMatch(chips, /PREVIEW\)/);
  assert.match(source('app/recruit-email.tsx'), /<SummaryChips id="email-summary" title="Email" preview /);
  const preview = source('app/summary-preview.tsx');
  assert.match(preview, /if \(panel\.current\?\.matches\(":hover"\) \|\| anchor\.current\?\.matches\(":hover"\)\) return;\s*setOpen\(false\);/);
  assert.doesNotMatch(preview, /!panel\.current\?\.contains\(document\.activeElement\) && !anchor\.current\?\.contains\(document\.activeElement\)/, 'focus inside no longer holds the pop-up open after the pointer leaves');
});

test('Event Attendance shows five event days a page with page numbers, Previous and Next', () => {
  const board = source('app/event-attendance/event-attendance-board.tsx');
  assert.match(board, /const DAYS_PER_PAGE = 5;/);
  assert.match(board, /data\?\.days\.slice\(dayRows\.start, dayRows\.end\)/);
  assert.match(board, /<PanelPager count=\{data\.days\.length\} page=\{dayRows\.page\} size=\{DAYS_PER_PAGE\} label="Event days"[^\n]*?numbers \/>/);
});

test('Queues put TV HUD to the right of Refresh, and RingCentral matches the Legacy Bot button', () => {
  for (const path of ['app/queue/queue-board.tsx', 'app/ringcx/ringcx-dashboard.tsx']) {
    const text = source(path);
    assert.ok(text.indexOf('TV HUD</a>') > text.indexOf("'Refresh'") || text.indexOf('TV HUD</a>') > text.indexOf('"Refresh"'), `${path}: TV HUD follows Refresh`);
    assert.ok(text.indexOf('"Refresh"') > 0 || text.indexOf("'Refresh'") > 0);
  }
  assert.match(source('app/ringcentral-panel.tsx'), /className="legacy-bot-launcher rc-launcher"/);
});

test('the 3D pipeline is sized like All stages', () => {
  const css = source('app/recruit-pipeline.module.css');
  assert.match(css, /The 3D view takes the same space as All stages/);
  assert.match(css, /\.face \.stageToggle \{[^}]*font-size: 14px; \}/);
});
