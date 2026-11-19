# Monthly signed-in recruit Google Sheets

The user requested the same Google Sheets behavior for signed-in recruits: native monthly MM-YY Sign-Ins files in chandler@lgcyap.com's Drive/Sheets, Monday–Sunday weekly tabs clipped to the month, daily 9 am Eastern repair plus automatic new-sign-in updates. Reuse the existing offline Google Sheets connection and its owner-only authorization.

Export one row per sign-in note, including repeats and imported event lists, so attendance is not lost. Match the sign-in view's Name, Phone, Email, Office, Signed in, How they heard, License and source fields. Also include stable sign-in ID, imported status, current stage, person's total/first/latest sign-ins, application time and HubSpot recruit link. No application answers or ID images are copied into this report.

Use complete HubSpot attendance reads with keyset pagination and strict completeness checks. An incomplete source never replaces a workbook. Keep separate report namespaces/month tables/leases, so Applications and Sign-Ins cannot overwrite each other's files or starve each other at the minutely cron boundary. Share the proven deterministic monthly writer and per-month repair/retry mechanism. Show the report link and sync status under Event Attendance, with Google connection/manual sync available to Chandler.

The sign-in site is outside this checkout. Minutely HubSpot checks detect newly indexed sign-ins; provide an optional authenticated notification endpoint for immediate reconciliation. Do not claim an external webhook is installed. Google consent remains required before either report can be active.
