# Recruiting Contact lifecycle synchronization

Contact `recruiting_lifecycle_stage` mirrors ticket `hs_pipeline_stage` only in
portal 50894788, Recruiting pipeline 924992938. The Contact's sales `lifecyclestage`
is never read or written by this feature. No custom object, record deletion,
messaging or association creation is included.

| Contact value | Ticket stage ID | Label |
|---|---|---|
| hiring_event | 1473318768 | Hiring Event |
| application | 1473318769 | Application |
| phone_interview | 1473225368 | Phone Interview |
| offer | 1473318770 | Offer |
| licensing_reminders | 1473318771 | Licensing Reminders |
| licensed_npn | 1473318772 | Licensed w/ NPN |
| contracting | 1416243216 | Contracting |
| training | 1416243217 | Training |
| completed | 1416243218 | Completed |

Withdrawn remains in HubSpot but is excluded from this nine-stage sync. Referrals,
Recruiters and Licensed are branch choices, not additional stages.

## Contract

- POST `/api/recruits/:id/snapshot` with `{}` refreshes exactly one ticket before a
  live stage move. It uses the same session, editor allowlist, configured-origin,
  JSON/body-size checks and private/no-store headers as the recruiting read API.
  It accepts no filters or fields, scopes the ID to this Recruiting pipeline, and
  sends only a no-store HubSpot GET. It never claims a write ledger or changes CRM data.
- A live drag (and the shared stage controls) first reads this snapshot. If its
  stage, recruiting path or license route changed, the UI displays the new record
  and stops the old move. Otherwise it saves the intended destination with the
  fresh `expectedUpdatedAt` and sparse `expectedValues`, preserving unrelated edits.
  The existing server read/version check still rejects edits made after this refresh.
  No mutation is automatically retried. Known refresh failures or rejected conflicts
  permit another deliberate drag, which refreshes again; uncertain saves remain blocked
  for inspection. Demo moves remain local and never call the snapshot endpoint.

- Existing authenticated POST `/api/recruits` adds optional `lifecycleSync` to each
  recruit: `status`, `checkedAt`, `syncedAt`. This is the last checked state, not a
  promise that an external editor has made no later change.
- Existing authenticated POST `/api/recruits/:id` preserves its ticket-save and
  idempotency contract. After a confirmed save it attempts Contact sync within a
  bounded deadline and returns a separate sync status; sync failure does not
  retry or roll back a confirmed ticket write.
- GET `/api/cron/recruit-lifecycle` requires an exact Bearer `CRON_SECRET` (minimum
  32 characters), production hosting, and both write and sync enable flags.
  Returns counts only; 401 without authentication, 503 when disabled/unavailable.
- Production cron runs each minute, scanning up to 20 tickets within 48 seconds.
  A durable ID cursor continues large pipelines across runs; a full pass resets
  the cursor. Provider outages, limits and larger pipelines increase latency.
- App refreshes visible live data once a minute, except while editing/importing.
  Demo data never syncs. Add Recruits is picked up by the next scheduled pass.

## Reconciliation and safety

Read both directions of the association and verify exactly one Contact per ticket
and one Recruiting ticket per Contact. Paginate associations (maximum 500); a cap,
missing row, archived row, or failed read is never interpreted as uniqueness.
Tickets in other pipelines are not synchronized.

Initialize a blank Contact recruiting field from its verified ticket. Existing
nonblank disagreement is held for review. Thereafter compare both values against
the last acknowledged pair. One changed side propagates; equal values acknowledge
without writing; divergent edits pause. Clearing a configured Contact stage also
pauses, rather than clearing a ticket stage. Contact changes can select any of the
nine valid stages, except licensing steps on an explicitly licensed branch. Path
and license branch values are preserved, never inferred. App movement controls
allow direct forward and backward drops, including skipped stages, while preserving
the assigned recruiting path and license branch. Collapsed names and visible grips
both start a drag. Menus and arrows retain their connected-step shortcuts. These
drops use the same authenticated, version-checked ticket save and Contact sync.

Before PATCH, re-read the whole pair. Commit an intent before sending a mutation.
Verify both values and branch fields afterward. Timeouts/partial outcomes retain
the intent and never auto-retry/reverse it. Matching both values later resolves
the intent. To resolve a conflict, deliberately make both records agree in HubSpot;
changed associations require an operator's reviewed ledger reset.

Transaction-scoped PostgreSQL advisory locks serialize app writes and sync workers
and work with transaction pooling. Intent statements commit on another connection.
HubSpot has no compare-and-set PATCH: external changes in the tiny interval between
the last read and PATCH remain a provider limitation. Post-write checks detect
observable disagreements; they cannot reconstruct a fully overwritten external value.

## Deployment

Run `node scripts/migrate-lifecycle.mjs --apply` in a Production Vercel build once,
before enabling `RECRUITING_LIFECYCLE_SYNC_ENABLED=true`. Keep `CRON_SECRET` server
side and never expose it in client variables or URLs. Existing HubSpot private app
59264745 must pass the runtime portal/app/scopes check for Contact/Ticket reads and
writes. Feature flag omission disables all sync; preview remains read-only.

Contract sources: HubSpot CRM v3 object PATCH and v4 associations; Vercel Cron
authorization. Orbit discovery returned batch-update contracts only (partial fit);
the existing app's single-object update and association contracts remain in use.
