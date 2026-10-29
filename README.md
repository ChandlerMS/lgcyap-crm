# Legacy Recruiting — Vercel migration

Separate preparation branch for the private Legacy Agency Partners recruiting app.
The current Sites app and public demo remain live and unchanged. This checkout is
not a deployment or a cutover. Do not deploy this branch through Sites.

The black-and-gold recruiting interface, logo, read filters, twelve editable
properties, and explicit Edit → Review → Save flow are retained. Hosting changes:

- Standard Next.js 16 on Node.js 24, with Vercel Node route handlers.
- Google Workspace sign-in through Better Auth and PostgreSQL sessions.
- Explicit email authorization at sign-in and on every recruiting request.
- PostgreSQL replaces the Cloudflare D1 request ledger. No Worker bindings,
  Sites identity headers, or Sites publishing metadata remain.
- Writes require VERCEL=1, VERCEL_ENV=production, and the explicit server flag
  RECRUITING_WRITES_ENABLED=true. Local and Preview environments cannot save.
  Do not manually spoof platform variables.

## Local verification

```powershell
npm ci
npm test
npm run check
npm run build
npm run test:smoke
```

No real secrets are needed. Tests use fictional records, mocked HubSpot HTTP, and
embedded PostgreSQL (PGlite). Auth tests exercise the installed Better Auth
implementation, its generated schema, signed sessions, expiry, OAuth initiation,
PKCE, Google Workspace claim checks, and denied identities. They do not contact
Google, Neon, HubSpot, or Vercel.

The smoke command starts the production build on a temporary port with credentials
explicitly blanked. It verifies login redirects, private headers, method restrictions,
and denial of anonymous/forged identity requests. No development login bypass exists.

For an interactive sign-in page preview without credentials:

```powershell
npm run start -- --hostname 127.0.0.1 --port 4190
```

Sign-in stays disabled until configuration is complete. The setup page exposes no
recruiting records.

## Environment settings

Copy .env.example to ignored .env.local for local configuration, or enter values
directly in Vercel settings. Never paste secrets into chat or commit them. No HubSpot
credential was copied into this migration checkout.

| Variable | Purpose |
| --- | --- |
| BETTER_AUTH_URL | Exact canonical origin, no trailing slash; HTTPS when hosted |
| BETTER_AUTH_SECRET | Fresh random secret of 32+ characters, unique per environment |
| GOOGLE_CLIENT_ID | Google OAuth Web application client ID |
| GOOGLE_CLIENT_SECRET | Google OAuth client secret |
| GOOGLE_WORKSPACE_DOMAIN | Optional exact Workspace domain; blank requires any Workspace domain plus the exact email list |
| DATABASE_URL | New PostgreSQL database; a pooled Neon URL is suitable for runtime if choosing Neon |
| RECRUITING_EDITOR_EMAILS | Comma-separated exact approved Google work emails; blank denies all |
| HUBSPOT_ACCESS_TOKEN | Server-only scoped credential; never prefix with NEXT_PUBLIC_ |
| RECRUITING_WRITES_ENABLED | Default false; enable only at coordinated production cutover |

Personal Gmail accounts are denied even if listed. Only Google identity scopes are
requested; password signup and account linking are disabled. Google Workspace domain
claims and verified email are required. Sessions expire after eight hours, use
host-only secure cookies on HTTPS, and are checked against the database. Removing an
email from the deployed allowlist denies its next recruiting request. This shared
HubSpot credential does not enforce individual HubSpot seat permissions; approved
users receive the app's access.

Use distinct Preview/Production databases, auth secrets, and Google OAuth clients.
Keep the Preview HubSpot credential read-only or absent. Use a stable Preview host
for exact OAuth redirects. Do not trust wildcard *.vercel.app origins or redirects.

Run npm run preflight after configuration. It checks formats and required settings
without printing values. It does not verify live connectivity or permissions.

## Database initialization

Create a new PostgreSQL database; do not modify the live Sites D1 database. For Neon,
prefer Marketplace provisioning when the Vercel project is ready. No database was
provisioned or migrated by this preparation task. Remote TLS certificates are verified
and connection/query timeouts are bounded.

Apply migrations explicitly from a trusted local environment with the new database
URL configured. A direct provider connection is preferable for schema administration;
restore the pooled runtime URL in Vercel. Builds and requests never apply migrations.

```powershell
npm run db:migrate -- --apply
npm run db:auth:migrate
npm run db:auth:check
```

The first command applies the checked-in ledger SQL. Auth migration uses the pinned
Better Auth generator for user, session, account, verification, and database rate-limit
schema. The check returns nonzero if changes remain. Auth tables store approved user
profiles, sessions, and encrypted OAuth tokens. The recruiting ledger stores IDs,
payload hashes, status, and timestamps, without CRM field values.

## Vercel project setup

1. Export this prepared source to a separate private repository, or use the migration
   branch in a supported Git provider. Do not change the live Sites source branch.
   Import it as a new Vercel project.
2. Select Next.js, Node.js 24, and this app's directory as the project root.
   vercel.json configures npm ci and npm run build.
3. Configure Preview first, with writes disabled. Register the exact Google callback
   https://<stable-preview-host>/api/auth/callback/google and set BETTER_AUTH_URL to
   that origin. Configure Google's consent audience and internal/test access for the
   agency's chosen Workspace accounts.
4. Initialize the separate database and check its schema. Test the protected Preview
   with approved and unapproved accounts.
5. Prepare Production settings and its exact callback separately, still keeping the
   write flag false. Verify recruiting reads before cutover.

No Vercel project, OAuth client, database, DNS, or production settings were created or
changed by this branch. Business use needs an appropriate Vercel plan; Hobby is for
personal non-commercial use.

## Required integration checks

- Actual Google login permits approved verified Workspace accounts and denies others;
  sign-out revokes the current session.
- Schema and connectivity checks pass on the actual database provider, and separate
  function instances share sessions and ledger claims.
- The protected deployment reads the correct HubSpot Recruiting pipeline. The server
  credential is absent from browser assets/logs; responses stay private/no-store.
- Preview cannot save even when the write flag is mistakenly true.
- A deliberately approved production edit is verified in both app and HubSpot during
  controlled cutover. Do not change arbitrary recruits merely for QA.

## Cutover and rollback — not part of preparation

Keep the old app live during testing; its write settings remain unchanged by this
work. The apps have independent identities and ledgers and must not accept writes
simultaneously.

At an approved window, disable old Sites writes and deploy that setting while keeping
its read interface live. Confirm its API rejects saves, drain in-flight requests, and
reconcile pending/uncertain outcomes with HubSpot before opening the new writer. An
elapsed wait alone does not prove an ambiguous save failed. Do not erase ledger history
or replay old request IDs into the new database.

Then enable Vercel Production writes, deploy, and verify a deliberately approved edit.
Switch coworker links or a custom domain after acceptance. Old open tabs cannot save
because the old server checks its write flag.

For rollback, disable Vercel writes first, drain/reconcile pending requests, and only
then re-enable old writes. Never enable both while troubleshooting.

## API contract and limits

POST /api/recruits accepts only {} as same-origin JSON with an authorized session.
It returns bounded recruiting data, counts, freshness, partial status, and edit
capabilities. GET cannot read CRM records.

POST /api/recruits/{numeric-id} accepts expectedUpdatedAt, expectedValues, requestId
(UUID), and changes. Changes and reviewed old values require the same supported keys.
Twelve properties are defined in lib/recruit-edit-config.mjs. Pipeline, credentials,
contact information, and system timestamps cannot be edited. Only changed fields
are patched.

The server freshly checks pipeline, modified timestamp, and reviewed values; sends
one sparse PATCH; then confirms a fresh read. Persistent uniqueness serializes pending
saves across this app's instances. Saved duplicates do not replay PATCH; failed or
uncertain request IDs cannot retry. Pending rows older than 120 seconds become
uncertain. Ambiguous outcomes require refresh and reconciliation; no write retry is
automatic.

HubSpot does not document an atomic conditional PATCH. Other systems can still edit
a record between check and PATCH, and the HubSpot write cannot commit atomically with
the app's database. These controls reduce duplicate/conflict risk; they do not promise
universal exactly-once delivery. Changes may trigger HubSpot workflows. CRM values
remain in browser memory, without localStorage/sessionStorage persistence.

## References

- [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)
- [Git deployment setup](https://vercel.com/docs/git)
- [Google Workspace OAuth](https://better-auth.com/docs/authentication/google)
- [Better Auth migrations](https://better-auth.com/docs/concepts/database)
- [Vercel pool lifecycle](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#attachdatabasepool)
- [Neon pooling](https://neon.com/docs/connect/connection-pooling)
- [Hobby restrictions](https://vercel.com/docs/plans/hobby)
