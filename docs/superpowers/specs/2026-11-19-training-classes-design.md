# Training Classes

Create a shared class schedule managed within the existing CRM. Add Training Classes to the Recruits flyout that expands to the right of the sidebar. The hash route is #training-classes; Recruits remains highlighted.

## Approach

Use the existing PostgreSQL database and authenticated API patterns. The user selected managing classes in the CRM over displaying an external calendar/spreadsheet or a supplied static schedule. Browser-only storage would not provide a shared team schedule and is unsuitable.

## Page and records

Show upcoming classes in chronological order, with a separate past-classes view and a clear empty state. Each class has a required name, start and end time, optional trainer, location or HTTPS meeting link, and notes. Dates display in America/New_York, explicitly labeled Eastern Time. Show scheduled/canceled status. Canceled classes remain identifiable in the schedule.

Signed-in CRM users can view the schedule. Existing authorized editors can add, edit, and cancel classes; the API repeats permission checks. Use the existing production write restrictions and same-origin protections. Show validation, loading, saving, and actionable error states. Do not claim a save succeeded until persistence is confirmed.

## Implementation boundaries

Add a versioned database migration and server-side queries with parameterized SQL, input length limits, valid date ordering, and safe URL handling. Store created/updated actor and timestamps for accountability. Keep class management separate from HubSpot recruiting stages.

No enrollment, attendance tracking, recurring classes, invitations, notifications, or calendar synchronization in this initial change. No invented class records.

## Verification

Test routing and sidebar highlighting, record validation, authenticated read/write boundaries, persistence and canceled-class behavior, and page interactions. Run TypeScript, relevant lint, production-source checks and a production build. Preserve other changes on main when integrating.
