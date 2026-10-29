# Legacy Recruiting Live

Private recruiting workspace for Legacy Agency Partners with explicit, reviewed saves to HubSpot. The separate public proof of concept remains unchanged.

The Site access policy allows only its owner. Sites handles sign-in; read and write APIs also require a trusted identity in the server editor email allowlist. The server uses the existing Legacy Recruiting Command Center app's scoped credential for HubSpot portal 50894788, Recruiting pipeline 924992938. This shared credential does not enforce each viewer's HubSpot seat permissions. Adding coworkers requires deliberate Site audience and server allowlist changes.

## Data contract

POST /api/recruits requires same-origin JSON with body {}. Caller-selected URLs, accounts, pipelines, properties, and filters are rejected. GET does not read CRM data.

Success returns recruits, total, loadedCount, partial, fetchedAt, portalId, pipelineId. The explicit field allowlist is in lib/recruiting-config.mjs. Responses contain recruiting names, stage, office, intake status, relevant dates, boolean-or-null registration/check-in/licensing/appointment flags, and direct HubSpot record links. Email, phone, licensing identifiers, financial data, and notes are excluded.

Pagination uses 100 records per page, at most ten pages. Counts and partial results are explicit. Missing flags are unknown, not false; intake status does not verify a license. Review suggestions use five or more days in an open stage, not CRM tasks. No fake schedules, packet documents, carrier approvals, messages, or mutations are implemented.

Errors return error.code and error.message, optionally signInPath or retryAfterSeconds. Anonymous requests return401; cross-origin403; malformedJSON400; largebody413; wrongcontenttype415; ratelimit429 with Retry-After; unconfigured503; timeout504; providerfailure502. Raw provider messages and credentials are excluded. Responses use private/no-store and no-referrer. Refresh failures retain previous data with a stale indicator.

## Configuration and verification

Hosted secrets HUBSPOT_ACCESS_TOKEN, RECRUITING_EDITOR_EMAILS, and RECRUITING_WRITES_ENABLED are configured through Sites runtime settings. Saving requires the enabled value 'true', an allowed editor, and the DB binding. Keep writes disabled until the installed HubSpot token has crm.objects.tickets.write. Local preview uses an ignored .dev.vars. Never commit credentials or CRM snapshots. Live data is held in browser memory only, without localStorage or sessionStorage.

## Reviewed saves

POST /api/recruits/{numeric-id} accepts expectedUpdatedAt, expectedValues, requestId (UUID), and changes. expectedValues and changes must contain the same supported keys. The shared edit-field schema lists the 12 permitted properties; pipeline, identity, and system timestamps cannot be edited. Recruit name and ticket title are independent fields. Only changed fields are sent to HubSpot.

The server checks current pipeline, timestamp, and reviewed old values, sends one PATCH, then verifies a fresh read before reporting success. This detects prior conflicts; HubSpot does not document an atomic conditional PATCH, so another system can still change a record between the read and write. HubSpot workflows may run when properties change.

D1 stores request IDs, user/ticket IDs, payload hashes, statuses, and timestamps; it stores no recruiting field values. A unique pending-ticket index serializes app saves. Duplicate, failed, or uncertain requests do not replay PATCH. Pending requests older than 120 seconds become uncertain. Ambiguous outcomes require an explicit reload and review; saves never automatically retry. Migrations live under drizzle/ and are applied through Sites.

Run npm test, npm run check, and npm run dev -- --hostname 127.0.0.1 --port 4180. Local sign-in is simulated only by the maintained portable starter and excluded from production. Hosted access is enforced by Sites. Preserve the maintained Worker, Vite, and authentication integrations.

Unit tests use fictional fixtures and mocked HTTP responses. Actual local and hosted reads must be verified separately. Source publication uses the Sites workflow and the identity in .openai/hosting.json.
