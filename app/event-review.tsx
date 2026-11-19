'use client';
import { useRef, useState, type ReactNode } from 'react';
import RecruitQuickActions from './recruit-quick-actions';
import { newerEventReview, keepEventReviewRequest } from '../lib/event-review-model.mjs';
import styles from './event-review.module.css';

export type Review = { status: 'approved' | 'denied'; noteId: string; reviewedAt: string };
export type ReviewStatus = Review['status'];
export type EventReviews = {
  // Approve, Deny, the decision and Add Note for one recruiting ticket.
  actions: (row: { ticketId: string | null; name: string }) => ReactNode;
  error: string;
  // Repeats the failed decision, or null when only a Refresh can tell whether it saved.
  retry: (() => void) | null;
};
type Options = {
  // The decisions the last HubSpot read returned, whether that read was complete, and whether this account can review.
  reviews?: Record<string, Review>; reviewComplete?: boolean; canReview?: boolean;
  onSignedOut: () => void;
  // A save went through but did not return a usable decision: read the page again.
  onStale: () => void;
};

// The Approved and Denied review used by Event Attendance and the Applications page. Each decision is a signed HubSpot
// note on the recruiting ticket; a retry reuses its request ID so HubSpot never gets the same decision twice.
export function useEventReviews({ reviews, reviewComplete, canReview = false, onSignedOut, onStale }: Options): EventReviews {
  const [localReviews, setLocalReviews] = useState<Record<string, Review>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<{ ticketId: string; status: ReviewStatus } | null>(null);
  const writing = useRef(new Set<string>());
  const requests = useRef(new Map<string, { status: string; requestId: string }>());

  async function save(ticketId: string, status: ReviewStatus) {
    if (!canReview || writing.current.has(ticketId)) return;
    const previous = requests.current.get(ticketId);
    const pending = previous?.status === status ? previous : { status, requestId: crypto.randomUUID() };
    requests.current.set(ticketId, pending); writing.current.add(ticketId);
    setBusyIds(new Set(writing.current)); setError(''); setFailed(null);
    try {
      const response = await fetch(`/api/recruits/${encodeURIComponent(ticketId)}/actions`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: pending.requestId, kind: 'event-review', reviewStatus: status }) });
      const result = await response.json().catch(() => null);
      if (response.status === 401) { setLocalReviews({}); onSignedOut(); return; }
      if (!response.ok || result?.status !== 'saved') {
        if (!keepEventReviewRequest(response.status, result?.error?.code)) requests.current.delete(ticketId);
        setError(result?.error?.message || 'The review could not be saved.');
        if (result?.error?.code !== 'SAVE_UNCERTAIN') setFailed({ ticketId, status });
        return;
      }
      requests.current.delete(ticketId);
      const review = result.review;
      if (review?.status === status && /^[1-9]\d{0,19}$/.test(review.noteId) && Number.isFinite(Date.parse(review.reviewedAt))) setLocalReviews(values => ({ ...values, [ticketId]: newerEventReview(values[ticketId], review) }));
      else onStale();
    } catch { setError('The connection dropped. Retry will reuse the same review request.'); setFailed({ ticketId, status }); }
    finally { writing.current.delete(ticketId); setBusyIds(new Set(writing.current)); }
  }

  const actions = (row: { ticketId: string | null; name: string }) => {
    if (!row.ticketId) return <span className={styles.muted}>No recruiting ticket</span>;
    const id = row.ticketId;
    const status = (newerEventReview(reviews?.[id], localReviews[id]) as Review | undefined)?.status;
    const busy = busyIds.has(id);
    return <div className={styles.reviewActions} role="group" aria-label={`Review for ${row.name}`}>
      <button type="button" className={`${styles.reviewButton} ${styles.approve}`} disabled={!canReview || busy} aria-label={`Approve ${row.name}`} title="Approved" aria-pressed={status === 'approved'} onClick={() => void save(id, 'approved')}>✓</button>
      <button type="button" className={`${styles.reviewButton} ${styles.deny}`} disabled={!canReview || busy} aria-label={`Deny ${row.name}`} title="Denied" aria-pressed={status === 'denied'} onClick={() => void save(id, 'denied')}>×</button>
      <span className={styles.reviewStatus} role="status">{busy ? 'Saving…' : status === 'approved' ? 'Approved' : status === 'denied' ? 'Denied' : reviewComplete === false ? 'Status unavailable' : 'Not reviewed'}</span>
      {canReview && <RecruitQuickActions kinds={['note']} recruitId={id} recruitName={row.name} />}
    </div>;
  };
  return { actions, error, retry: failed ? () => void save(failed.ticketId, failed.status) : null };
}
