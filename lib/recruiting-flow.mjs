/** Semantic workflow only: CRM IDs, property names and presentation order live elsewhere. */
export const RECRUITING_PATHS = Object.freeze({ genpop: 'GenPop', mass_recruiting: 'Mass Recruiting' });
export const LICENSE_ROUTES = Object.freeze({ licensed: 'Licensed', not_licensed: 'Not Licensed' });
export const FLOW_STAGES = Object.freeze([
  { key: 'hiring-event', label: 'Hiring Event' },
  { key: 'application', label: 'Application' },
  { key: 'phone-interview', label: 'Phone Interview' },
  { key: 'offer', label: 'Offer' },
  { key: 'licensing-reminders', label: 'Licensing Reminders' },
  { key: 'licensed-npn', label: 'Licensed w/ NPN' },
  { key: 'contracting', label: 'Contracting' },
  { key: 'training', label: 'Training' },
  { key: 'completed', label: 'Completed', terminal: true },
  { key: 'withdrawn', label: 'Withdrawn', terminal: true },
].map(stage => Object.freeze(stage)));

const labels = new Map(FLOW_STAGES.map(stage => [stage.key, stage.label]));
const pathEdges = Object.freeze({
  genpop: [['hiring-event', 'application'], ['application', 'phone-interview'], ['phone-interview', 'offer']],
  mass_recruiting: [['application', 'phone-interview'], ['phone-interview', 'hiring-event'], ['hiring-event', 'offer']],
});
const commonEdges = [
  ['offer', 'contracting', 'licensed'],
  ['offer', 'licensing-reminders', 'not_licensed'],
  ['licensing-reminders', 'licensed-npn', 'not_licensed'],
  ['licensed-npn', 'contracting', 'not_licensed'],
  ['contracting', 'training'],
  ['training', 'completed'],
  ['training', 'withdrawn'],
];
const licensingStages = new Set(['licensing-reminders', 'licensed-npn']);
const knownOrBlank = (value, options) => value === '' || (typeof value === 'string' && Object.hasOwn(options, value));

function snapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.stageKey !== 'string' || !value.stageKey) return null;
  return { stageKey: value.stageKey, recruitingPath: value.recruitingPath ?? '', licenseRoute: value.licenseRoute ?? '' };
}

export function entryStageKey(path) {
  if (typeof path !== 'string' || !Object.hasOwn(RECRUITING_PATHS, path)) return null;
  return path === 'genpop' ? 'hiring-event' : 'application';
}

function candidates(value, direction) {
  const current = snapshot(value);
  if (!current || !labels.has(current.stageKey) || !knownOrBlank(current.recruitingPath, RECRUITING_PATHS)
    || !knownOrBlank(current.licenseRoute, LICENSE_ROUTES)
    || (licensingStages.has(current.stageKey) && current.licenseRoute === 'licensed')) return [];
  const from = direction === 'forward' ? 0 : 1, to = direction === 'forward' ? 1 : 0;
  let early;
  if (current.recruitingPath) early = pathEdges[current.recruitingPath].filter(edge => edge[from] === current.stageKey);
  else {
    // Only edges shared by BOTH sources are safe without classifying legacy history.
    early = pathEdges.genpop.filter(edge => edge[from] === current.stageKey
      && pathEdges.mass_recruiting.some(other => other[0] === edge[0] && other[1] === edge[1]));
  }
  const shared = commonEdges.filter(edge => edge[from] === current.stageKey
    && (!edge[2] || !current.licenseRoute || edge[2] === current.licenseRoute));
  return [...early, ...shared].map(edge => {
    const choice = { stageKey: edge[to], label: labels.get(edge[to]) };
    // These junctions require an explicit choice; no first candidate is implied.
    if (edge[2] && ((direction === 'forward' && current.stageKey === 'offer')
      || (direction === 'backward' && current.stageKey === 'contracting'))) choice.licenseRoute = edge[2];
    return choice;
  });
}

/** Returns possible deliberate next moves. Licensed w/ NPN is staff-confirmed; no value/evidence gate is inferred. */
export function forwardStageChoices(state) { return candidates(state, 'forward'); }

/** Terminal outcomes retain their real backward edge; ambiguous predecessors remain separate choices. */
export function backwardStageChoices(state) { return candidates(state, 'backward'); }

const denied = (code, message) => ({ ok: false, code, message });

/**
 * Validate FULL before/after semantic snapshots after merging an explicit edit into a fresh server read.
 * This does not mutate, classify, choose a branch, or convert a CRM stage ID into a semantic key.
 * Missing/null metadata represents a legacy blank; unrelated edits preserve those blanks and retired stages.
 */
export function validateFlowTransition(before, after) {
  const prior = snapshot(before), next = snapshot(after);
  if (!prior || !next) return denied('INVALID_FLOW_STATE', 'Refresh this recruit before changing its workflow.');
  if (prior.stageKey === next.stageKey && prior.recruitingPath === next.recruitingPath
    && prior.licenseRoute === next.licenseRoute) return { ok: true };
  if (!knownOrBlank(next.recruitingPath, RECRUITING_PATHS)) {
    return denied('INVALID_RECRUITING_PATH', 'Choose GenPop or Mass Recruiting.');
  }
  if (prior.recruitingPath && prior.recruitingPath !== next.recruitingPath) {
    return denied('RECRUITING_PATH_CHANGE_NOT_ALLOWED', 'An assigned recruiting path cannot be changed or cleared.');
  }
  if (!knownOrBlank(next.licenseRoute, LICENSE_ROUTES)) {
    return denied('INVALID_LICENSE_ROUTE', 'Choose Licensed or Not Licensed.');
  }
  if (prior.licenseRoute && !next.licenseRoute) {
    return denied('LICENSE_ROUTE_REQUIRED', 'Keep the recorded license route or review it at Offer.');
  }
  if (prior.licenseRoute && prior.licenseRoute !== next.licenseRoute && prior.stageKey !== 'offer') {
    return denied('LICENSE_ROUTE_CHANGE_NOT_ALLOWED', 'Return to Offer before changing the recorded license route.');
  }
  if (licensingStages.has(next.stageKey) && next.licenseRoute === 'licensed') {
    return denied('LICENSE_ROUTE_CONFLICT', 'The licensing stages belong to the Not Licensed route.');
  }
  if (prior.stageKey === next.stageKey) return { ok: true };
  if (!labels.has(prior.stageKey) || !labels.has(next.stageKey)) {
    return denied('INVALID_FLOW_STAGE', 'Review this legacy or unrecognized stage before moving the recruit.');
  }
  // A same-edit classification or Offer decision is explicit, so use the proposed metadata for routing.
  const context = { ...prior, recruitingPath: next.recruitingPath, licenseRoute: next.licenseRoute };
  const matching = [...forwardStageChoices(context), ...backwardStageChoices(context)]
    .filter(choice => choice.stageKey === next.stageKey);
  if (matching.some(choice => !choice.licenseRoute || choice.licenseRoute === next.licenseRoute)) return { ok: true };
  if (matching.length && !next.licenseRoute) {
    return denied('LICENSE_ROUTE_REQUIRED', 'Choose the license route before making this branch move.');
  }
  if (!next.recruitingPath && Object.keys(RECRUITING_PATHS).some(recruitingPath => {
    const classified = { ...context, recruitingPath };
    return [...forwardStageChoices(classified), ...backwardStageChoices(classified)]
      .some(choice => choice.stageKey === next.stageKey && (!choice.licenseRoute || choice.licenseRoute === next.licenseRoute));
  })) return denied('RECRUITING_PATH_REQUIRED', 'Choose this recruit’s path before making this move.');
  return denied('INVALID_FLOW_TRANSITION', 'Choose a connected forward or backward step for this recruiting path and license route.');
}
