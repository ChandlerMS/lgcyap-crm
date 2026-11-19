# Monthly Recruits Google Sheets (signed-in recruits)

The monthly Recruits Sheets cover everyone who signed in at a hiring event (Event Attendance → **Signed in**). They use the same chandler@lgcyap.com offline Google connection as Applications, connected from the Applications page panel. The CRM no longer shows a Recruits panel (removed in 5698fda), so open the Sheets from Chandler's Drive or from Google's share email.

Every Eastern calendar month has its own `MM-YY Recruits` file in Chandler's My Drive, also visible in Google Sheets. It has Monday–Sunday weekly tabs clipped to the month. Every sign-in note gets a row, including repeat visits and imported event lists, and imported records use the original event date. Source note IDs make retries replace rows deterministically instead of appending duplicates.

Columns:

- Sign-in ID, then the name, phone, email, office, how they heard, license and source the person gave when signing in.
- Signed-in time in Eastern, event date, and whether the row came from an imported list.
- Current recruiting stage, the latest Approve/Deny decision and when it was made.
- The person's total, first and latest sign-ins, the time they applied online, and the HubSpot recruit link.
- `CRM:` columns with the recruit's ticket as it is now. These cover every field the CRM can edit (name, ticket name, office, recruiting path, licensing branch, license status, recruit type, orientation date and the progress flags), plus email, phone, recruiter, when the current stage began and when the record last changed.

The sign-in answers keep what the person entered. The `CRM:` columns follow later edits. If a sign-in is not linked to an identified recruit, the person totals and `CRM:` columns stay blank rather than being inferred from an email address. No photo ID images, application answers or mail bodies are exported.

## Automatic updates

The Recruits Sheets update **once each morning at 9 am America/New_York**, on the same schedule as Applications: `/api/cron/sign-in-sheets` is called every 15 minutes from 13:00 to 15:45 UTC, and only the first call at or after 9 am Eastern does any work. That run writes only the months with new or changed information since the last update: a new sign-in, a stage change, an Approve/Deny decision or an edit to any recruit field. Unchanged months are left alone. Changes made during the day appear the next morning. A failed morning run retries at the next 15-minute call, and no browser needs to stay open.

Applications and Recruits use different monthly tables, Drive markers and job leases, so one cannot overwrite the other's file or block the other's schedule. They share only Chandler's Google token and the common writer. Migration `0016_sign_in_sheets.sql` (with `0018_monthly_sheets_sharing.sql`) initializes on authorized use and stores report state, not attendee records.

The strict attendance source walks ID-keyset pages beyond the dashboard's display cap and validates requested note bodies and totals. It checks omitted association rows with individual reads, follows association continuations, and reads every linked ticket's current fields in complete batches. A partial read, an error response or a failed review read stops the run before any cell is replaced. A note linked to several recruiting tickets uses one deterministic primary ticket and keeps its single sign-in event.

## Sharing

Each month's Sheet is shared as an editor with sarah@lgcyap.com and carlos@fam1life.net (`SHEETS_SHARE_WITH` in `lib/application-sheets-oauth.mjs`). Google emails each of them a link when a new month's Sheet is shared. A share is made once per file and recorded, so it is never repeated. If Google refuses a share (for example, Workspace policy blocking an outside address), the rows keep syncing, and the share is retried each morning at 9 am. On the Applications page, its panel says who is still missing, and **Sync now** retries at once. Sarah and Carlos also see that panel's link and status, but only Chandler can connect or sync.

## Optional immediate notification

The external sign-in site can POST `/api/event-attendance/sheets/notify` after writing its HubSpot note, authorized with a separate 32+ character `SIGN_IN_SHEETS_NOTIFY_SECRET` configured in both servers. No attendee body is needed. It follows the same once-a-morning rule as the cron and is not installed in the sign-in site.

Google setup, offline permission, Drive API enablement and token rotation follow [Applications Sheets setup](application-sheets.md). The Sheets API is not used. Each update replaces the whole month's file, every tab and column, so keep your own notes in a separate file. The current-month link appears only after a successful write. Missing Google authorization and provider failures stay visible in the panel.

## One-off export

**Export to Google Sheets**, beside **Export CSV** on the Signed in list, still creates a separate private Sheet in the signed-in user's own Drive. It uses the popup, Google identity check, PKCE and temporary Drive file access shared with the Applications export. The selected sign-in dates, office, name search, approval status and sort order are kept in signed OAuth state, so CSV, XLS and Google Sheets exports all follow the same filtered list. It is unrelated to the monthly files.
