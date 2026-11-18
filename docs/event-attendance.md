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

200: `{ fetchedAt, since, timeZone, partial, people: { signedIn, applied, hired }, signIns, applications: { total, fromAttendees, otherTickets, noTicket }, stages: [{ stageId, label, count }], offices: [{ key, label }], days: [{ day, offices, signIns, applications }] }`. Errors use the recruiting workspace's error shape. All responses are private and not cached.
