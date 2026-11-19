import { stageSnapshotAvailable } from './recruit-stage-save.mjs';
import { stageKeyForStageId } from '../lib/recruiting-config.mjs';
import { FLOW_STAGES, validateFlowTransition } from '../lib/recruiting-flow.mjs';

/**
 * A drop explicitly selects a destination. A recorded path or branch is preserved; a missing one is
 * recorded from the destination, which also lets an unrecorded recruit be dropped onto its own stage on a path.
 */
export function pipelineDropChoice(recruit, target) {
  if (!stageSnapshotAvailable(recruit) || !target || target.allowDrop === false || typeof target.stageId !== 'string') return null;
  const stageKey = stageKeyForStageId(target.stageId);
  if (!stageKey) return null;
  const recruitingPath = target.recruitingPath || recruit.recruitingPath;
  const licenseRoute = target.licenseRoute || recruit.licenseRoute;
  if (recruit.recruitingPath && recruitingPath !== recruit.recruitingPath) return null;
  if (recruit.licenseRoute && licenseRoute !== recruit.licenseRoute) return null;
  const flowChanges = {
    ...(recruitingPath !== recruit.recruitingPath ? { recruiting_path: recruitingPath } : {}),
    ...(licenseRoute !== recruit.licenseRoute ? { licensing_branch: licenseRoute } : {}),
  };
  const recordsRouting = Object.keys(flowChanges).length > 0;
  if (target.stageId === recruit.stageId && !recordsRouting) return null;
  if (!validateFlowTransition(recruit, { ...recruit, stageKey, recruitingPath, licenseRoute }, { allowDirect: true }).ok) return null;
  return { stageKey, stageId: target.stageId, label: FLOW_STAGES.find(stage => stage.key === stageKey)?.label,
    ...(recordsRouting ? { flowChanges } : {}) };
}

const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

/**
 * Places a floating recruit card beside its row, preferring the right side, then the left,
 * then below (or above) the name on narrow screens. Always stays inside the viewport.
 * @param {{top:number,bottom:number,left:number,right:number}} anchor
 * @param {{width:number,height:number}} size
 * @param {{width:number,height:number}} viewport
 */
export function besideAnchorPosition(anchor, size, viewport, { gap = 10, edge = 12 } = {}) {
  const maxLeft = viewport.width - edge - size.width, maxTop = viewport.height - edge - size.height;
  let left, top;
  if (anchor.right + gap <= maxLeft) { left = anchor.right + gap; top = anchor.top - 10; }
  else if (anchor.left - gap - size.width >= edge) { left = anchor.left - gap - size.width; top = anchor.top - 10; }
  else { left = clamp(anchor.left, edge, Math.max(edge, maxLeft)); top = anchor.bottom + 6 <= maxTop ? anchor.bottom + 6 : anchor.top - 6 - size.height; }
  return { top: clamp(top, edge, Math.max(edge, maxTop)), left };
}

/**
 * Places a stage pop-out below its stage, or above it when only that side has room,
 * otherwise as close to the stage as the viewport allows.
 */
export function popoutPosition(anchor, size, viewport, { gap = 8, edge = 16 } = {}) {
  const left = clamp(anchor.left, edge, Math.max(edge, viewport.width - edge - size.width));
  const below = viewport.height - edge - (anchor.bottom + gap), above = anchor.top - gap - edge;
  const top = size.height <= below ? anchor.bottom + gap : size.height <= above ? anchor.top - gap - size.height
    : clamp(anchor.bottom + gap, edge, Math.max(edge, viewport.height - edge - size.height));
  return { top, left };
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
