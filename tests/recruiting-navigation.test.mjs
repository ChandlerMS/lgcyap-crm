import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STAGE_PAGES, STAGES, TERMINAL_STAGE_IDS } from '../lib/recruiting-config.mjs';
import {
  WORKSPACE_NAV, WORKSPACE_NAV_GROUPS, HUBSPOT_TOOLS, SIDEBAR_HUBSPOT_TOOLS, SIDEBAR_RECRUITING_PAGES, RECRUITS_PAGE_TOOLS, QUEUE_PAGES, resolveWorkspaceRoute, stagePageForRecord,
  recordsForStagePage, unmappedStageRecords, sidebarViewFor,
} from '../app/recruiting-navigation.mjs';

test('canonical stages are shared while each entry path has its own sidebar order', () => {
  assert.deepEqual(WORKSPACE_NAV.slice(0, 2).map(page => page.label), ['Recruiting Dashboard', 'Add Recruits']);
  assert.deepEqual(WORKSPACE_NAV_GROUPS.find(group => group.id === 'genpop').items.map(page => page.label), ['Hiring Event', 'Application', 'Phone Interview']);
  assert.deepEqual(WORKSPACE_NAV_GROUPS.find(group => group.id === 'mass-recruiting').items.map(page => page.label), ['Application', 'Phone Interview', 'Hiring Event']);
  assert.equal(new Set(STAGE_PAGES.map(page => page.id)).size, 10);
  assert.equal(new Set(STAGE_PAGES.map(page => page.stageId)).size, 10);
  assert.equal(new Set(WORKSPACE_NAV.map(page => page.id)).size, WORKSPACE_NAV.length);
  for (const page of STAGE_PAGES) assert.equal(STAGES[page.stageId], page.label);
  assert.deepEqual(TERMINAL_STAGE_IDS, ['1416243218', '1473318773']);
  assert.equal(STAGE_PAGES.find(page => page.id === 'completed').stageId, '1416243218');
});

test('Recruiting Dashboard heads the sidebar alone and Add Recruits opens from a dashboard button', () => {
  assert.deepEqual(SIDEBAR_RECRUITING_PAGES.map(page => [page.label, page.id, page.icon]), [['Recruiting Dashboard', 'today', 'funnel']]);
  assert.deepEqual(resolveWorkspaceRoute('#today'), { view: 'today' });
  assert.deepEqual(resolveWorkspaceRoute('#add-recruits'), { view: 'add-recruits' });
  // Pages reached from another page light up that page's sidebar link.
  assert.equal(sidebarViewFor('add-recruits'), 'today');
  assert.equal(sidebarViewFor('event-attendance'), 'today');
  assert.equal(sidebarViewFor('call-analytics'), 'leaderboard');
  assert.equal(sidebarViewFor('inbox'), 'inbox');
  const workspace = readFileSync('app/recruiting-workspace.tsx', 'utf8');
  // The dashboard is a direct link, not a row that only opens and closes.
  assert.match(workspace, /SIDEBAR_RECRUITING_PAGES\.map\(navigationLink\)/);
  assert.doesNotMatch(workspace, /nav-recruits|recruit-pages/);
  // Sidebar order: Recruiting Dashboard, a gold rule, Leaderboard, Queues, then the HubSpot tools.
  const nav = workspace.slice(workspace.indexOf('const navigation = <>'), workspace.indexOf('const leaderboardSwitch'));
  const order = ['SIDEBAR_RECRUITING_PAGES.map(navigationLink)', 'nav-gold-divider', 'navigationLink(WORKSPACE_EXTRA_PAGES[0])', '<span>Queues</span>', 'QUEUE_PAGES.map(navigationLink)', 'SIDEBAR_HUBSPOT_TOOLS.map'].map(token => nav.indexOf(token));
  assert.ok(order.every(index => index >= 0), 'every sidebar entry is present');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // Add Recruits, Call Analytics and Event Attendance open from their pages, not the sidebar.
  assert.doesNotMatch(nav, /add-recruits|WORKSPACE_EXTRA_PAGES\.map|event-attendance|Event Attendance/);
  // Add Recruits is a button on the dashboard.
  assert.match(workspace, /actions=\{<a className="btn btn-primary add-recruits-button" href="#add-recruits">/);
});

test('Queues lists Shopper and Standard vs Preferred, and each opens on its own', () => {
  assert.deepEqual(QUEUE_PAGES.map(page => [page.label, page.id, page.source]), [['Shopper', 'queue', 'shopper'], ['Standard vs Preferred', 'ringcx', 'svp']]);
  for (const page of QUEUE_PAGES) assert.deepEqual(resolveWorkspaceRoute(`#${page.id}`), { view: page.id });
  const workspace = readFileSync('app/recruiting-workspace.tsx', 'utf8');
  assert.match(workspace, /aria-expanded=\{queuesExpanded\} aria-controls="nav-queues"/);
  assert.match(workspace, /<div id="nav-queues" className="nav-group-pages" hidden=\{!queuesExpanded\}>/);
  assert.match(workspace, /src=\{`\/queue\?embedded=1&source=\$\{queuePage\.source\}`\}/);
  const queue = readFileSync('app/queue/page.tsx', 'utf8');
  assert.match(queue, /if \(source === "shopper"\) return <QueueBoard embedded=\{embedded\} \/>;/);
  assert.match(queue, /if \(source === "svp"\) return <RingCxDashboard \/>;/);
  // Without a source, the page (and queue.lgcyap.com) still shows both together.
  assert.match(queue, /return <UnifiedQueue embedded=\{embedded\} \/>;/);
});

test('Event Attendance is a dashboard section between the pipeline and Meetings, and its saved page link still works', () => {
  const workspace = readFileSync('app/recruiting-workspace.tsx', 'utf8');
  const today = workspace.slice(workspace.indexOf('if (route.view === "today")'));
  const pipeline = today.indexOf('<RecruitPipeline'), attendance = today.indexOf('<EventAttendanceBoard section />'), meetings = today.indexOf('recruitsPagePanel("meetings")');
  assert.ok(pipeline >= 0 && pipeline < attendance && attendance < meetings);
  assert.deepEqual(resolveWorkspaceRoute('#event-attendance'), { view: 'event-attendance' });
});

test('Leaderboard and Call Analytics switch with a toggle at the top of both pages', () => {
  const workspace = readFileSync('app/recruiting-workspace.tsx', 'utf8');
  assert.match(workspace, /if \(callAnalyticsView\) return <>\{leaderboardSwitch\}<LeadData /);
  assert.match(workspace, /if \(leaderboardView\) return <>\{leaderboardSwitch\}<Leaderboard /);
});

test('native HubSpot tools use the verified portal and exact requested order', () => {
  assert.deepEqual(HUBSPOT_TOOLS.map(tool => tool.label), ['Inbox', 'Calls', 'Recruits', 'Contract Agents', 'Help Desk', 'Tickets']);
  for (const tool of HUBSPOT_TOOLS) {
    assert.deepEqual(resolveWorkspaceRoute(`#${tool.id}`), { view: tool.id });
    assert.equal(new URL(tool.href).origin, 'https://app.hubspot.com');
    assert.match(new URL(tool.href).pathname, /(?:^|\/)50894788(?:\/|$)/);
  }
});

test('Meetings, Calendar and Calls are panels on the Recruits page; only Calls keeps a page of its own', () => {
  assert.deepEqual(RECRUITS_PAGE_TOOLS.map(tool => tool.label), ['Meetings', 'Calendar', 'Calls']);
  for (const tool of RECRUITS_PAGE_TOOLS.filter(item => item.id !== 'calls')) {
    assert.equal(HUBSPOT_TOOLS.some(item => item.id === tool.id), false);
    assert.deepEqual(resolveWorkspaceRoute(`#${tool.id}`), { view: 'today' });
  }
  assert.deepEqual(resolveWorkspaceRoute('#calls'), { view: 'calls' });
  // Calls and Recruits open from their panel titles; their pages stay but leave the sidebar.
  assert.deepEqual(SIDEBAR_HUBSPOT_TOOLS.map(tool => tool.label), ['Inbox', 'Contract Agents', 'Help Desk', 'Tickets']);
  assert.deepEqual(resolveWorkspaceRoute('#recruits'), { view: 'recruits' });
  // Tasks and the full Follow Up list were removed; saved links still open Recruits.
  for (const hash of ['#tasks', '#follow-up']) assert.deepEqual(resolveWorkspaceRoute(hash), { view: 'today' });
});

test('each stage page includes only its exact HubSpot stage ID', () => {
  const records = STAGE_PAGES.map((page, index) => ({ id: String(index), stageId: page.stageId, stage: page.label }));
  const unknown = { id: 'unknown', stageId: 'not-a-current-stage', stage: 'Recruits' };
  const all = [...records, unknown];
  for (let index = 0; index < STAGE_PAGES.length; index++) {
    const page = STAGE_PAGES[index];
    assert.deepEqual(recordsForStagePage(all, page.id), [records[index]]);
    assert.equal(stagePageForRecord(records[index]).stageId, page.stageId);
  }
  assert.deepEqual(recordsForStagePage(all, 'today'), []);
  assert.deepEqual(recordsForStagePage(all, 'add-recruit'), []);
  assert.deepEqual(unmappedStageRecords(all), [unknown]);
  assert.equal(stagePageForRecord(unknown), undefined);
});

test('shared early stages keep GenPop and Mass records in their selected path queues', () => {
  const stageId = STAGE_PAGES.find(page => page.id === 'phone-interview').stageId;
  const genpop = { id: 'g', stageId, recruitingPath: 'genpop' };
  const mass = { id: 'm', stageId, recruitingPath: 'mass_recruiting' };
  const legacy = { id: 'l', stageId, recruitingPath: '' };
  assert.deepEqual(recordsForStagePage([genpop, mass, legacy], 'genpop-phone-interview'), [genpop]);
  assert.deepEqual(recordsForStagePage([genpop, mass, legacy], 'mass-phone-interview'), [mass]);
  assert.deepEqual(recordsForStagePage([genpop, mass, legacy], 'phone-interview'), [genpop, mass, legacy]);
  assert.equal(stagePageForRecord(genpop).id, 'genpop-phone-interview');
  assert.equal(stagePageForRecord(mass).id, 'mass-phone-interview');
  assert.equal(stagePageForRecord(legacy).id, 'phone-interview');
});

test('Contracting branch queues use the explicit route and never infer a missing route', () => {
  const stageId = STAGE_PAGES.find(page => page.id === 'contracting').stageId;
  const licensed = { id: 'a', stageId, licenseRoute: 'licensed' };
  const notLicensed = { id: 'b', stageId, licenseRoute: 'not_licensed' };
  const legacy = { id: 'c', stageId, licenseRoute: '' };
  const records = [licensed, notLicensed, legacy];
  assert.deepEqual(recordsForStagePage(records, 'licensed-contracting'), [licensed]);
  assert.deepEqual(recordsForStagePage(records, 'unlicensed-contracting'), [notLicensed]);
  assert.deepEqual(recordsForStagePage(records, 'contracting'), records);
});

test('stage routes and shared record links remain addressable after removing old pages', () => {
  for (const page of WORKSPACE_NAV) assert.deepEqual(resolveWorkspaceRoute(`#${page.id}`), { view: page.id });
  assert.deepEqual(resolveWorkspaceRoute('#follow-up'), { view: 'today' });
  assert.deepEqual(resolveWorkspaceRoute('#add-recruit'), { view: 'add-recruits' });
  assert.deepEqual(resolveWorkspaceRoute('#recruit/123'), { view: 'today', id: '123' });
  for (const retired of ['orientation', 'licensing', 'transfers']) assert.deepEqual(resolveWorkspaceRoute(`#${retired}`), { view: 'today' });
  assert.deepEqual(resolveWorkspaceRoute('#unsupported'), { view: 'today' });
});

test('legacy Contacts route opens Contract Agents', () => { assert.deepEqual(resolveWorkspaceRoute('#contacts'), { view: 'contract-agents' }); assert.match(HUBSPOT_TOOLS.find(tool => tool.id === 'contract-agents').href, /objects\/2-64481801$/); });
