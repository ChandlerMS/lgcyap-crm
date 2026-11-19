# Applications export to Google Drive

Both the Applications section of Event Attendance and the standalone Applications page use the shared **Export to Google Sheets** button. It exports every matching application across all pages, using the current search, office and status filters. The server reads the latest applications again after Google consent, so an export may include newly arrived applications matching those filters. Incomplete HubSpot reads are rejected instead of silently exporting part of the list.

The Sheet includes applicant details, all question/answer sections, recruiting stage, review status and HubSpot links. Photo ID is represented by an attached/not-attached field; image files are not copied. Workbook cells are literal text, preserving phone numbers and preventing applicant input from becoming formulas.

## Google setup

Use the CRM's existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`. Enable **Google Drive API** in the Google Cloud project owning that OAuth client. Its existing authorized redirect URI remains `https://crm.lgcyap.com/api/auth/callback/google`; no new redirect URI or JavaScript origin is needed. Add `https://www.googleapis.com/auth/drive.file` to the consent screen's allowed scopes if required by the project's configuration, and allow this app through Workspace API controls when organization policy requires it.

The user authorizes identity plus `drive.file` in a popup. That scope allows the app to create and access its own files, not read the user's entire Drive. The callback checks the verified Google email against the current signed-in CRM user before reading applicant data. The file is created in that user's My Drive as a native Google Sheet. No sharing permissions are added. Normal CRM login and the separate Google Admin authorization remain unchanged.

## Security and recovery

The export flow reuses the registered callback with a distinct state prefix. State is random, bound to the CRM user and a signed, HttpOnly, Secure (HTTPS), SameSite=Lax cookie expiring after ten minutes. PKCE protects the authorization-code exchange. Only state-bearing export callbacks use this path; ordinary Better Auth callbacks still use the original handler. Tokens remain in server memory for one export and are not persisted or sent to the browser.

The CRM verifies popup completion origin and window identity. The popup also contains a result link in case it cannot communicate with its opener. Denied consent, wrong Google account, invalid/expired state, incomplete reads and Google API errors produce actionable messages. Google write requests are never retried automatically. If Google does not confirm a write, check Drive before exporting again to avoid creating a second Sheet. Each deliberate new export creates a separate timestamped Sheet.
