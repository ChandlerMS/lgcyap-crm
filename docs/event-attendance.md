# Event Attendance

The board is a section of the Recruiting Dashboard, between the pipeline and Meetings and Calendar (Demo data leaves it unloaded, like the HubSpot panels). It has no sidebar link. Saved `#event-attendance` links still open the full page, `/event-attendance?embedded=1` in the workspace frame, with Recruiting Dashboard selected in the sidebar. The page reads `POST /api/event-attendance` with an empty JSON body. It uses the recruiting workspace's sign-in, editor list and origin checks, and its own HubSpot connection.

## What it counts

The hiring-event sign-in and application pages add one note to the person's recruiting ticket for every sign-in and every application, even when the person already had an open ticket. The page reads those notes, created since midnight Eastern on 2026-11-10, then the tickets they are linked to.

- **Signed in**: people (recruiting tickets) with at least one sign-in note. The day table counts every sign-in, so a person who attends twice appears on both days.
- **Applied**: of those people, the ones whose ticket also has an online application note, sent before or after signing in.
- **Hired**: of those people, the ones whose ticket is now at Completed.
- **Office**: the office in the sign-in note, or the ticket's office if the note has none.
- **Online applications**: every application note, per event day in the table. The Applications section below lists them.

Days are Eastern calendar days. Tickets outside the Recruiting pipeline are left out of people.

## Reads

1. `POST /crm/v3/objects/notes/search` for notes whose record source is an integration, created since the start date, 100 per page and at most 20 pages. A larger result sets `partial` and the page says so.
2. `POST /crm/v4/associations/notes/tickets/batch/read` for the sign-in and application notes only.
3. `POST /crm/v3/objects/tickets/batch/read` for pipeline, stage, office and recruit name.

Notes are classified by their fixed opening heading. The page refreshes every minute while it is visible.

## People lists

Select a tile (Signed in, Applied, Hired, Today), an event day, or an office count on an event day to open the people behind that number. One list is open at a time. Each name opens the recruit in the CRM. The lists leave out stage, location and a HubSpot link; the recruit and the Applications section have them.

- **Signed in:** one row per person, with sign-in count and first online application.
- **Applied** and **Hired:** the same people, filtered.
- **Today**, an **event day** or an **office on a day:** one row per sign-in, with the answers from that sign-in. Today and a whole day also list that day's online applications.

Details come from the note itself: name, email, phone, office, how they heard about us, license and source for a sign-in; name, email, phone, office and whether required items were met for an application. The ticket fills in a missing name, email or phone. These are shown only to recruiting editors, the same people who see recruits in the workspace. Other application answers, and which required item was missed, are not sent to the browser. Every office count matches the sign-ins listed for that day and office. Orlando, Miami and Tampa always have a column.

## Applications

The Applications section is the Applications page's list (`app/applications-page.tsx`, read from `POST /api/applications`): the same counts (Applications, Did not meet a required item, Need a private conversation, Still at Hiring Event), Hiring Event reminder, search, office and status filters, and one card per application with its answers, photo ID and links. It shows ten cards a page. Its title opens the full page. It reads again when the board's Refresh is used, and when the board's minute refresh finds a different number of applications.

## Approve and Deny

Every people list and every application card has Approve (✓) and Deny (×), the decision, and Add Note. A decision is a signed note on the recruiting ticket (`POST /api/recruits/{id}/actions` with `kind: "event-review"`). The board and its Applications section share one review state. The Applications page reads the same decisions from `POST /api/applications`, which adds `reviews`, `reviewComplete`, `reviewNotice` and `canReview` the way this page's read does. If the decisions cannot be read, the applications still load with a notice.

## Response

200: `{ fetchedAt, since, timeZone, partial, people: { signedIn, applied, hired }, signIns, applications: { total, fromAttendees, otherTickets, noTicket }, stages: [{ stageId, label, count }], offices: [{ key, label }], days: [{ day, offices, signIns, applications }], attendees: [{ ticketId, name, email, phone, office, stageId, stage, signIns, firstDay, lastDay, appliedAt, hubspotUrl }], visits: [{ ticketId, day, at, name, email, phone, office, heardAbout, license, source, imported, stageId, stage, hubspotUrl }], applicants: [{ ticketId, day, at, name, email, phone, office, requirementsMet, fromAttendee, stageId, stage, hubspotUrl }], canImport }`. `canImport` only decides whether the Import button shows; the import route repeats every check. Errors use the recruiting workspace's error shape. All responses are private and not cached.

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
