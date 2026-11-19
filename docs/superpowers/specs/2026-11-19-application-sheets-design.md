# Application Google Sheets sync

Approved in chat: one native Google Sheet per month named MM-YY Applications, weekly Monday–Sunday tabs clipped to that month, each application and its answers with HubSpot links, a current-month link under Applications, and daily refresh at 9 am America/New_York. Keep access limited to chandler@lgcyap.com initially.

Use the existing HubSpot application-note reader as the authoritative source. The submission site is external to this repository: automatically detect newly indexed submissions every minute, and provide an authenticated notification endpoint for a submission service to request an immediate reconciliation. Do not imply that a notification has been installed in the external site. Daily reconciliation refreshes current recruiting stages and repairs managed sheet cells. Both triggers use the same idempotent, serialized sync.

Google Drive's chat connector is connected as Chandler, but it does not grant the deployed CRM background Google access. Add a separate owner-only Google OAuth authorization with offline access and drive.file scope, using the existing OAuth client. Bind state to the signed-in owner and browser, encrypt refresh tokens at rest, and verify Google's account email before saving. Google consent requires the account owner. Reuse the existing /api/auth/callback/google redirect with a distinct application-sheets. state prefix; no additional redirect registration is required.

Create and recover monthly files using Drive appProperties, persist their IDs and source fingerprints in Postgres, and write literal string cells atomically using Sheets batchUpdate. Refuse partial HubSpot results; do not duplicate rows on retries. Every source submission has its own note ID. Weekly tables include all application questions as columns, plus stable summary and HubSpot fields. Do not grant anyone else access or publish the files.

Alternatives: a chat automation cannot receive submission events reliably or provide an app-owned connection; Apps Script would introduce a separate runtime and still need submission integration. The app-owned Google API connection reuses the CRM database and Vercel scheduler.
