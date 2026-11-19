# Event Attendance

The sidebar link **Event Attendance** opens `#event-attendance`, which shows `/event-attendance?embedded=1` in the workspace frame, like Shopper and Standard vs Preferred. The page reads `POST /api/event-attendance` with an empty JSON body. It uses the recruiting workspace's sign-in, editor list and origin checks, and its own HubSpot connection.

## What it counts

The hiring-event sign-in and application pages add one note to the person's recruiting ticket for every sign-in and every application, even when the person already had an open ticket. The page reads those notes, created since midnight Eastern on 2026-11-10, then the tickets they are linked to.

- **Signed in**: people (recruiting tickets) with at least one sign-in note. The day table counts every sign-in, so a person who attends twice appears on both days.
- **Applied**: of those people, the ones whose ticket also has an online application note, sent before or after signing in.
- **Hired**: of those people, the ones whose ticket is now at Completed.
- **Where sign-ins are now**: the current Recruiting stage of each person who signed in.
- **Office**: the office in the sign-in note, or the ticket's office if the note has none.
- **Online applications**: every application note, split into people who signed in, other recruiting tickets, and no ticket (a required item was not met).

Days are Eastern calendar days. Tickets outside the Recruiting pipeline are left out of people and stages.

## Reads

1. `POST /crm/v3/objects/notes/search` for notes whose record source is an integration, created since the start date, 100 per page and at most 20 pages. A larger result sets `partial` and the page says so.
2. `POST /crm/v4/associations/notes/tickets/batch/read` for the sign-in and application notes only.
3. `POST /crm/v3/objects/tickets/batch/read` for pipeline, stage and office.

Notes are classified by their fixed opening heading. The response holds counts only: no names, contact details or answers reach the browser. The page refreshes every minute while it is visible.

## Response

200: `{ fetchedAt, since, timeZone, partial, people: { signedIn, applied, hired }, signIns, applications: { total, fromAttendees, otherTickets, noTicket }, stages: [{ stageId, label, count }], offices: [{ key, label }], days: [{ day, offices, signIns, applications }], canImport }`. `canImport` only decides whether the Import button shows; the import route repeats every check. Errors use the recruiting workspace's error shape. All responses are private and not cached.

## Open in HubSpot

Opens HubSpot's ticket list filtered to the Recruiting pipeline and `source_type = FORM`: the tickets the sign-in page, the application page and imported lists create. HubSpot keeps its own pipeline picker per user, so if the list opens on another pipeline, choose Recruiting.

## Export

Export CSV downloads the attendance table as shown (one row per Eastern event day, a column per office, sign-ins and online applications) with a Total row. Counts only. Cells that start with `=`, `+`, `-` or `@` are prefixed so spreadsheets do not run them.

## Import attendees

Shown to accounts that can add recruits (the same editor list, write switch, intake switch and production-only rule as Add Recruits). The browser reads a CSV or `.xlsx` sign-in list with the Add Recruits file checks, using these headers:

- First Name and Last Name, or a single Name column split at its first space.
- Phone Number.
- Email (optional).
- Office: Orlando, Miami or Tampa.
- Event Date: `11/17/2026`, `2026-11-17` or an Excel date, within the last 12 months and not in the future.

At most 200 rows per file. Rows with problems, and the same person listed twice for one day, are shown and not sent.

Each ready row goes to `POST /api/event-attendance/import` as `{ requestId, firstName, lastName, phone, email, office, eventDate }`, one at a time:

1. `createRecruitIntake` (the Add Recruits intake and its Postgres ledger) finds the contact by phone and email or creates it. It then finds the person's Recruiting ticket or creates one at Hiring Event, path Referrals, with the office and `source_type = FORM`. A contact whose name, phone or email differs is a conflict and is left for review. Nothing existing is changed.
2. The ticket's notes are read through its associations. If it already has a sign-in note on that Eastern day, the row reports "already signed in" and nothing is written.
3. Otherwise a note headed "Hiring event sign-in (imported from a sign-in list)" is added to the ticket and contact. Its time is noon Eastern on the event day, and it records the office and who imported it.

Results: `201 { status: "added", ticketCreated, contact, recruit, noteId }`, or `200 { status: "already_recorded", ... }`. If the note's outcome is unconfirmed, the row can be imported again: the same request ID replays the intake, and the same-day check stops a second note.
