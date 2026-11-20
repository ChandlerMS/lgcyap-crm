export const EVENT_REVIEW_STATUSES = Object.freeze(['approved','denied']);
export function newerEventReview(first, second) {
  if (!first) return second;if (!second) return first;
  if (first.reviewedAt !== second.reviewedAt) return first.reviewedAt > second.reviewedAt ? first : second;
  return BigInt(first.noteId) >= BigInt(second.noteId) ? first : second;
}
export function keepEventReviewRequest(status, code) {
  if (code === 'SAVE_UNCERTAIN' || code === 'QUICK_ACTION_BUSY') return true;
  return !(status >= 400 && status < 500);
}
