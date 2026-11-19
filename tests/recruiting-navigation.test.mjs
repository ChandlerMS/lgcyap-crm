import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STAGE_PAGES, STAGES, TERMINAL_STAGE_IDS } from '../lib/recruiting-config.mjs';
import {
  WORKSPACE_NAV, WORKSPACE_NAV_GROUPS, HUBSPOT_TOOLS, SIDEBAR_HUBSPOT_TOOLS, SIDEBAR_RECRUITING_PAGES, RECRUITS_PAGE_TOOLS, QUEUE_PAGES, resolveWorkspaceRoute, stagePageForRecord,
  recordsForStagePage, unmappedStageRecords, sidebarViewFor, RECRUITS_SITE_LINKS,
} from '../app/recruiting-navigation.mjs';

test('QR Code Presentation is first in the Recruits flyout and opens an embedded workspace route', () => {
  assert.deepEqual(RECRUITS_SITE_LINKS.map(link => [link.label, link.href, link.embedded]), [
    ['QR Code Presentation', '#qr-code-presentation', true],
    ['Sign-In', 'https://signin.lgcyap.com/', false],
  ]);
  assert.deepEqual(resolveWorkspaceRoute('#qr-code-presentation'), { view: 'qr-code-presentation' });
  assert.equal(sidebarViewFor('qr-code-presentation'), 'recruits');
});

test('canonical stages are shared while each entry path has its own sidebar order', () => {
  assert.deepEqual(WORKSPACE_NAV.slice(0, 2).map(page => page.label), ['Dashboard', 'Add Recruits']);
  assert.deepEqual(WORKSPACE_NAV_GROUPS.find(group => group.id === 'genpop').items.map(page => page.label), ['Hiring Event', 'Application', 'Phone Interview']);
  assert.deepEqual(WORKSPACE_NAV_GROUPS.find(group => group.id === 'mass-recruiting').items.map(page => page.label), ['Application', 'Phone Interview', 'Hiring Event']);
  assert.equal(new Set(STAGE_PAGES.map(page => page.id)).size, 11);
  assert.equal(new Set(STAGE_PAGES.map(page => page.stageId)).size, 11);
  assert.equal(new Set(WORKSPACE_NAV.map(page => page.id)).size, WORKSPACE_NAV.length);
  for (const page of STAGE_PAGES) assert.equal(STAGES[page.stageId], page.label);
  assert.deepEqual(TERMINAL_STAGE_IDS, ['1416243218', '1493400173', '1473318773']);
  assert.equal(STAGE_PAGES.find(page => page.id === 'completed').stageId, '1416243218');
});

test('Dashboard heads the sidebar alone and Add Recruits opens from a dashboard button', () => {
  assert.deepEqual(SIDEBAR_RECRUITING_PAGES.map(page => [page.label, page.id, page.icon]), [['Dashboard', 'today', 'funnel']]);
  assert.deepEqual(resolveWorkspaceRoute('#today'), { view: 'today' });
  assert.deepEqual(resolveWorkspaceRoute('#add-recruits'), { view: 'add-recruits' });
  // Pages reached from another page light up that page's sidebar link.
  assert.equal(sidebarViewFor('add-recruits'), 'today');
  assert.equal(sidebarViewFor('event-attendance'), 'recruits');
  assert.equal(sidebarViewFor('call-analytics'), 'leaderboard');
  assert.equal(sidebarViewFor('inbox'), 'inbox');
  const workspace = readFileSync('app/recruiting-workspace.tsx', 'utf8');
  // The dashboard is a direct link, not a row that only opens and closes.
  assert.match(workspace, /SIDEBAR_RECRUITING_PAGES\.map\(navigationLink\)/);
  assert.doesNotMatch(workspace, /nav-recruits|recruit-pages/);
  // Sidebar order: Dashboard, Leaderboard, Queues, then the HubSpot tools.
  const nav = workspace.slice(workspace.indexOf('const navigation = <>'), workspace.indexOf('const leaderboardSwitch'));
  const order = ['SIDEBAR_RECRUITING_PAGES.map(navigationLink)', '<span>Leaderboard</span>', '<span>Queues</span>', 'SIDEBAR_HUBSPOT_TOOLS.map'].map(token => nav.indexOf(token));
  assert.ok(order.every(index => index >= 0), 'every sidebar entry is present');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // Add Recruits, Call Analytics and Event Attendance open from their pages, not the sidebar.
  assert.doesNotMatch(nav, /add-recruits|WORKSPACE_EXTRA_PAGES\.map|event-attendance|Event Attendance/);
  // Add Recruits is a button on the dashboard, followed by Recruits and Agents (Contract Agents).
  const actions = workspace.slice(workspace.indexOf('actions={<div className="dashboard-actions">'), workspace.indexOf('</div>}', workspace.indexOf('actions={<div className="dashboard-actions">')));
  const links = ['href="#add-recruits"', 'href="#recruits"', 'href="#contract-agents"'].map(token => actions.indexOf(token));
  assert.ok(links.every(index => index > 0), 'Add Recruits, Recruits and Agents are all present');
  assert.deepEqual([...links].sort((a, b) => a - b), links);
  assert.match(actions, /<a className="btn btn-primary add-recruits-button" href="#add-recruits">/);
  assert.match(actions, />Recruits<\/a>/);
  assert.match(actions, />Agents<\/a>/);
  assert.deepEqual(resolveWorkspaceRoute('#recruits'), { view: 'recruits' });
  assert.deepEqual(resolveWorkspaceRoute('#contract-agents'), { view: 'contract-agents' });
});

test('Queues opens the unified site while saved source routes remain available', () => {
  assert.deepEqual(QUEUE_PAGES.map(page => [page.label, page.id, page.source]), [['Shopper', 'queue', 'shopper'], ['Standard vs Preferred', 'ringcx', 'svp']]);
  for (const page of QUEUE_PAGES) assert.deepEqual(resolveWorkspaceRoute(`#${page.id}`), { view: page.id });
  const workspace = readFileSync('app/recruiting-workspace.tsx', 'utf8');
  assert.match(workspace, /src="https:\/\/queue\.lgcyap\.com\/embed"/);
  const queue = readFileSync('app/queue/page.tsx', 'utf8');
  assert.match(queue, /if \(source === "shopper"\) return <QueueBoard embedded=\{embedded\} \/>;/);
  assert.match(queue, /if \(source === "svp"\) return <RingCxDashboard \/>;/);
  // Without a source, the page (and queue.lgcyap.com) still shows both together.
  assert.match(queue, /return <UnifiedQueue embedded=\{embedded\} \/>;/);
});

test('the dashboard runs header, pipeline, cards, Event Attendance, then stacked collapsible panels, and the Event Attendance page link still works', () => {
  const workspace = readFileSync('app/recruiting-workspace.tsx', 'utf8');
  const today = workspace.slice(workspace.indexOf('if (route.view === "today")'));
  const order = ['<RecruitingPeriodControls', '<RecruitPipeline', '<RecruitTaskChips', '<RecruitEmailSummary', '<EventAttendanceBoard section',
    '<DashboardSection id="recruits"', '<DashboardSection id="calls"', '<DashboardSection id="tasks"', '<DashboardSection id="follow-up"', '<DashboardSection id="meetings"', '<DashboardSection id="calendar"'];
  const at = order.map(marker => today.indexOf(marker));
  assert.ok(at.every(index => index >= 0), `every dashboard part is present: ${order.filter((_, index) => at[index] < 0).join(', ')}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the dashboard parts run in the requested order');
  assert.match(today, /<DashboardSection id="event-attendance" label="Event Attendance"/);
  assert.match(today, /<CollapsibleCards><div className="today-summaries">/);
  assert.deepEqual(resolveWorkspaceRoute('#event-attendance'), { view: 'event-attendance' });
});

test('the dashboard Calendar shows every meeting in its day, without pointing at a week', () => {
  const workspace = readFileSync('app/recruiting-workspace.tsx', 'utf8');
  assert.match(workspace, /id === "calendar" \? \{ headerAction: meetingAction\(id, "button"\) \}/);
  const styles = readFileSync('app/globals.css', 'utf8');
  assert.match(styles, /\.today-overview \{ grid-template-columns: minmax\(0, 1fr\); gap: 44px; \}\s*\.today-overview > \.dashboard-section/);
});

test('Leaderboard and Call Analytics switch with a toggle at the top of both pages', () => {
  const workspace = readFileSync('app/recruiting-workspace.tsx', 'utf8');
  assert.match(workspace, /if \(callAnalyticsView\) return <>\{dashboardLink\}<LeadData navigation=\{leaderboardSwitch\} /);
  assert.match(workspace, /if \(leaderboardView\) return <>\{dashboardLink\}<Leaderboard navigation=\{leaderboardSwitch\} /);
});

test('native HubSpot tools use the verified portal and exact requested order', () => {
  assert.deepEqual(HUBSPOT_TOOLS.map(tool => tool.label), ['Sales', 'Inbox', 'Calls', 'Recruits', 'Contract Agents', 'Carrier Appointments', 'Carriers', 'Help Desk', 'Tickets']);
  for (const tool of HUBSPOT_TOOLS) {
    assert.deepEqual(resolveWorkspaceRoute(`#${tool.id}`), { view: tool.id });
    assert.equal(new URL(tool.href).origin, 'https://app.hubspot.com');
    assert.match(new URL(tool.href).pathname, /(?:^|\/)50894788(?:\/|$)/);
  }
});

test('Meetings, Calendar and Calls are panels on the dashboard, and each also has a page of its own', () => {
  assert.deepEqual(RECRUITS_PAGE_TOOLS.map(tool => tool.label), ['Meetings', 'Calendar', 'Calls']);
  // Meetings and Calendar open from their dashboard summaries and panel titles, like Tasks; the sidebar keeps Dashboard selected.
  for (const tool of RECRUITS_PAGE_TOOLS.filter(item => item.id !== 'calls')) {
    assert.equal(HUBSPOT_TOOLS.some(item => item.id === tool.id), false);
    assert.deepEqual(resolveWorkspaceRoute(`#${tool.id}`), { view: tool.id });
    assert.equal(sidebarViewFor(tool.id), 'today');
  }
  assert.deepEqual(resolveWorkspaceRoute('#calls'), { view: 'calls' });
  // Calls and Recruits open from their panel titles; their pages stay but leave the sidebar.
  assert.deepEqual(SIDEBAR_HUBSPOT_TOOLS.map(tool => tool.label), ['Recruits', 'Contract Agents']);
  assert.deepEqual(resolveWorkspaceRoute('#recruits'), { view: 'recruits' });
  // Tasks and Follow up open their own pages from the dashboard; the sidebar keeps Dashboard selected.
  for (const view of ['tasks', 'follow-up']) {
    assert.deepEqual(resolveWorkspaceRoute(`#${view}`), { view });
    assert.equal(sidebarViewFor(view), 'today');
  }
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
  assert.deepEqual(resolveWorkspaceRoute('#follow-up'), { view: 'follow-up' });
  assert.deepEqual(resolveWorkspaceRoute('#add-recruit'), { view: 'add-recruits' });
  assert.deepEqual(resolveWorkspaceRoute('#recruit/123'), { view: 'today', id: '123' });
  for (const retired of ['orientation', 'licensing', 'transfers']) assert.deepEqual(resolveWorkspaceRoute(`#${retired}`), { view: 'today' });
  assert.deepEqual(resolveWorkspaceRoute('#unsupported'), { view: 'today' });
});

test('legacy Contacts route opens Contract Agents', () => { assert.deepEqual(resolveWorkspaceRoute('#contacts'), { view: 'contract-agents' }); assert.match(HUBSPOT_TOOLS.find(tool => tool.id === 'contract-agents').href, /objects\/2-64481801$/); });

test('Inbox message search destinations resolve to their exact conversation without changing saved area links', () => {
  assert.deepEqual(resolveWorkspaceRoute('#inbox/thread/12345'), { view: 'inbox', id: '12345' });
  assert.deepEqual(resolveWorkspaceRoute('#inbox'), { view: 'inbox' });
  assert.deepEqual(resolveWorkspaceRoute('#help-desk'), { view: 'help-desk' });
  assert.deepEqual(resolveWorkspaceRoute('#tickets'), { view: 'tickets' });
  assert.deepEqual(resolveWorkspaceRoute('#inbox/thread/../12345'), { view: 'today' });
});


test('Recruits path pages include every matching stage without mixing paths or inferring missing paths', () => {
  const records = [
    {id:'1',recruitingPath:'genpop',stageId:'1473318768'},
    {id:'2',recruitingPath:'mass_recruiting',stageId:'1473318769'},
    {id:'3',recruitingPath:'genpop',stageId:'1416243218'},
    {id:'4',recruitingPath:'mass_recruiting',stageId:'1473318773'},
    {id:'5',recruitingPath:'genpop',stageId:'unknown'},
    {id:'6',recruitingPath:''},
  ];
  assert.deepEqual(recordsForStagePage(records,'referrals').map(r=>r.id),['1','3','5']);
  assert.deepEqual(recordsForStagePage(records,'recruiters').map(r=>r.id),['2','4']);
  for(const view of ['referrals','recruiters','event-attendance','applications']) {
    assert.deepEqual(resolveWorkspaceRoute('#'+view),{view});
    assert.equal(sidebarViewFor(view),'recruits');
  }
});


test('HubSpot Calls panels can open the matching Standard source without changing the sidebar default', () => {
  assert.deepEqual(resolveWorkspaceRoute('#calls/standard'),{view:'calls',source:'standard'});
  assert.deepEqual(resolveWorkspaceRoute('#calls/shopper'),{view:'calls',source:'shopper'});
  assert.deepEqual(resolveWorkspaceRoute('#calls/shopper-dispositions'),{view:'calls',source:'shopper-dispositions'});
  assert.deepEqual(resolveWorkspaceRoute('#calls/standard-dispositions'),{view:'calls',source:'standard-dispositions'});
  assert.deepEqual(resolveWorkspaceRoute('#calls'),{view:'calls'});
});

test('Training Classes is a Recruits flyout destination with its own route', async () => {
  const { RECRUITS_CHILD_PAGES } = await import('../app/recruiting-navigation.mjs');
  assert.ok(RECRUITS_CHILD_PAGES.some(page => page.id === 'training-classes' && page.label === 'Training Classes'));
  assert.deepEqual(resolveWorkspaceRoute('#training-classes'), { view: 'training-classes' });
  assert.equal(sidebarViewFor('training-classes'), 'recruits');
});

test('dashboard places Recruits and Calls immediately after Event Attendance before Tasks', async () => {
  const { DASHBOARD_COMMUNICATION_TOOLS } = await import('../app/recruiting-navigation.mjs');
  assert.deepEqual(DASHBOARD_COMMUNICATION_TOOLS.map(tool => tool.id), ['inbox', 'help-desk', 'tickets']);
  const workspace = readFileSync(new URL('../app/recruiting-workspace.tsx', import.meta.url), 'utf8');
  const order = ['event-attendance', 'recruits', 'calls', 'tasks', 'follow-up', 'meetings', 'calendar', 'email', 'inbox', 'help-desk', 'tickets'];
  const positions = order.map(id => workspace.indexOf(`<DashboardSection id="${id}"`));
  assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
});

test('Email has its own dashboard-linked page and keeps Dashboard selected', () => {
  assert.deepEqual(resolveWorkspaceRoute('#email'), { view: 'email' });
  assert.equal(sidebarViewFor('email'), 'today');
});

test('WhatsApp Sales is a third top-level leaderboard view under the existing sidebar area', async () => {
  const { WORKSPACE_EXTRA_PAGES } = await import('../app/recruiting-navigation.mjs');
  assert.deepEqual(WORKSPACE_EXTRA_PAGES.map(page => page.label), ['Leaderboard', 'Call Analytics', 'WhatsApp Sales']);
  assert.deepEqual(resolveWorkspaceRoute('#whatsapp-sales'), { view: 'whatsapp-sales' });
  assert.equal(sidebarViewFor('whatsapp-sales'), 'leaderboard');
});
