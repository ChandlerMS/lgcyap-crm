import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_HEADERS, REVIEW_HEADERS, readRecruitRecords, recordCells, reviewCells } from '../lib/recruit-sheet-record.mjs';
import { buildSignInWorkbooks } from '../lib/sign-in-sheets-layout.mjs';
import { buildApplicationWorkbooks } from '../lib/application-sheets-layout.mjs';

const hubspot = (results, extra = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return Response.json({ status: 'COMPLETE', results, ...extra }); };
  return { fetchImpl, calls };
};
const cell = (row, header) => row[RECORD_HEADERS.indexOf(header)];

test('record cells show every CRM-editable field as its label, plus email, phone, recruiter and dates', () => {
  const row = recordCells({ ownerName: 'Synthetic Recruiter', properties: { recruit_name: 'Synthetic Recruit', orientation_office: 'orlando', recruiting_path: 'genpop', intake_license_status: 'unlicensed', orientation_registered: 'true', licensing_started: 'false', orientation_date: '2026-11-21', recruit_email: 'recruit@example.invalid', recruit_phone_number: '555-0100', hubspot_owner_id: '12', hs_lastmodifieddate: '2026-11-19T14:00:00Z' } });
  assert.equal(row.length, RECORD_HEADERS.length);
  assert.ok(RECORD_HEADERS.every(header => header.startsWith('CRM: ')));
  assert.ok(!RECORD_HEADERS.includes('CRM: Stage'), 'stage already has its own column');
  assert.equal(cell(row, 'CRM: Recruit name'), 'Synthetic Recruit');
  assert.equal(cell(row, 'CRM: Office'), 'Orlando');
  assert.equal(cell(row, 'CRM: Recruiting path'), 'Referrals');
  assert.equal(cell(row, 'CRM: License status at intake'), 'Unlicensed');
  assert.equal(cell(row, 'CRM: Registered for orientation'), 'Yes');
  assert.equal(cell(row, 'CRM: Licensing started'), 'No');
  assert.equal(cell(row, 'CRM: Orientation date'), '2026-11-21');
  assert.equal(cell(row, 'CRM: Email'), 'recruit@example.invalid');
  assert.equal(cell(row, 'CRM: Phone'), '555-0100');
  assert.equal(cell(row, 'CRM: Recruiter'), 'Synthetic Recruiter');
  assert.match(cell(row, 'CRM: Last updated'), /11\/19\/2026, 09:00 AM EST/);
  assert.deepEqual(recordCells(null), RECORD_HEADERS.map(() => ''));
  assert.equal(cell(recordCells({ properties: { hubspot_owner_id: '12' } }), 'CRM: Recruiter'), 'Owner 12');
  assert.deepEqual(reviewCells(null), ['Not reviewed', '']);
  assert.equal(reviewCells({ status: 'denied', reviewedAt: '2026-11-19T14:00:00.000Z' })[0], 'Denied');
});

test('record reads ask for every editable property and refuse incomplete batches', async () => {
  const ok = hubspot([{ id: '7', properties: { recruit_name: 'A', hubspot_owner_id: '12' } }, { id: '8', archived: true, properties: {} }]);
  const records = await readRecruitRecords(['7', '8', '7', null], { accessToken: 'synthetic', fetchImpl: ok.fetchImpl, readOwners: async () => ({ names: new Map([['12', 'Synthetic Recruiter']]) }) });
  assert.equal(records['7'].ownerName, 'Synthetic Recruiter');
  assert.equal(records['8'], null);
  assert.deepEqual(ok.calls[0].body.inputs, [{ id: '7' }, { id: '8' }]);
  for (const property of ['recruit_name', 'orientation_office', 'appointments_created', 'recruit_email', 'hs_lastmodifieddate']) assert.ok(ok.calls[0].body.properties.includes(property), property);
  await assert.rejects(readRecruitRecords(['7', '8'], { accessToken: 'synthetic', fetchImpl: hubspot([{ id: '7', properties: {} }]).fetchImpl }), /incomplete/);
  await assert.rejects(readRecruitRecords(['7'], { accessToken: 'synthetic', fetchImpl: hubspot([{ id: '7', properties: {} }], { numErrors: 1 }).fetchImpl }), /incomplete/);
  await assert.rejects(readRecruitRecords(['7'], { accessToken: 'synthetic', fetchImpl: async () => new Response('{}', { status: 429 }) }), /limiting/);
  assert.deepEqual(await readRecruitRecords([], { accessToken: 'synthetic', fetchImpl: () => { throw new Error('No read needed'); } }), {});
});

test('both monthly layouts carry the review decision and the current CRM fields', () => {
  const now = new Date('2026-11-19T16:00:00Z');
  const records = { 77: { properties: { orientation_office: 'tampa', recruit_type: 'referral_transfer' } } };
  const reviews = { 77: { status: 'approved', reviewedAt: '2026-11-19T15:00:00.000Z' } };
  const [signIns] = buildSignInWorkbooks({ partial: false, visits: [{ noteId: '5', ticketId: '77', at: '2026-11-19T14:00:00Z', name: 'Synthetic', office: 'orlando', stage: 'Hiring Event' }], attendees: [], reviews, records }, now);
  const [header, row] = signIns.tabs.find(tab => tab.values.length > 1).values;
  assert.equal(signIns.title, '11-26 Recruits');
  for (const name of [...REVIEW_HEADERS, ...RECORD_HEADERS]) assert.ok(header.includes(name), name);
  assert.equal(row[header.indexOf('Review decision')], 'Approved');
  assert.equal(row[header.indexOf('Office')], 'Orlando', 'the sign-in answer stays as given');
  assert.equal(row[header.indexOf('CRM: Office')], 'Tampa', 'the record shows the current value');
  assert.equal(row[header.indexOf('CRM: Recruit type')], 'Referral Transfer');
  const [applications] = buildApplicationWorkbooks({ partial: false, applications: [{ id: '9', at: '2026-11-19T14:00:00Z', name: 'Synthetic', sections: [{ title: 'About', rows: [{ label: 'Question', value: 'Answer' }] }], ticket: { id: '77', stage: 'Application' } }], reviews, records }, now);
  const [appHeader, appRow] = applications.tabs.find(tab => tab.values.length > 1).values;
  assert.equal(appRow[appHeader.indexOf('Review decision')], 'Approved');
  assert.equal(appRow[appHeader.indexOf('CRM: Office')], 'Tampa');
  assert.ok(appHeader.indexOf('CRM: Last updated') < appHeader.indexOf('About — Question'), 'question columns stay last');
});

test('a failed review read stops the sync before any record read or write', async () => {
  const { withRecords } = await import('../lib/monthly-sheets-sync.mjs');
  const never = () => { throw new Error('No record read'); };
  await assert.rejects(withRecords({ partial: false, applications: [], reviewNotice: 'Review statuses could not refresh.' }, ['7'], { accessToken: 'synthetic', fetchImpl: never }), /Review decisions/);
  const ok = hubspot([{ id: '7', properties: { recruit_name: 'A' } }]);
  const report = await withRecords({ partial: false, applications: [], reviews: {} }, ['7', undefined], { accessToken: 'synthetic', fetchImpl: ok.fetchImpl });
  assert.equal(report.records['7'].properties.recruit_name, 'A');
});
