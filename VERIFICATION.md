# Preparation verification — 2026-10-29

Status: source prepared and locally tested. Not deployed to Vercel; no cutover.

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
rejected password/cross-origin requests. No real Google account was signed in.

PostgreSQL ledger tests execute actual SQL constraints across separate ledger
instances. Mocked HubSpot requests cover sparse edits, conflict checks, duplicate
suppression, ambiguous outcomes, and no automatic PATCH retry. HTTP smoke tests
confirm the built app rejects anonymous and forged callers without CRM calls.

## Still required before release

Actual Google OAuth callback, hosted PostgreSQL connectivity/pooling, Vercel Preview
and Production runtime behavior, and a deliberately approved HubSpot save require
credentialed integration checks. No Vercel project, OAuth client, or hosted database
has been provisioned. No real recruiting record was changed.

## Existing app preserved

The original `legacy-recruiting-live` checkout remains clean at base commit
`c9ff3a9c8cba63dd47adabd0f3696d96e0faf546`. This work used only the separate
`codex/vercel-migration` worktree. No Sites deployment, live access setting,
production environment variable, or DNS change was made. See README for explicit
disable/drain/reconcile cutover and rollback instructions.
