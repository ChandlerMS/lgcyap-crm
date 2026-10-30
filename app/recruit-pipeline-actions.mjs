import { stageTransitionChoices } from './recruit-stage-save.mjs';

/** A drop selects a connected edge, never an inferred source or licensing branch. */
export function pipelineDropChoice(recruit, target) {
  if (!target || target.allowDrop === false || typeof target.stageId !== 'string' || target.stageId === recruit?.stageId
    || target.recruitingPath && target.recruitingPath !== recruit?.recruitingPath) return null;
  const choices = [...stageTransitionChoices(recruit, 'back'), ...stageTransitionChoices(recruit, 'forward')]
    .filter(choice => choice.stageId === target.stageId
      && (!target.licenseRoute || (choice.licenseRoute ?? recruit.licenseRoute) === target.licenseRoute)
      && (!choice.flowChanges?.licensing_branch || choice.flowChanges.licensing_branch === target.licenseRoute));
  const unique = [...new Map(choices.map(choice => [JSON.stringify([choice.stageId, choice.flowChanges ?? {}]), choice])).values()];
  return unique.length === 1 ? unique[0] : null;
}

export function pipelineAge(enteredStageAt, now) {
  const entered = enteredStageAt ? Date.parse(enteredStageAt) : NaN;
  if (!Number.isFinite(entered) || !Number.isFinite(now) || now <= 0 || entered > now) return 'Not recorded';
  const hours = Math.floor((now - entered) / 3600000);
  return hours < 1 ? 'Less than an hour' : hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'}`
    : `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? '' : 's'}`;
}

/** Stable local sorting keeps missing data last in either direction and never mutates input. */
export function sortPipelineRecruits(records, key = 'firstName', direction = 'asc') {
  const keys = new Set(['firstName', 'lastName', 'phone', 'email', 'recruiter', 'stage', 'timeInStage', 'lastContactedAt']);
  const field = keys.has(key) ? key : 'firstName';
  const value = record => {
    if (field === 'timeInStage' || field === 'lastContactedAt') {
      const date = Date.parse(record[field === 'timeInStage' ? 'enteredStageAt' : field] ?? '');
      return Number.isFinite(date) ? field === 'timeInStage' ? -date : date : null;
    }
    return typeof record[field] === 'string' && record[field].trim() ? record[field].trim() : null;
  };
  return [...records].sort((a, b) => {
    const left = value(a), right = value(b);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    const compare = typeof left === 'number' && typeof right === 'number' ? left - right
      : String(left).localeCompare(String(right), 'en-US', { sensitivity: 'base', numeric: true });
    return (direction === 'desc' ? -1 : 1) * compare;
  });
}
