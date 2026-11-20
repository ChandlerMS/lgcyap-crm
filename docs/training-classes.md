# Training Classes

Open Recruits → Training Classes, or `/#training-classes` in the signed-in CRM.
The page shows upcoming and past classes, including cancellations. All times are
entered and displayed in America/New_York (Eastern Time). The daylight-saving
settings distinguish the two occurrences of an hour when clocks move back; times
that do not exist during the spring clock change are rejected.

## Access and storage

Signed-in approved CRM accounts can view the shared schedule. Add/edit/cancel
controls require the existing editor policy, `RECRUITING_WRITES_ENABLED=true`, and
Vercel production. The API repeats those checks and requires the exact configured
CRM origin for writes. Preview remains read-only. No HubSpot object is modified.

Records live in the existing DATABASE_URL PostgreSQL database. The bundled schema
matches `migrations/0014_training_classes.sql`. As with the CRM access schema, the
server initializes the additive schema on first use in a transaction protected by
an advisory lock. The database account needs table/index creation privileges on
first use; failures return a generic unavailable message and can be retried. No
build-time connection or manual secret transfer is required. A database operator
may apply that exact idempotent migration ahead of first use instead.

Each record stores created/updated actor and timestamps, cancellation status, and
an incrementing version. Stale edits/cancellations return HTTP 409. An editor can
review the latest saved record while preserving their form values, then explicitly
use the latest version for the edits. Canceled records cannot be edited.

New drafts use a stable UUID as their creation key. PostgreSQL atomically rejects
duplicate insertion; identical replays return the stored record. Different details
under an already-used key return a conflict and require editing the saved record.
Network failures preserve the draft and require a schedule refresh before retry.
Browser unload warnings and the workspace navigation guard protect open drafts.

This release does not provide enrollment, recurring classes, notifications,
invitations, attendance tracking, or calendar synchronization.
