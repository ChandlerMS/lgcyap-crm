import { stageIdForKey, stageKeyForStageId } from '../lib/recruiting-config.mjs';
import { RECRUITING_PATHS, LICENSE_ROUTES, forwardStageChoices, backwardStageChoices, validateFlowTransition } from '../lib/recruiting-flow.mjs';

const RECORD_ID = /^[1-9]\d{0,19}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const uncertainMessage = 'The stage change could not be confirmed. Refresh and check the recruit before trying again.';

export class StageSaveError extends Error {
  constructor(code, message, { status = 0, uncertain = false, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'StageSaveError';
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isVersion(value) {
  return typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function stageSnapshotAvailable(recruit) {
  return typeof recruit?.id === 'string' && RECORD_ID.test(recruit.id)
    && typeof recruit.stageKey === 'string' && Boolean(stageIdForKey(recruit.stageKey))
    && stageKeyForStageId(recruit.stageId) === recruit.stageKey
    && typeof recruit.recruitingPath === 'string' && (recruit.recruitingPath === '' || Object.hasOwn(RECRUITING_PATHS, recruit.recruitingPath))
    && typeof recruit.licenseRoute === 'string' && (recruit.licenseRoute === '' || Object.hasOwn(LICENSE_ROUTES, recruit.licenseRoute))
    && isVersion(recruit.updatedAt)
    && recruit.editValues?.hs_pipeline_stage === recruit.stageId
    && recruit.editValues?.recruiting_path === recruit.recruitingPath
    && recruit.editValues?.licensing_branch === recruit.licenseRoute;
}

/** @typedef {{licensing_branch?: 'licensed'|'not_licensed'}} StageFlowChanges */
/**
 * @returns {{stageKey:string,stageId:string,label:string,licenseRoute?:string,flowChanges?:StageFlowChanges}[]}
 */
export function stageTransitionChoices(recruit, direction) {
  if (!stageSnapshotAvailable(recruit) || !['back', 'forward'].includes(direction)) return [];
  const choices = direction === 'back' ? backwardStageChoices(recruit) : forwardStageChoices(recruit);
  return choices.flatMap(choice => {
    const stageId = stageIdForKey(choice.stageKey);
    if (!stageId || stageKeyForStageId(stageId) !== choice.stageKey) return [];
    return [{ ...choice, stageId, ...(choice.licenseRoute && choice.licenseRoute !== recruit.licenseRoute
      ? { flowChanges: { licensing_branch: /** @type {'licensed'|'not_licensed'} */ (choice.licenseRoute) } } : {}) }];
  });
}

function uncertainError() {
  return new StageSaveError('SAVE_UNCERTAIN', uncertainMessage, { uncertain: true });
}

function responseError(response, result) {
  const rawRetry = Number(result?.retryAfterSeconds ?? response.headers.get('Retry-After'));
  const retryAfterSeconds = Number.isFinite(rawRetry) && rawRetry > 0 ? Math.min(rawRetry, 86400) : null;
  const status = response.status;
  const detail = { status, retryAfterSeconds };
  if (status === 401) return new StageSaveError('UNAUTHORIZED', 'Sign in again before changing recruiting stages.', detail);
  if (result?.error?.code === 'RECORD_CHANGED') return new StageSaveError('RECORD_CHANGED', 'This recruit changed in HubSpot. Refresh the latest record before choosing a stage again.', detail);
  if (result?.error?.code === 'SAVE_UNCERTAIN' || status >= 500) return new StageSaveError('SAVE_UNCERTAIN', uncertainMessage, { ...detail, uncertain: true });
  if (status === 403) return new StageSaveError('SAVE_UNAVAILABLE', 'Stage changes are unavailable for this account or workspace.', detail);
  if (status === 429) return new StageSaveError('RATE_LIMITED', 'HubSpot is busy. Wait, then refresh before trying again.', detail);
  return new StageSaveError('SAVE_FAILED', 'The stage was not saved. Refresh the latest record before trying again.', detail);
}

/**
 * Uses the existing reviewed-write contract; never retries a potentially sent mutation.
 * @param {object} recruit
 * @param {string} targetStageId
 * @param {{fetchImpl?: typeof fetch, requestId?: string, signal?: AbortSignal,flowChanges?:StageFlowChanges}} [options]
 */
export async function saveRecruitStage(recruit, targetStageId, { fetchImpl = fetch, requestId = crypto.randomUUID(), signal, flowChanges = {} } = {}) {
  if (!stageSnapshotAvailable(recruit) || !stageKeyForStageId(targetStageId)
    || targetStageId === recruit.stageId || typeof requestId !== 'string' || !UUID.test(requestId)
    || !flowChanges || typeof flowChanges !== 'object' || Array.isArray(flowChanges)
    || Object.keys(flowChanges).some(key => key !== 'licensing_branch')
    || (Object.hasOwn(flowChanges, 'licensing_branch') && (typeof flowChanges.licensing_branch !== 'string'
      || !Object.hasOwn(LICENSE_ROUTES, flowChanges.licensing_branch)))) {
    throw new StageSaveError('INVALID_STAGE_CHANGE', 'Refresh the recruit and choose a different valid stage.');
  }
  const nextRoute = flowChanges.licensing_branch ?? recruit.licenseRoute;
  const transition = validateFlowTransition(recruit, { ...recruit, stageKey: stageKeyForStageId(targetStageId), licenseRoute: nextRoute });
  if (!transition.ok) throw new StageSaveError('INVALID_STAGE_CHANGE', transition.message);
  if (signal?.aborted) throw new StageSaveError('SAVE_CANCELLED', 'The stage change was cancelled before saving.');
  const id = requestId.toLowerCase();
  const changes = { hs_pipeline_stage: targetStageId, ...(nextRoute !== recruit.licenseRoute ? { licensing_branch: nextRoute } : {}) };
  const expectedValues = Object.fromEntries(Object.keys(changes).map(property => [property, recruit.editValues[property]]));
  let response;
  try {
    response = await fetchImpl(`/api/recruits/${encodeURIComponent(recruit.id)}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({
        expectedUpdatedAt: recruit.updatedAt, requestId: id,
        changes, expectedValues,
      }),
    });
  } catch { throw uncertainError(); }
  let result;
  try { result = await response.json(); }
  catch {
    if (response.status === 401) throw new StageSaveError('UNAUTHORIZED', 'Sign in again before changing recruiting stages.', { status: 401 });
    throw uncertainError();
  }
  if (!response.ok) throw responseError(response, result);
  if (!result || result.status !== 'saved' || result.requestId !== id
    || result.recruit?.id !== recruit.id || result.recruit.stageId !== targetStageId
    || !stageSnapshotAvailable(result.recruit) || result.recruit.stageKey !== stageKeyForStageId(targetStageId)
    || result.recruit.recruitingPath !== recruit.recruitingPath || result.recruit.licenseRoute !== nextRoute) {
    throw uncertainError();
  }
  return { recruit: result.recruit, replayed: result.replayed === true };
}
