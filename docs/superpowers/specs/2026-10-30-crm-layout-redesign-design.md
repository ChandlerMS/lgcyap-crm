# CRM layout redesign — design

Date: 2026-10-30 · Branch: `dev` · Status: draft for approval

## Intent

The Legacy recruiting CRM (this repo, live at lgcyap-crm.vercel.app) works, but its
layout is roomy and single-column: a large-logo sidebar, a Today page, eight separate
stage pages, a profile page and Add Recruits. The LGCY Onboard mockup
(lgcy-onboard.carlos-831.workers.dev) shows a denser, panel-based layout the owner
prefers: a compact sidebar with an office switch, a dashboard of stat cards and
panels, a kanban pipeline, and dense tables.

The redo keeps the CRM's look (black and gold, logo, type, tone) and its live
HubSpot data, and rebuilds the screens in the Onboard layout. It also adds six
HubSpot-backed pages so recruiters can see recruits' email, calls, contacts, tasks,
calendar and meetings without leaving the workspace.

## Decided by the owner

- Keep the current CRM theme and style; adopt the Onboard *layout*.
- Menu: Dashboard, Pipeline, Inbox, Calls, Contacts, Tasks, Calendar, Meetings, Settings.
- Not included: Pre-screens, Preboarding, Candidates, Trainings, Automations.
- Inbox, Calls, Contacts, Tasks, Calendar and Meetings read live from HubSpot.
- Those six pages are view-only for now.

## Goals

1. Every screen uses the Onboard layout pattern: compact sidebar, page header row
   with actions on the right, content in bordered panels with gold section titles,
   dense tables and cards.
2. Everything the CRM does today still works: live recruit reads, stage moves,
   Edit → Review → Save to HubSpot, Add Recruits (manual rows and CSV/Excel import),
   communication shortcuts, office and license filters, search, Refresh.
3. Six new view-only pages showing HubSpot activity for recruits.
4. Old links keep working (`#recruit/{id}`, stage hashes, `#today`, `#add-recruit`).

## Non-goals

- Any action on the new pages: no logging calls, completing tasks, sending email,
  booking meetings. A per-row "Open in HubSpot" link covers that for now.
- Drag-and-drop on the Pipeline board (my call; the existing stage controls are the
  deliberate, tested way to move a recruit, and drag invites accidental saves).
- A light theme (my call; the Onboard "Dark skin" toggle is not carried over).
- HubSpot's chat/help-desk Conversations inbox (my call; see Inbox below).
- Direct RingCentral, Gmail, Zoom, Google Calendar or Indeed integrations.
- New recruiting stages, recruiter assignment or round-robin logic.

## Anti-goals (would be a failure even if it technically works)

- Any new code path that changes HubSpot data, or any loosening of the existing
  write guards (Production-only writes, `RECRUITING_WRITES_ENABLED`, ledger, scopes).
- Showing HubSpot records that are not tied to a recruit (clients, billing, other
  pipelines). This is a recruiting workspace on a shared HubSpot portal.
- Rendering HubSpot email or call HTML in the page. Bodies are shown as plain text.
- Losing the CRM's accessibility work: skip link, focus moved to the page heading on
  navigation, mobile menu focus trap and Escape, visible gold focus rings, 44px touch
  targets on touch-sized screens.
- Deploying to Production as a side effect. `main` auto-deploys to Production; this
  work stays on `dev` (Preview only) until the owner approves a merge.

## Look and feel

Keep the CRM's tokens in `app/globals.css`: canvas `#0a0a0a`, sidebar `#050505`,
panel `#141414`, gold `#d4af37` / hover `#e3c459`, text `#f4f1e8`, muted `#b6b2a8`,
line `#2a2924`, and the system font stack. Keep the gold primary button, the
outlined gold secondary button and the gold focus ring.

Borrow from the Onboard screenshots:

- Panels: `--panel` background, 1px `--line` border, ~8px radius, 16–20px padding,
  a small gold semibold title at the top-left, optional muted one-line description.
- Density: 13–14px body text in panels and tables, 12px meta text, compact rows.
- Status chips: small rounded outlined pills (license status, stage, outcome,
  "overdue" in amber). Amber `#e8c387` (the CRM's former `.overdue` color, removed in
  the contrast cleanup; re-add it as a token) marks anything past its review
  threshold.
- Control borders keep the 3:1 contrast values from the
  `style/control-contrast-css-cleanup` branch (`#6b6656` fields, `#6d633e` gold
  controls).

Reference: the owner's twelve Onboard screenshots are held in the session's local
image folder, not in the repo (they contain applicant names and phone numbers).
- Page title: smaller than today (~22–24px). My call: keep the CRM's system font
  rather than the Onboard's wide display face, since the owner asked to keep the
  CRM's style. Easy to swap later.

## App shell

**Sidebar (~200px, fixed):** the Legacy logo scaled to fit the narrower rail at the
top, then the office switch, then the nine menu items (icon + label, active item in
gold with the existing left bar), then at the bottom the signed-in person (initials,
name or email, and an access line: "Editing enabled", "Recruit entry enabled" or
"Read-only") and Sign out.

**Office switch:** a segmented control: All · ORL · TPA · MIA (the CRM has Orlando,
Tampa and Miami). It filters every page globally and replaces today's per-page office
dropdown. Records whose office is "Not recorded" appear under All only.

**Page header row:** page title on the left; page actions on the right (search box,
filters, view toggles, the gold "+ Add recruits" button where relevant).

**Status bar:** a small floating bar at the bottom-right, as in the Onboard
screenshots: "Legacy Recruiting · {loaded} recruits, {active} active · updated
{time} · Refresh". Refresh reloads both recruit data and activity data and keeps
today's disabled-while-saving/editing rules. Connection, partial-data, save and
stage-error notices keep their current wording and appear at the top of the content
area as slim banners.

**Mobile (≤800px):** the sidebar becomes the existing slide-in menu with its focus
trap. Panels stack to one column; tables scroll sideways; the board scrolls sideways.

## Routes

Hash routing stays (`resolveWorkspaceRoute` in `app/recruiting-navigation.mjs`).

| Hash | Page |
|---|---|
| `#dashboard` (default) | Dashboard |
| `#pipeline` | Pipeline, board view |
| `#pipeline/list` | Pipeline, list view |
| `#inbox`, `#calls`, `#contacts`, `#tasks`, `#calendar`, `#meetings`, `#settings` | New pages |
| `#add-recruits` | Add Recruits (opened from the "+ Add recruits" button; not in the menu) |
| `#recruit/{id}` | Recruit profile (menu highlights Pipeline) |
| Aliases | `#today`, `#follow-up` → Dashboard; `#add-recruit` → Add Recruits; each old stage hash (`#recruits`, `#phone-interview`, … `#completed`) → Pipeline list view filtered to that stage |

The existing guards stay: an open editor or unsaved Add Recruits draft blocks
navigation exactly as today.

## Pages

### Dashboard (replaces Today)

A period toggle (This week · 30 days · Quarter) in the header controls the activity
counts. Office switch applies.

- **Stat cards row:** Active recruits (all but Completed) · Needs review (5+ days in
  stage, today's rule) · In Orientation · Next orientation (date and how many
  recruits have it) · Open tasks (overdue count underneath) · Calls in period ·
  Meetings in period · Completed in period (entered Completed in the period).
- **Where everyone is:** one horizontal bar per stage in pipeline order with counts;
  clicking a stage opens Pipeline list filtered to it. An "Unrecognized stage" bar
  appears only if any exist, linking to those records (today's unmapped notice).
- **Recruiters:** one row per HubSpot owner: open recruits they own, calls and
  meetings in the period, overdue tasks.
- **Next appointments:** the next upcoming meetings and orientation dates.
- **Tasks due:** overdue and due-today tasks (view-only rows).
- **Recent activity:** newest calls, emails and meetings, plus "entered {stage}"
  events from each recruit's entered-stage date.

### Pipeline (replaces the eight stage pages)

Header: search ("Find a recruit"), license-status filter, Board/List toggle, gold
"+ Add recruits" button.

- **Board:** one column per stage in pipeline order, each with its name, count, and
  an amber count of cards past the 5-day review threshold. Columns ~220px wide, the
  board scrolls sideways, each column scrolls vertically. Cards show name, owner
  initials, office, license-status chip, orientation date chip when set, days in
  stage (amber with a warning mark at 5+ days), and the existing "Move to…" stage
  select. Clicking the name opens the profile. Empty columns show a quiet "No
  recruits" placeholder (no "Drop here" text, since there is no drag).
- **List:** the dense table: recruit (name + office), stage select, time in stage,
  license status, recruit type, orientation date, owner, communication shortcuts,
  up/down stage arrows. Sortable by name, stage, time in stage and orientation date.
  Stage filter dropdown here (and set by old stage hashes and Dashboard bars).

All stage-move behavior is unchanged: `RecruitStageControls`, `saveRecruitStage`,
blocked IDs after a failure, disabled while loading/editing/saving.

### Recruit profile

Same content and editor flow, laid out in panels: a header row (avatar, name,
office / stage, then Email / Call shortcuts, Edit recruit, Open in HubSpot); left
column panels "Current stage" (stage, time in stage, review note), "Recruiting
progress" (the five HubSpot flags) and **"Activity"** (new: this recruit's calls,
emails, meetings and tasks, newest first, view-only); right column panel "Recruit
details" plus the associated contact's phone and email when available. The embedded
editor keeps its current behavior and copy.

### Add Recruits

Same behavior, restyled into a panel. Reached from the "+ Add recruits" button.

### Inbox

One-to-one emails logged in HubSpot on recruits (my call: this is HubSpot's email
activity, not the chat/help-desk Conversations inbox, which needs separate setup).
Two panes: a list on the left (direction chip Received/Sent, counterpart name,
recruit name, subject, first line, time) and a reading pane on the right (subject,
from, to, time, recruit link, plain-text body, "Open in HubSpot"). Filters: owner,
direction, search. Window: last 90 days.

### Calls

Table: when, recruit, direction, outcome, duration, owner, first line of notes,
"Open in HubSpot". Filters: owner, direction, outcome; period toggle as on the
Dashboard. Recording links are not shown (my call; open the call in HubSpot).
Window: last 90 days.

### Contacts

HubSpot contacts associated with a Recruiting ticket. Table: name, phone, email,
city/state, office and stage (from the ticket), owner, last activity date. Clicking
a row opens the recruit profile. Search and stage filter; office switch applies.

### Tasks

Owner chips across the header like the Onboard screenshot: Mine · each owner ·
Everyone ("Mine" matches the signed-in email to a HubSpot owner's email; if there is
no match it is hidden and Everyone is selected). Groups: Overdue, Due today,
Upcoming (next 14 days), Completed (last 7 days). Rows show status (not clickable),
subject, recruit, owner, due date, priority and type, plus "Open in HubSpot". A
one-line note: tasks are completed in HubSpot for now.

### Calendar

Week (default) · Day · Month, previous/next/today, and the visible date range, as
in the Onboard screenshot. Owner chips with counts filter the view. Legend: Meeting,
Task due, Orientation. Week and Day are per-day stacked lists in time order (like
the screenshot, not an hour grid); Month is a grid showing the first few items per
day and "+N more". Shows meetings, open task due dates, and recruits' orientation
dates. Data covers 30 days back to 60 days ahead; outside that range the view says
so.

### Meetings

Two sections: Upcoming (next 60 days) and Past (last 90 days). Rows: when,
title, recruit, owner, outcome (Scheduled, Completed, Rescheduled, No show,
Canceled), location, "Open in HubSpot".

### Settings (read-only)

Panels: **Offices** (Orlando, Tampa, Miami); **Stages** (the eight stages in order,
the 5-day review threshold, Completed as the closed stage); **Team** (HubSpot owners:
name and email); **Your access** (signed-in email, Editing / Recruit entry /
Read-only); **HubSpot connection** (portal, pipeline, last refresh, and an access
status row for each data type, e.g. "Emails: needs `sales-email-read`").

## Data

### Existing recruit read — unchanged except one field

`POST /api/recruits` and `readRecruitingData` stay as they are, plus one added ticket
property, `hubspot_owner_id`, so cards, the list and the Recruiters panel can show an
owner. My call: owner = the Recruiting ticket's owner, falling back to the associated
contact's owner, else "Unassigned" (Add Recruits creates tickets without an owner).
Owner lists (Recruiters panel, Tasks chips, Calendar chips, Settings → Team) include
only owners who appear on at least one recruit or recruit activity, not every user
on the shared portal.

### New activity read

A new `POST /api/activity` with the same shape of guards as `/api/recruits`: signed
in, editor allowlist, exact origin, JSON content type, empty JSON body only, no
caller-supplied filters/fields/IDs, `no-store` private headers, safe error codes,
`Retry-After` on 429. Read-only in every environment.

Server steps (all fixed endpoints and property lists):

1. Read the Recruiting tickets (reuse `readRecruitingData`).
2. Read associations in batches (v4 batch association reads): tickets → contacts,
   calls, emails, meetings, tasks; and those contacts → calls, emails, meetings,
   tasks. Activity on either the ticket or its contact counts as the recruit's.
3. Batch-read the contacts and activity records with fixed property lists, then keep
   only those inside each type's time window.
4. List owners (`/crm/v3/owners`) for names and emails.

Each record in the response carries the recruit ticket ID(s) it belongs to, so pages
can filter by office and link to the profile.

Limits, following `lib/hubspot.mjs`: manual redirects, per-request timeout, bounded
response size, strict ID and cursor checks, at most 1,000 records per activity type
(newest kept), and a `partial` flag per type when a cap or window cut records off.

**Missing access is per type, not a whole-page failure:** if HubSpot answers 401/403
for one type, the response marks that type `accessNeeded` with the scope name, and
that page shows a calm panel: "HubSpot access needed: ask the HubSpot admin to add
`{scope}` to the app." Other pages keep working.

**Text only:** email and call bodies are converted to plain text on the server
(prefer HubSpot's plain-text email field; otherwise strip tags) and capped in
length. The client never uses `dangerouslySetInnerHTML`.

**Links:** every "Open in HubSpot" link is built server-side from the portal ID and
record ID and validated on the client the way `safeHubSpotLink` does today.

**Loading:** the client loads recruits first (as today), then activity in the
background. New pages show skeletons until activity arrives; the Dashboard shows
recruit-based panels immediately and fills activity panels when ready.

### HubSpot access needed

HubSpot's scope reference lists `crm.objects.contacts.read` and
`crm.objects.tickets.read` (already granted), `crm.objects.owners.read`, and
`sales-email-read` for one-to-one email engagements. It lists no separate read scope
for calls, meetings or tasks; community reports say those are readable with
`crm.objects.contacts.read`, which must be confirmed on the first live read.

To add on **both** HubSpot apps (Production writer app `59264745` and Preview reader
app `59299825`):

- `crm.objects.owners.read` — owner names, "Mine", Recruiters panel, Team.
- `sales-email-read` — Inbox and email activity.

Until they are added, the affected pages show the access-needed panel. Nothing else
in HubSpot changes.

## Constraints

- Next.js 16 / React 19 / Node 24, no new runtime dependencies unless clearly needed.
- Existing write paths, ledgers, migrations and environment flags are untouched.
- `npm test`, `npm run check` and `npm run lint` pass; existing tests keep passing,
  with `tests/recruiting-navigation.test.mjs` updated for the new menu and aliases.
- New tests cover: route aliases; association scoping (no record without a recruit
  reaches the client); time windows and caps; per-type access-needed handling;
  HTML-to-text conversion; owner "Mine" matching; the activity endpoint's guards.
- My call: work starts from the tip of `style/control-contrast-css-cleanup` (two
  commits ahead of `dev`, keeping its contrast fixes) on its own branch in a separate
  worktree, because another session is committing in this checkout. It merges into
  `dev` only with the owner's approval, and nothing reaches `main` without it.

## Local preview (my call)

Local runs currently need Google sign-in, Postgres and a HubSpot token, none of
which exist on this machine. To check the layout locally against the screenshots, add
a fixture mode that serves made-up recruits and activity and skips sign-in. It is
active only when `NODE_ENV === "development"`, `VERCEL` is unset and
`RECRUITING_FIXTURES=1`, so `next build` and any Vercel deployment can never enable
it. Fixture names are obviously fake.

## Left to the builder

- Component and file structure (splitting `recruiting-workspace.tsx` into page
  components is expected), CSS organization, icon drawings for the new menu items.
- Exact spacing, column widths, page sizes and sort defaults within the look above.
- Whether to cache the activity read briefly on the server.
- Exact HubSpot property lists per type and how outcome IDs map to labels (unknown
  custom outcomes show as "Other").
- Whether Inbox groups messages into threads.

## To verify on the first live Preview read

- Calls, meetings and tasks read successfully with the existing contacts scope.
- Ticket → activity associations exist for current recruits (older tickets may only
  have activity on the contact).
- Response sizes and HubSpot rate limits are comfortable at today's volume.
