import { createHmac, timingSafeEqual } from 'node:crypto';
export { newerEventReview, EVENT_REVIEW_STATUSES } from './event-review-model.mjs';
import { EVENT_REVIEW_STATUSES } from './event-review-model.mjs';
export const EVENT_REVIEW_MARKER = 'Event attendance review (LGCYEventReview)';
export const EVENT_REVIEW_TOKEN = 'LGCYEventReview';
const PROOF = /<code>\s*LGCYEventReview\.v1\.([A-Za-z0-9_-]{1,1000})\.([a-f0-9]{64})\s*<\/code>/;
const mac = (encoded, secret) => createHmac('sha256', secret).update('lgcy:event-review:v1\0').update(encoded).digest();
export function eventReviewBody(status) {
  if (!EVENT_REVIEW_STATUSES.includes(status)) throw new Error('Invalid review decision');
  return `${EVENT_REVIEW_MARKER}\n\nDecision: ${status === 'approved' ? 'Approved' : 'Denied'}`;
}
export function eventReviewHtml({ticketId,status,requestId,reviewedAt,secret}) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Review signing unavailable');
  const encoded = Buffer.from(JSON.stringify({ticketId,status,requestId,reviewedAt})).toString('base64url');
  return `<p>${EVENT_REVIEW_MARKER}</p><p>Decision: ${status === 'approved' ? 'Approved' : 'Denied'}</p><p><code>LGCYEventReview.v1.${encoded}.${mac(encoded, secret).toString('hex')}</code></p>`;
}
export const hasEventReviewProof = note => PROOF.test(String(note?.properties?.hs_note_body ?? '').slice(0,10000));
export function parseEventReview(note, secrets = []) {
  const proof = PROOF.exec(String(note?.properties?.hs_note_body ?? '').slice(0,10000));
  if (!proof || !secrets.some(secret=>typeof secret === 'string' && secret.length >= 32 && timingSafeEqual(mac(proof[1],secret),Buffer.from(proof[2],'hex')))) return null;
  let value;try { value=JSON.parse(Buffer.from(proof[1],'base64url').toString()); } catch { return null; }
  const noteId=String(note?.id ?? '');
  const rawTime=String(note?.properties?.hs_timestamp || note?.properties?.hs_createdate || note?.createdAt || '');
  const time=/^\d+$/.test(rawTime)?Number(rawTime):Date.parse(rawTime);
  if (!value || !/^[1-9]\d{0,19}$/.test(value.ticketId) || !/^[1-9]\d{0,19}$/.test(noteId) || !EVENT_REVIEW_STATUSES.includes(value.status) || typeof value.requestId!=='string' || !/^[a-f0-9-]{36}$/i.test(value.requestId) || !Number.isFinite(time) || new Date(time).toISOString()!==value.reviewedAt) return null;
  return {status:value.status,noteId,reviewedAt:value.reviewedAt,ticketId:value.ticketId,requestId:value.requestId};
}
