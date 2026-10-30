import test from 'node:test';
import assert from 'node:assert/strict';
import { followUpRecruits } from '../app/recruit-follow-up.mjs';
const now = Date.parse('2026-10-30T12:00:00Z');
const ago = days => new Date(now - days * 86400000).toISOString();
test('follow-up is strictly over 15 days and uses creation only when never contacted', () => {
 const records = [
  {id:'boundary',lastContactedAt:ago(15)}, {id:'overdue',lastContactedAt:ago(15.01)},
  {id:'new',createdAt:ago(2)}, {id:'never',createdAt:ago(20)},
  {id:'recent',createdAt:ago(50),lastContactedAt:ago(1)},
  {id:'invalid',createdAt:ago(50),lastContactedAt:'bad'}, {id:'unknown'}, {id:'future',lastContactedAt:ago(-1)}
 ];
 const result = followUpRecruits(records, now);
 assert.deepEqual(result.map(r=>r.id), ['never','overdue']);
 assert.equal(result[0].neverContacted,true);
 assert.equal(result[1].neverContacted,false);
 assert.equal(records[0].daysWaiting,undefined);
});
test('follow-up deduplicates IDs and waits for a valid clock', () => {
 const record = {id:'a',createdAt:ago(30)};
 assert.equal(followUpRecruits([record,record],now).length,1);
 for(const clock of [0,NaN,Infinity]) assert.deepEqual(followUpRecruits([record],clock),[]);
});
