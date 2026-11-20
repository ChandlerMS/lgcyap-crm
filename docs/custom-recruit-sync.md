# Custom Recruit synchronization

Authorized by the owner on 2026-11-19: event sign-ins and online applicants become custom Recruits, using Referrals / Recruiters followed by Onboarding. Fifteen additional properties were approved, including ticket name and source timestamp mirrors. Existing Tickets stay in place for application notes, communication history, and the existing app APIs; each custom Recruit is associated with the same Contact and uniquely keyed by `crm_ticket_id`.

## Operation

Production only, with `RECRUITING_CUSTOM_SYNC_ENABLED=true`, existing recruiting writes enabled, database, and the existing authentication secret. Preview and development never run this automation. `/api/cron/custom-recruits` requires the exact cron secret and runs every minute. Confirmed app edits also schedule a best-effort sync; a later cron confirms interrupted work. The UI refreshes live data every minute. Batches and provider limits can delay a large backlog.

The provider verifies the existing private app's portal and app ID, required object access, selected pipeline stages, and property definitions before record writes. It creates only the fifteen approved missing properties, in the existing `recruit_name` property group. Schema permission failure stops the job and reports `schema_permission`; no permissions are granted automatically and existing definitions are never altered.

Fresh sign-in Tickets enter Referrals / Hiring Event. Application notes from the existing online application integration are parsed using the same canonical heading as Applications, beginning with the form launch window of 2026-11-10. The existing unique Contact/Ticket is reused. Contact-only applications receive a Ticket at Recruiters / Application, associated with the original note. This includes applicants whose requirements were not met: original answers remain intact and no qualification, offer acceptance, or license verification is inferred. A recorded application advances Referrals from Hiring Event to Application only; advanced stages, Recruiters Hiring Event, and terminal outcomes are preserved.

Native custom Recruits in the selected pipelines are also discovered. With a unique Contact and no existing Recruiting Ticket, the bridge creates a corresponding Ticket so the app can display and edit it. Ambiguous/missing Contact associations stop writes. Existing Contact names, email, and phone are reused and never overwritten by intake claims. Contact edits made through the app continue to update that same HubSpot Contact directly.

## Mapping

| App / Ticket | Custom Recruit |
| --- | --- |
| genpop | Referrals pipeline `955864424`, recruiting_path=referrals |
| mass_recruiting | Recruiters pipeline `955871370`, recruiting_path=recruiters |
| Offer onward | Onboarding pipeline `955915022`, preserving recruiting_path |
| licensed / not_licensed branch | already_licensed / needs_licensing |
| Hiring Event / Application / Phone Interview | Corresponding selected pipeline stage |
| Offer / licensing reminders / licensed NPN / contracting / training / completed | Corresponding Onboarding stage |
| Rejected / Withdrawn | Closed not completed, with closed_reason |
| Ticket name (`subject`), name, owner, office, intake license status, recruit type, orientation date, five progress flags | Corresponding custom properties |

The existing Onboarding Licensed stage maps to the app's licensed Offer branch and is preserved when unchanged. Specific closed reasons are preserved when their terminal meaning remains unchanged. Existing `lgcy_office` is a one-time fallback for a blank canonical office; edits use `orientation_office`, which supports Orlando, Miami, and Tampa. Blank values remain unknown. Intake license claims remain distinct from verified licensing.

Approved additions: `orientation_office`, `intake_license_status`, `recruit_type`, `orientation_date`, `orientation_registered`, `orientation_checked_in`, `licensing_started`, `contracting_registered`, `appointments_created`, `subject`, the four source timestamps below, and unique `crm_ticket_id`. No other schema additions are made.

`source_ticket_created_at`, `source_ticket_updated_at`, and `source_ticket_stage_entered_at` mirror the original Ticket system dates. `source_last_contacted_at` mirrors the latest Ticket or linked Contact contact date used by the app. These are source metadata: custom Recruit system dates and these mirrors never overwrite Ticket system dates. Unchanged values are not rewritten, and each metadata patch is read back. Email, phone, and Contact name edits use the same associated Contact directly. Source type, communication history, and application answers remain on their original associated Ticket/Contact/notes.

## Conflict and recovery

On the first link, equal values and blank fields can be reconciled. Different nonblank values require review; neither side silently wins. A newly added field uses this same rule when adopting older baselines. After a confirmed baseline, a one-sided field change propagates, matching changes are acknowledged, and competing changes stop the entire planned patch. Every mutation is preceded by fresh reads. HubSpot does not provide a conditional write here, so an external edit between the final read and write remains a small race window.

Transaction-scoped Postgres advisory locks (compatible with the production Neon transaction pooler) serialize each Ticket and intake Contact. Durable intent writes are committed separately from the lock transaction. Unique HubSpot `crm_ticket_id` and a database unique Recruit ID guard duplicate links. Durable intent is recorded before creates and updates. A timeout is confirmed by reading; uncertain creates/updates are never blindly replayed. A later matching read clears the intent. Unresolved intent needs operator review of the actual records before metadata is repaired; do not delete it merely to retry a create.

Database state stores IDs, statuses, cursors, and keyed HMAC fingerprints, not application answers or candidate profile values. Original application notes and source data remain in HubSpot. Deferred application note failures are retried independently so they do not block new applications. Discovery has separate request deadlines to reserve time for Ticket reconciliation, and custom full-scan records precede recent-change records. Both Tickets and custom Recruits have durable full-scan cursors in addition to recent-change discovery, preventing older records from being stranded by batch limits.

Recruit profiles show the custom HubSpot Recruit link and sync status. Global setup failures appear as a sync attention notice. Cron logs contain only safe status codes and counts. The prior Contact stage mirror remains separately active.

Validation: model mapping, sparse provider writes, schema checks, fresh property completeness, associations, conflict/timeout recovery, per-record locks, source retry isolation, and full-scan cursor recovery are covered by `tests/custom-recruit-*.test.mjs`.
