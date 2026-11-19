# CRM version switch

## Current Version 2: live website embed

`/v2` requires CRM sign-in and embeds `https://lgcy-onboard.carlos-831.workers.dev/`
directly. It displays that site’s deployed code and records; it no longer frames `/v2/app`.
The site manages its own authentication and may require a separate sign-in. The toolbar
provides Open in new tab for browsers that restrict embedded authentication.
The host never reads the cross-origin document or reloads it over user edits.
The GitHub title-bar link opens `LegacyAgencyPartners/LGCY-Onboard`, which owns the live
Cloudflare application (`onboard/` plus the root mockup). Updates appear here when that
website is deployed; a GitHub commit alone does not deploy it.

The Vercel port and its routes remain available for compatibility. The following sections
document that earlier integration; they no longer describe the Version 2 tab.


## Version 2 GitHub source

The Version 2 title bar opens `LegacyAgencyPartners/LGCY-Onboard/tree/main/version2`.
That folder owns the Vercel/PostgreSQL source used by this host. The repository's
original Cloudflare app remains in `onboard/`; it has a different runtime and database.
The `version2/` folder starts with the existing deployed Vercel port, preserving its
sign-in, database schema, and application behavior. This does not migrate the Cloudflare
app's newer features or records into Version 2.

- `npm run onboard:pull` imports the current GitHub `version2/` source. It refuses to overwrite local edits.
- Edit `vendor/lgcy-onboard/` and stage new files. `npm run onboard:push -- "Describe the change"`
  publishes that source to LGCY-Onboard main, refusing to overwrite a newer upstream commit.
- Commit the vendor changes and `onboard-source.json` together in this host. The lock records the
  exact source commit and SHA-256 of every file; builds fail if the local source differs.
- `npm run onboard:check` verifies that snapshot without network access or build credentials.
- Push host main using the existing Git deployment to release the pinned source. Repository updates
  alone do not automatically deploy this host; import and validate them first.

Synchronization uses the developer's existing Git authorization. No access token is embedded
in code or sent to the browser. Saved recruiting records remain in PostgreSQL and are not source code.
Shared sign-in and hosting adapters remain in `ChandlerMS/lgcyap-crm`.

- Version 1 (`/`) is the existing HubSpot CRM. Its workspace component and APIs are unchanged.
- Version 2 (`/v2`) frames the uploaded LGCY Onboard app at `/v2/app`. The tabs are outside the document, so the existing CRM CSS cannot affect the supplied layout.
- `vendor/lgcy-onboard/` is the complete, byte-for-byte source from `lgcy-onboard-vercel.zip` (45 files). Do not port or redesign its UI.
- ZIP SHA-256: `F4425105A0A7E025D289D2F9DFBA3EC05D0EB18B96BE42559D2581CF16422181`. Git attributes preserve its original bytes on Windows and Linux.
- Both use the existing approved Google sign-in. Source team members retain source roles; newly approved logins receive a basic recruiter profile. Inactive source members are denied. Internal source sessions exist for one request and never reach the browser.
- V2 uses the original versioned JSON record in the `onboard` PostgreSQL schema. It does not import HubSpot records, call HubSpot APIs, or receive HubSpot credentials. `ONBOARD_DATABASE_URL` selects a separate database when supplied; otherwise the existing database is used with the uploaded app's separate schema.

## Hosting adapter

`scripts/build-onboard.mjs` bundles the original TypeScript server and embedded HTML/SQL without editing the vendor files. `lib/onboard-host.mjs` namespaces browser API/assets under `/api/v2` and `/v2/brand`, routes sign-out through the shared CRM sign-in, and bridges the verified user to the source's own membership check. No layout, styles, controls or application state logic are rewritten.

The original public application is available at `/v2/apply`; original `/apply/*` links redirect there. The source's optional Google callback is routed to V2. V2 integration values must be supplied explicitly as `ONBOARD_GOOGLE_*`, `ONBOARD_MAIL_*`, `ONBOARD_TEAM_CALENDARS`, `ONBOARD_INDEED_INBOX`, etc. V1's Google login/email credentials are never inherited. Optional email, Google Calendar and Indeed integrations remain unconfigured unless those values are set. No new cron is enabled.

Failures the host catches are written to the server log as one JSON line, `onboard_host_failed`, with the method, the path with any application token removed, the error name, and either the error code or a plain error's message. Query strings, headers, identity and record data are left out. Errors the source handles itself still go through its own logging, unchanged.

## First-load recovery

The host mounts the iframe after client hydration and shows a loading message until the original app has rendered its signed-in workspace. A failed or stalled startup recreates only the embedded frame (at most three attempts, 15 seconds per attempt). Recovery stops permanently once the app is ready, so it never reloads over subsequent edits. Leaving Version 2 cancels pending startup work. Persistent failures show a retry button instead of a blank page. All of this lives outside the uploaded document; its HTML, styles, scripts and layout are unchanged.

The source treats any unanswered sign-in check as signed out, so the hosting layer rewrites that one check when it serves the page; the vendor files stay byte-for-byte. Only a real signed-out answer from `/api/v2/me` goes to the shared sign-in page. A server error, network failure or unreadable response replaces the page and goes through the recovery above, so an outage never looks like being signed out. A member marked inactive gets a final "access is turned off" page, which is not retried.

Regression checks cover failed initial documents, asynchronous sign-in, bounded timeouts, cleanup, and no reload after readiness. An isolated browser fixture also exercises an initial HTTP 503, a delayed document/data response, and one failed initial state request with the original uploaded app and synthetic data.

## Validation

- All 45 vendor files compared against the ZIP with SHA-256: no differences.
- Source HTML and every style block remain unchanged apart from hosting URL, sign-out and sign-in check changes outside the styles.
- PGlite integration tests exercise original schema creation, source membership, independent state persistence, optimistic concurrency conflicts, anonymous/origin rejection, and internal-session cleanup.
- Production HTTP smoke checks include both version pages and V2 APIs, with anonymous/forged credentials and no real provider credentials.
- Final full suite: 326 tests passed; lint, type checking, production build, and HTTP smoke passed. Desktop (1440px) and mobile (390px) source UI checks passed; a synthetic candidate was saved/reloaded against browser-mocked V2 endpoints. No live recruiting records were used or changed in QA.
