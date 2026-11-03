import test from 'node:test';
import assert from 'node:assert/strict';
import { hubspotHref, openTaskChips } from '../app/recruit-task-chips.mjs';
// 10:30pm Eastern on Nov 2, 2026, already Nov 3 in UTC.
const now = Date.parse('2026-11-03T03:30:00Z');
const url = id => `https://app.hubspot.com/contacts/50894788/record/0-27/${id}`;
test('task chips list open tasks soonest due first, overdue leading and undated last', () => {
 const records = [
  {id:'1',title:'Call Ana',status:'Not Started',scheduledAt:'2026-11-02T15:00:00Z',hubspotUrl:url(1)},
  {id:'2',title:'Send forms',status:'In Progress',scheduledAt:'2026-10-30T14:00:00Z',hubspotUrl:url(2)},
  {id:'3',title:'',status:'Waiting',scheduledAt:'2026-11-05T14:00:00Z'},
  {id:'4',title:'Done already',status:'Completed',scheduledAt:'2026-10-01T14:00:00Z'},
  {id:'6',title:'Bad date',status:'Deferred',scheduledAt:'bad'},
  {id:'5',title:'Someday',status:'Not Started',scheduledAt:null},
  {id:'7',title:'Confirm NPN',status:'Not Started',scheduledAt:'2026-11-01T16:00:00Z'},
 ];
 const chips = openTaskChips(records, now);
 assert.deepEqual(chips.map(chip => chip.id), ['2','7','1','3','5','6']);
 assert.deepEqual(chips.map(chip => chip.badge), ['3d late','1d late','Today','Nov 5',undefined,undefined]);
 assert.deepEqual(chips.map(chip => chip.detail), ['3 days overdue, due Oct 30, 2026','1 day overdue, due Nov 1, 2026','due today','due Nov 5, 2026','no due date','no due date']);
 assert.equal(chips[3].name, 'Untitled task');
 assert.equal(chips[0].href, url(2));
 assert.equal(chips[0].external, true);
 assert.equal(chips[3].href, undefined);
});
test('task chips count days on the Eastern calendar and wait for a valid clock', () => {
 // 11am Eastern on Nov 2 is a day behind in UTC terms, but still due today in the office.
 assert.equal(openTaskChips([{id:'1',title:'Call',status:'Not Started',scheduledAt:'2026-11-02T15:00:00Z'}], now)[0].badge, 'Today');
 for (const clock of [0, NaN, Infinity]) assert.deepEqual(openTaskChips([{id:'1',title:'Call',status:'Not Started'}], clock), []);
});
test('task links open HubSpot only', () => {
 assert.equal(hubspotHref(url(9)), url(9));
 for (const value of ['https://app.hubspot.com.evil.example/x', 'javascript:alert(1)', 'http://app.hubspot.com/x', '#tasks', '', undefined, null]) assert.equal(hubspotHref(value), undefined);
});
