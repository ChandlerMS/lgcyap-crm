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

export function carouselIndex(turn, count = 5) {
  return ((turn % count) + count) % count;
}

export function carouselDragSteps(distance) {
  if (!Number.isFinite(distance) || Math.abs(distance) < 50) return 0;
  return Math.max(-2, Math.min(2, -Math.round(distance / 400) || -Math.sign(distance)));
}

export function carouselSectionDelta(current, target, count = 5) {
  const forward = carouselIndex(target - current, count);
  return forward > count / 2 ? forward - count : forward;
}
