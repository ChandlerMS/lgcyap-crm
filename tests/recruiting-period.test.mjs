import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recruitingCalendarDate, defaultPeriodSelection, resolveRecruitingPeriod,
  recordsInRecruitingPeriod, recruitingPeriodStats,
} from '../app/recruiting-period.mjs';

const resolve = (preset, now, dates = {}) => resolveRecruitingPeriod({ preset, ...dates }, now);
const bounds = period => [period.startDate, period.endDate];

test('contacted KPIs use unique created-cohort recruits with recorded contact dates', () => {
  const a = {id:'a',createdAt:'2026-10-30T12:00:00Z',lastContactedAt:'2026-10-30T13:00:00Z'};
  const rows = [a,a,{id:'b',createdAt:a.createdAt,lastContactedAt:null},{id:'c',createdAt:a.createdAt,lastContactedAt:'invalid'}, {id:'outside',createdAt:'2026-09-01T12:00:00Z',lastContactedAt:a.lastContactedAt}];
  const stats = recruitingPeriodStats(rows,[],resolve('today','2026-10-30T16:00:00Z'));
  assert.equal(stats.total,3); assert.equal(stats.contactedCount,1); assert.equal(stats.contactedPercentage,33.3);
  assert.equal(recruitingPeriodStats([],[],resolve('today','2026-10-30T16:00:00Z')).contactedPercentage,0);
});

test('Today follows Eastern agency time even when UTC is on the next day', () => {
  assert.equal(recruitingCalendarDate('2026-10-31T03:59:59.999Z'), '2026-10-30');
  assert.equal(recruitingCalendarDate('2026-10-31T04:00:00.000Z'), '2026-10-31');
  assert.deepEqual(defaultPeriodSelection('2026-10-31T03:00:00Z'), { preset: 'today', startDate: '2026-10-30', endDate: '2026-10-30' });
});

test('weekly reporting is Monday through Sunday across a year boundary', () => {
  assert.deepEqual(bounds(resolve('weekly', '2027-01-01T15:00:00Z')), ['2026-12-28', '2027-01-03']);
  assert.deepEqual(bounds(resolve('weekly', '2027-01-03T15:00:00Z')), ['2026-12-28', '2027-01-03']);
  assert.deepEqual(bounds(resolve('weekly', '2027-01-04T15:00:00Z')), ['2027-01-04', '2027-01-10']);
});

test('monthly, quarterly, yearly bounds respect leap years and calendar quarters', () => {
  assert.deepEqual(bounds(resolve('monthly', '2028-02-10T15:00:00Z')), ['2028-02-01', '2028-02-29']);
  assert.deepEqual(bounds(resolve('monthly', '2027-02-10T15:00:00Z')), ['2027-02-01', '2027-02-28']);
  assert.deepEqual(bounds(resolve('quarterly', '2026-10-30T15:00:00Z')), ['2026-10-01', '2026-12-31']);
  assert.deepEqual(bounds(resolve('quarterly', '2028-03-31T15:00:00Z')), ['2028-01-01', '2028-03-31']);
  assert.deepEqual(bounds(resolve('yearly', '2028-12-31T15:00:00Z')), ['2028-01-01', '2028-12-31']);
});

test('specific date and range use inclusive calendar boundaries and reject invalid input', () => {
  const now = '2026-10-30T15:00:00Z';
  assert.deepEqual(bounds(resolve('date', now, { startDate: '2028-02-29' })), ['2028-02-29', '2028-02-29']);
  assert.deepEqual(bounds(resolve('range', now, { startDate: '2026-09-01', endDate: '2026-10-30' })), ['2026-09-01', '2026-10-30']);
  for (const startDate of ['', '2027-02-29', '2026-13-01', '2026-04-31', '10/30/2026', '0000-01-01']) {
    assert.equal(resolve('date', now, { startDate }).valid, false, startDate);
  }
  assert.equal(resolve('range', now, { startDate: '2026-10-30', endDate: '2026-10-29' }).valid, false);
  assert.equal(resolve('range', now, { startDate: '2026-10-30', endDate: '' }).valid, false);
  assert.equal(resolve('unknown', now).valid, false);
  assert.equal(resolve('today', 'not-a-date').valid, false);
});

test('created-date cohort excludes stage entries from unrelated creation periods', () => {
  const period = resolve('date', '2026-10-30T15:00:00Z', { startDate: '2026-10-30' });
  const records = [
    { id: 'a', createdAt: '2026-10-30T04:00:00Z', enteredStageAt: '2026-10-31T15:00:00Z' },
    { id: 'b', createdAt: '2026-10-31T03:59:59.999Z', enteredStageAt: '2026-10-30T15:00:00Z' },
    { id: 'c', createdAt: '2026-10-31T04:00:00Z', enteredStageAt: '2026-10-30T15:00:00Z' },
    { id: 'd', createdAt: null },
    { id: 'e', createdAt: 'invalid' },
  ];
  assert.deepEqual(recordsInRecruitingPeriod(records, period).map(record => record.id), ['a', 'b']);
  assert.deepEqual(recordsInRecruitingPeriod(records, period, 'enteredStageAt').map(record => record.id), ['b', 'c']);
  assert.throws(() => recordsInRecruitingPeriod(records, period, 'updatedAt'), /Unsupported/);
});

test('spring and fall DST transitions retain the entire agency calendar day', () => {
  const spring = resolve('date', '2026-03-08T15:00:00Z', { startDate: '2026-03-08' });
  const springRows = ['2026-03-08T04:59:59Z', '2026-03-08T05:00:00Z', '2026-03-09T03:59:59Z', '2026-03-09T04:00:00Z'].map((createdAt, index) => ({ id: String(index), createdAt }));
  assert.deepEqual(recordsInRecruitingPeriod(springRows, spring).map(record => record.id), ['1', '2']);
  const fall = resolve('date', '2026-11-01T15:00:00Z', { startDate: '2026-11-01' });
  const fallRows = ['2026-11-01T03:59:59Z', '2026-11-01T04:00:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2026-11-02T04:59:59Z', '2026-11-02T05:00:00Z'].map((createdAt, index) => ({ id: String(index), createdAt }));
  assert.deepEqual(recordsInRecruitingPeriod(fallRows, fall).map(record => record.id), ['1', '2', '3', '4']);
});

test('totals count each unique recruit in its current stage, retaining zeros and unknown honesty', () => {
  const stages = [{ id: 'offer', stageId: '1', label: 'Offer' }, { id: 'training', stageId: '2', label: 'Training' }, { id: 'completed', stageId: '3', label: 'Completed' }];
  const records = [
    { id: 'a', stageId: '1', createdAt: '2026-10-30T15:00:00Z' },
    { id: 'a', stageId: '2', createdAt: '2026-10-30T15:00:00Z' },
    { id: 'b', stageId: '2', createdAt: '2026-10-30T16:00:00Z' },
    { id: 'c', stageId: 'unknown', createdAt: '2026-10-30T16:00:00Z' },
    { id: 'd', stageId: '1', createdAt: null },
    { id: 'e', stageId: '1', createdAt: '2026-10-29T16:00:00Z' },
  ];
  const stats = recruitingPeriodStats(records, stages, resolve('today', '2026-10-30T15:00:00Z'));
  assert.equal(stats.total, 3);
  assert.deepEqual(stats.stageTotals.map(stage => stage.count), [0, 2, 0]);
  assert.equal(stats.unknownStageCount, 1);
  assert.equal(stats.missingDateCount, 1);
  assert.deepEqual(recordsInRecruitingPeriod(records, { valid: false }), []);
});
