# Legacy Recruiting Live

Private, read-only recruiting workspace for Legacy Agency Partners. The separate public proof of concept remains unchanged.

The Site access policy initially allows only its owner. Sites handles sign-in. Each API read also requires a trusted signed-in visitor identity. The server uses the existing Legacy Recruiting Command Center app's scoped credential for HubSpot portal 50894788, Recruiting pipeline 924992938. This is a shared server credential: HubSpot seat permissions are not separately enforced for dashboard viewers. Adding coworkers requires deliberate changes to the Site's audience.

## Data contract

POST /api/recruits requires same-origin JSON with body {}. Caller-selected URLs, accounts, pipelines, properties, and filters are rejected. GET does not read CRM data.

Success returns recruits, total, loadedCount, partial, fetchedAt, portalId, pipelineId. The explicit field allowlist is in lib/recruiting-config.mjs. Responses contain recruiting names, stage, office, intake status, relevant dates, boolean-or-null registration/check-in/licensing/appointment flags, and direct HubSpot record links. Email, phone, licensing identifiers, financial data, and notes are excluded.

Pagination uses 100 records per page, at most ten pages. Counts and partial results are explicit. Missing flags are unknown, not false; intake status does not verify a license. Review suggestions use five or more days in an open stage, not CRM tasks. No fake schedules, packet documents, carrier approvals, messages, or mutations are implemented.

Errors return error.code and error.message, optionally signInPath or retryAfterSeconds. Anonymous requests return401; cross-origin403; malformedJSON400; largebody413; wrongcontenttype415; ratelimit429 with Retry-After; unconfigured503; timeout504; providerfailure502. Raw provider messages and credentials are excluded. Responses use private/no-store and no-referrer. Refresh failures retain previous data with a stale indicator.

## Configuration and verification

Hosted secret HUBSPOT_ACCESS_TOKEN is configured through Sites runtime environment settings. Local preview can use an ignored .dev.vars. Never commit credentials or CRM snapshots. Live data is held in browser memory only, without localStorage or sessionStorage.

Run npm test, npm run check, and npm run dev -- --hostname 127.0.0.1 --port 4180. Local sign-in is simulated only by the maintained portable starter and excluded from production. Hosted access is enforced by Sites. Preserve the maintained Worker, Vite, and authentication integrations.

Unit tests use fictional fixtures and mocked HTTP responses. Actual local and hosted reads must be verified separately. Source publication uses the Sites workflow and the identity in .openai/hosting.json.
