# Monthly Sign-Ins Google Sheets

Open **Event Attendance** and its **Monthly sign-in Sheets** panel. The report uses the same chandler@lgcyap.com offline Google connection as Applications. If already connected, the Sign-Ins cron starts automatically after deployment; otherwise choose Connect Google Sheets once and approve the account's file access. Starting consent here returns to Event Attendance and starts its first Sign-Ins sync. Native Google Sheets files are visible in both My Drive and Google Sheets; no extra sharing grants are added.

Every Eastern calendar month has a separate `MM-YY Sign-Ins` file with Monday–Sunday weekly tabs clipped to the month. Every sign-in note gets a row, including repeat visits and imported event lists; imported records use the original event date. Source note IDs make retries deterministic rather than appending duplicates.

Columns: sign-in ID, name, phone, email, office, signed-in timestamp in Eastern, event date, how they heard about the event, license, sign-in source, imported-list indicator, current recruiting stage, verified person's total/first/latest sign-ins, application timestamp and HubSpot recruit link. If the sign-in is not linked to an identified recruit, personal aggregate counts/dates stay blank rather than being inferred from an email address. No photo ID images, application answers or mail bodies are exported.

## Automatic updates

`/api/cron/sign-in-sheets` checks HubSpot every minute and updates changed sign-in records. It also performs a full managed-cell repair starting at **9 am America/New_York**, with daylight-saving handling and per-month progress/retries later that day if a provider fails. Newly visible sign-ins do not require a browser to remain open. HubSpot indexing latency applies.

Applications and Sign-Ins use different monthly tables, Drive markers and job leases, so one cannot overwrite the other's file or monopolize the minutely schedule. They share only the authorized Google account token and common tested writer. Migration `0016_sign_in_sheets.sql` initializes on authorized use and stores report state, not raw attendee records.

The strict attendance source walks ID-keyset pages beyond the dashboard's display cap, validates requested note bodies and totals, verifies omitted association rows with individual reads, follows association continuations, and rejects partial/error responses before replacing any cells. A note linked to multiple recruiting tickets uses one deterministic primary ticket while preserving its one sign-in event.

## Optional immediate notification

The external sign-in site can POST `/api/event-attendance/sheets/notify` after writing its HubSpot note, authorized with a separate 32+ character `SIGN_IN_SHEETS_NOTIFY_SECRET` configured in both servers. No attendee body is needed. This optional hook is not installed in the external deployment by this change; minutely source checks work independently.

Google setup, offline permission, Google Drive/Sheets API enablement and token rotation follow [Applications Sheets setup](application-sheets.md). Do not edit the managed table columns directly; daily repair replaces them. Independent manual work belongs on a separate tab. The current-month link is shown only after a successful write. Missing Google authorization or provider failures remain visible in the panel.
