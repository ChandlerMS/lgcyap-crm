import { stageSnapshotAvailable } from './recruit-stage-save.mjs';
import { stageKeyForStageId } from '../lib/recruiting-config.mjs';
import { FLOW_STAGES, validateFlowTransition } from '../lib/recruiting-flow.mjs';

/** A drop explicitly selects a destination, preserving the source and recorded branch. */
export function pipelineDropChoice(recruit, target) {
  if (!stageSnapshotAvailable(recruit) || !target || target.allowDrop === false || typeof target.stageId !== 'string' || target.stageId === recruit?.stageId
    || target.recruitingPath && target.recruitingPath !== recruit?.recruitingPath) return null;
  const stageKey = stageKeyForStageId(target.stageId);
  const licenseRoute = target.licenseRoute ?? recruit.licenseRoute;
  if (recruit.licenseRoute && licenseRoute !== recruit.licenseRoute) return null;
  if (!validateFlowTransition(recruit, { ...recruit, stageKey, licenseRoute }, { allowDirect: true }).ok) return null;
  return { stageKey, stageId: target.stageId, label: FLOW_STAGES.find(stage => stage.key === stageKey)?.label,
    ...(licenseRoute !== recruit.licenseRoute ? { flowChanges: { licensing_branch: licenseRoute } } : {}) };
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
