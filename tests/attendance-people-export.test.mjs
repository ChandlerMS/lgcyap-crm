import test from 'node:test';
import assert from 'node:assert/strict';
import readXlsx from 'read-excel-file/node';
import { attendancePeopleCsv, attendancePeopleWorkbook } from '../lib/attendance-people-download.mjs';

test('attendance downloads include exactly the supplied filtered people and preserve sign-in details', async () => {
  const rows = [{ name: '=Example', phone: '+15551234567', email: 'qa@example.test', office: 'miami', ticketId: '101', stage: 'Hiring Event', signIns: 2, firstDay: '2026-11-01', lastDay: '2026-11-19', appliedAt: null, hubspotUrl: 'https://app.hubspot.com/contacts/50894788/record/0-5/101' }];
  const csv = attendancePeopleCsv(rows);
  assert.match(csv, /Sign-ins/);
  assert.match(csv, /2026-11-19/);
  assert.match(csv, /'=Example/);
  assert.match(csv, /'\+15551234567/);
  const [{ data }] = await readXlsx(Buffer.from(attendancePeopleWorkbook(rows)));
  assert.equal(data.length, 2);
  assert.equal(data[1][0], '=Example');
  assert.equal(data[1][1], '+15551234567');
  assert.equal(data[1][3], 'Miami');
  assert.equal(data[1][data[0].indexOf('Sign-ins')], '2');
});
