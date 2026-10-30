import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../lib/recruiting-flow.mjs';

const requireFlow = () => flow;
const state = (stageKey, recruitingPath = '', licenseRoute = '') => ({ stageKey, recruitingPath, licenseRoute });
const keys = choices => choices.map(choice => choice.stageKey);

test('new intake has two exact sources and starts at the source-specific entry', () => {
  const { RECRUITING_PATHS, LICENSE_ROUTES, FLOW_STAGES, entryStageKey } = requireFlow();
  assert.deepEqual(RECRUITING_PATHS, { genpop: 'GenPop', mass_recruiting: 'Mass Recruiting' });
  assert.deepEqual(LICENSE_ROUTES, { licensed: 'Licensed', not_licensed: 'Not Licensed' });
  assert.equal(entryStageKey('genpop'), 'hiring-event');
  assert.equal(entryStageKey('mass_recruiting'), 'application');
  for (const path of ['', null, undefined, 'mass', 'GenPop', '__proto__']) assert.equal(entryStageKey(path), null);
  assert.deepEqual(FLOW_STAGES.filter(stage => stage.terminal).map(stage => stage.key), ['completed', 'withdrawn']);
  assert.equal(FLOW_STAGES.find(stage => stage.key === 'licensed-npn').label, 'Licensed w/ NPN');
});

test('GenPop and Mass Recruiting follow different early orders through the same stages', () => {
  const { forwardStageChoices, backwardStageChoices, validateFlowTransition } = requireFlow();
  for (const [path, steps] of [
    ['genpop', ['hiring-event', 'application', 'phone-interview', 'offer']],
    ['mass_recruiting', ['application', 'phone-interview', 'hiring-event', 'offer']],
  ]) {
    for (let index = 0; index < steps.length - 1; index++) {
      const before = state(steps[index], path), after = state(steps[index + 1], path);
      assert.deepEqual(keys(forwardStageChoices(before)), [after.stageKey]);
      assert.ok(keys(backwardStageChoices(after)).includes(before.stageKey));
      assert.deepEqual(validateFlowTransition(before, after), { ok: true });
      assert.deepEqual(validateFlowTransition(after, before), { ok: true });
    }
  }
  assert.deepEqual(keys(backwardStageChoices(state('hiring-event', 'genpop'))), []);
  assert.deepEqual(keys(backwardStageChoices(state('application', 'mass_recruiting'))), []);
  assert.equal(validateFlowTransition(state('phone-interview', 'mass_recruiting'), state('offer', 'mass_recruiting')).ok, false);
  assert.equal(validateFlowTransition(state('hiring-event', 'genpop'), state('offer', 'genpop')).ok, false);
});

test('Offer choices explicitly select and persist the license route', () => {
  const { forwardStageChoices, validateFlowTransition } = requireFlow();
  const before = state('offer', 'genpop');
  assert.deepEqual(forwardStageChoices(before), [
    { stageKey: 'contracting', label: 'Contracting', licenseRoute: 'licensed' },
    { stageKey: 'licensing-reminders', label: 'Licensing Reminders', licenseRoute: 'not_licensed' },
  ]);
  assert.deepEqual(validateFlowTransition(before, state('contracting', 'genpop', 'licensed')), { ok: true });
  assert.deepEqual(validateFlowTransition(before, state('licensing-reminders', 'genpop', 'not_licensed')), { ok: true });
  assert.equal(validateFlowTransition(before, state('contracting', 'genpop')).code, 'LICENSE_ROUTE_REQUIRED');
  assert.equal(validateFlowTransition(before, state('licensing-reminders', 'genpop', 'licensed')).ok, false);
  assert.deepEqual(keys(forwardStageChoices(state('offer', 'mass_recruiting', 'licensed'))), ['contracting']);
  assert.deepEqual(keys(forwardStageChoices(state('offer', 'mass_recruiting', 'not_licensed'))), ['licensing-reminders']);
});

test('the unlicensed route has the normal forward chain and real backward candidates without an NPN value gate', () => {
  const { forwardStageChoices, backwardStageChoices, validateFlowTransition } = requireFlow();
  const steps = ['offer', 'licensing-reminders', 'licensed-npn', 'contracting'];
  for (let index = 0; index < steps.length - 1; index++) {
    const before = state(steps[index], 'mass_recruiting', 'not_licensed');
    const after = state(steps[index + 1], 'mass_recruiting', 'not_licensed');
    assert.deepEqual(keys(forwardStageChoices(before)), [after.stageKey]);
    assert.ok(keys(backwardStageChoices(after)).includes(before.stageKey));
    assert.deepEqual(validateFlowTransition(before, after), { ok: true });
    assert.deepEqual(validateFlowTransition(after, before), { ok: true });
  }
  assert.deepEqual(keys(forwardStageChoices({ ...state('licensed-npn', 'genpop', 'not_licensed'), npnNumber: '' })), ['contracting']);
  assert.equal(validateFlowTransition(state('licensing-reminders', 'genpop', 'not_licensed'), state('contracting', 'genpop', 'not_licensed')).ok, false);
  assert.deepEqual(forwardStageChoices(state('licensed-npn', 'genpop', 'licensed')), []);
});

test('merged stages work without guessing source or route, and both terminal outcomes retain backward moves', () => {
  const { forwardStageChoices, backwardStageChoices, validateFlowTransition } = requireFlow();
  assert.deepEqual(keys(forwardStageChoices(state('contracting'))), ['training']);
  assert.deepEqual(keys(forwardStageChoices(state('training'))), ['completed', 'withdrawn']);
  for (const terminal of ['completed', 'withdrawn']) {
    assert.deepEqual(forwardStageChoices(state(terminal)), []);
    assert.deepEqual(keys(backwardStageChoices(state(terminal))), ['training']);
    assert.deepEqual(validateFlowTransition(state('training'), state(terminal)), { ok: true });
    assert.deepEqual(validateFlowTransition(state(terminal), state('training')), { ok: true });
  }
  assert.deepEqual(validateFlowTransition(state('completed'), state('withdrawn')).ok, false);
  assert.deepEqual(validateFlowTransition(state('application', 'genpop'), state('withdrawn', 'genpop')).ok, false);
});

test('legacy blanks preserve common edges and expose explicit choices where history is ambiguous', () => {
  const { forwardStageChoices, backwardStageChoices, validateFlowTransition } = requireFlow();
  assert.deepEqual(forwardStageChoices(state('hiring-event')), []);
  assert.deepEqual(forwardStageChoices(state('phone-interview')), []);
  assert.deepEqual(backwardStageChoices(state('offer')), []);
  assert.deepEqual(keys(forwardStageChoices(state('application'))), ['phone-interview']);
  assert.deepEqual(keys(backwardStageChoices(state('phone-interview'))), ['application']);
  assert.deepEqual(backwardStageChoices(state('contracting')), [
    { stageKey: 'offer', label: 'Offer', licenseRoute: 'licensed' },
    { stageKey: 'licensed-npn', label: 'Licensed w/ NPN', licenseRoute: 'not_licensed' },
  ]);
  assert.equal(validateFlowTransition(state('contracting'), state('offer')).code, 'LICENSE_ROUTE_REQUIRED');
  assert.deepEqual(validateFlowTransition(state('contracting'), state('offer', '', 'licensed')), { ok: true });
  assert.equal(validateFlowTransition(state('phone-interview'), state('offer')).code, 'RECRUITING_PATH_REQUIRED');
  const before = state('licensing-reminders');
  assert.deepEqual(validateFlowTransition(before, state('licensed-npn')), { ok: true });
  assert.deepEqual(before, state('licensing-reminders'));
  assert.deepEqual(forwardStageChoices(before), [{ stageKey: 'licensed-npn', label: 'Licensed w/ NPN' }]);
});

test('explicit legacy classification is allowed but an assigned source cannot switch or clear', () => {
  const { validateFlowTransition } = requireFlow();
  const legacy = state('completed');
  assert.deepEqual(validateFlowTransition(legacy, state('completed', 'mass_recruiting')), { ok: true });
  assert.deepEqual(validateFlowTransition(state('phone-interview'), state('offer', 'genpop')), { ok: true });
  for (const path of ['', 'mass_recruiting']) {
    assert.equal(validateFlowTransition(state('completed', 'genpop'), state('completed', path)).code, 'RECRUITING_PATH_CHANGE_NOT_ALLOWED');
  }
  assert.equal(validateFlowTransition(state('contracting', 'genpop', 'licensed'), state('training', 'genpop')).code, 'LICENSE_ROUTE_REQUIRED');
  assert.deepEqual(validateFlowTransition(state('offer', 'genpop', 'licensed'), state('offer', 'genpop', 'not_licensed')), { ok: true });
  assert.equal(validateFlowTransition(state('contracting', 'genpop', 'licensed'), state('contracting', 'genpop', 'not_licensed')).code, 'LICENSE_ROUTE_CHANGE_NOT_ALLOWED');
  assert.equal(validateFlowTransition(state('contracting', 'genpop', 'licensed'), state('licensed-npn', 'genpop', 'not_licensed')).code, 'LICENSE_ROUTE_CHANGE_NOT_ALLOWED');
  assert.equal(validateFlowTransition(state('offer', 'genpop', 'licensed'), state('offer', 'genpop')).code, 'LICENSE_ROUTE_REQUIRED');
});

test('nonflow edits preserve unclassified and legacy stages; malformed changes fail closed', () => {
  const { forwardStageChoices, backwardStageChoices, validateFlowTransition } = requireFlow();
  for (const existing of [state('completed'), state('retired-orientation'), state('licensing-reminders', '', 'licensed')]) {
    assert.deepEqual(validateFlowTransition({ ...existing, note: 'before' }, { ...existing, note: 'after' }), { ok: true });
  }
  for (const changed of [state('offer', '__proto__'), state('offer', '', 'constructor'), state('unknown', 'genpop')]) {
    assert.equal(validateFlowTransition(state('application', 'genpop'), changed).ok, false);
  }
  assert.equal(validateFlowTransition(null, state('offer')).ok, false);
  assert.equal(validateFlowTransition(state('offer'), []).ok, false);
  for (const value of [null, undefined, [], state('unknown'), state('offer', 'mass')]) {
    assert.deepEqual(forwardStageChoices(value), []);
    assert.deepEqual(backwardStageChoices(value), []);
  }
});
