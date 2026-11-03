# CRM version switch

- Version 1 (`/`) is the existing HubSpot CRM. Its workspace component and APIs are unchanged.
- Version 2 (`/v2`) frames the uploaded LGCY Onboard app at `/v2/app`. The tabs are outside the document, so the existing CRM CSS cannot affect the supplied layout.
- `vendor/lgcy-onboard/` is the complete, byte-for-byte source from `lgcy-onboard-vercel.zip` (45 files). Do not port or redesign its UI.
- ZIP SHA-256: `F4425105A0A7E025D289D2F9DFBA3EC05D0EB18B96BE42559D2581CF16422181`. Git attributes preserve its original bytes on Windows and Linux.
- Both use the existing approved Google sign-in. Source team members retain source roles; newly approved logins receive a basic recruiter profile. Inactive source members are denied. Internal source sessions exist for one request and never reach the browser.
- V2 uses the original versioned JSON record in the `onboard` PostgreSQL schema. It does not import HubSpot records, call HubSpot APIs, or receive HubSpot credentials. `ONBOARD_DATABASE_URL` selects a separate database when supplied; otherwise the existing database is used with the uploaded app's separate schema.

## Hosting adapter

`scripts/build-onboard.mjs` bundles the original TypeScript server and embedded HTML/SQL without editing the vendor files. `lib/onboard-host.mjs` namespaces browser API/assets under `/api/v2` and `/v2/brand`, routes sign-out through the shared CRM sign-in, and bridges the verified user to the source's own membership check. No layout, styles, controls or application state logic are rewritten.

The original public application is available at `/v2/apply`; original `/apply/*` links redirect there. The source's optional Google callback is routed to V2. V2 integration values must be supplied explicitly as `ONBOARD_GOOGLE_*`, `ONBOARD_MAIL_*`, `ONBOARD_TEAM_CALENDARS`, `ONBOARD_INDEED_INBOX`, etc. V1's Google login/email credentials are never inherited. Optional email, Google Calendar and Indeed integrations remain unconfigured unless those values are set. No new cron is enabled.

## First-load recovery

The host mounts the iframe after client hydration and shows a loading message until the original app has rendered its signed-in workspace. A failed or stalled startup recreates only the embedded frame (at most three attempts, 15 seconds per attempt). Recovery stops permanently once the app is ready, so it never reloads over subsequent edits. Leaving Version 2 cancels pending startup work. Persistent failures show a retry button instead of a blank page. All of this lives outside the uploaded document; its HTML, styles, scripts and layout are unchanged.

Regression checks cover failed initial documents, asynchronous sign-in, bounded timeouts, cleanup, and no reload after readiness. An isolated browser fixture also exercises an initial HTTP 503, a delayed document/data response, and one failed initial state request with the original uploaded app and synthetic data.

## Validation

- All 45 vendor files compared against the ZIP with SHA-256: no differences.
- Source HTML and every style block remain unchanged apart from hosting URL/sign-out changes outside the styles.
- PGlite integration tests exercise original schema creation, source membership, independent state persistence, optimistic concurrency conflicts, anonymous/origin rejection, and internal-session cleanup.
- Production HTTP smoke checks include both version pages and V2 APIs, with anonymous/forged credentials and no real provider credentials.
- Final full suite: 326 tests passed; lint, type checking, production build, and HTTP smoke passed. Desktop (1440px) and mobile (390px) source UI checks passed; a synthetic candidate was saved/reloaded against browser-mocked V2 endpoints. No live recruiting records were used or changed in QA.
