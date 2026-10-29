# Vercel migration verification — 2026-10-29

Status: protected Preview deployed and tested with real Google sign-in and
HubSpot reads. Separate Production configuration is prepared; release checks
are in progress. No writer cutover or real recruiting-record edit has occurred.

## Hosted integration evidence

- Vercel project `legacy-recruiting-private` is on the user-approved Main Team Pro plan.
  Deployment protection remains enabled for all deployments.
- Stable Preview: `https://legacy-recruiting-preview-main-team8.vercel.app`.
- Real Google OAuth login succeeded for approved account `chandler@lgcyap.com`.
  Google consent remains External / Testing, with that single approved test user.
  The separate Production client also completed real login; its own database
  confirmed one approved verified user and one session.
- Separate Preview and Production Google clients use exact HTTPS callback URLs;
  session secrets are independent, server-only Vercel sensitive variables.
- Separate free Neon databases are connected only to their corresponding Vercel
  environments. Explicit ledger/auth migrations and auth schema checks passed on both.
- Actual pooled database checks confirmed Preview has one authenticated session;
  both ledgers have zero save requests and their primary/pending-ticket unique
  indexes are present.
- Preview reads portal `50894788`, Recruiting pipeline `924992938`: five loaded
  records, no partial result. All five are in `Complete - Active`, so Today correctly
  shows zero active recruiting records. Recruits shows all five.
- Preview recruit detail and editor preview work; Review changes is disabled and
  the editor states that saving is unavailable. Preview sign-out removed its
  database session. Anonymous page/session GET requests redirect to Vercel auth,
  while anonymous record read/update POST requests return 401 with no-store headers.
- The existing HubSpot static token was copied without rotation. It has write
  scope, while Preview saves remain blocked by the runtime gate and false flag.
  A separate app `Legacy Recruiting Vercel Reader` (`59299825`) is deployed with
  only tickets-read, contacts-read, and basic-account scopes. Installation approval
  is pending; its read-only token will replace the temporary credential before release.
- No arbitrary CRM records were changed, no token was rotated, and no existing
  Sites write setting, deployment, sharing permission, or DNS record was changed.
- Grok reviewed release risks. Its credential-scope concern led to preparing the
  separate reader app; local and mocked checks remain distinct from live evidence.

## Evidence

- Clean `npm ci` from the lockfile succeeded on Node 24.15.0.
- `npm test`: 46 passed, zero failures or skipped tests.
- `npm run check`: passed.
- `npm run lint`: passed, zero warnings/errors.
- `npm run build`: passed using Next.js 16.4.3 production Turbopack.
- `npm run test:smoke`: passed against the actual production HTTP server.
- Production dependency audit: zero reported vulnerabilities at preparation time.
- A further production build with synthetic private environment canaries exposed
  none of their values in `.next/static` browser assets. Better Auth's shared
  client library contains a generic secret variable name; that identifier is not
  a credential value. No real secret was used for this test.
- Browser check: branded Google sign-in screen, disabled safely while setup is
  incomplete, no browser console errors. Screenshot saved beside the source ZIP
  as `vercel-google-sign-in-prepared.png`.
- Independent code review passed after fixing and regression-testing canonical
  origin validation (including accidental trailing slashes).
- Grok reviewed migration risks; the final plan preserves one writer during
  cutover and denies writes unless explicitly enabled in Vercel Production.

## What those tests establish

Real Better Auth schema migrations and signed-session checks run against embedded
PostgreSQL (PGlite). Tests cover expiry, forged cookies/identity headers, explicit
email authorization, Google Workspace domain checks, OAuth initiation/PKCE, and
rejected password/cross-origin requests. Those preparation tests used no real Google
account; the separate hosted sign-in check above subsequently passed.

PostgreSQL ledger tests execute actual SQL constraints across separate ledger
instances. Mocked HubSpot requests cover sparse edits, conflict checks, duplicate
suppression, ambiguous outcomes, and no automatic PATCH retry. HTTP smoke tests
confirm the built app rejects anonymous and forged callers without CRM calls.

## Still required before release

Finish installing the approved read-only HubSpot connection, redeploy with that
credential, and verify Production reads. Anonymous denial and sign-out must also
be checked on the final Production deployment. A deliberately
approved HubSpot save requires coordinated cutover and a user-chosen record/value;
no save QA is authorized against an arbitrary real recruit.

## Existing app preserved

The original `legacy-recruiting-live` checkout remains clean at base commit
`c9ff3a9c8cba63dd47adabd0f3696d96e0faf546`. This work used only the separate
`codex/vercel-migration` worktree. No Sites deployment, live access setting,
production environment variable, or DNS change was made. See README for explicit
disable/drain/reconcile cutover and rollback instructions.
