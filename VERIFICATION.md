# Vercel migration verification — 2026-10-29

Status: user-approved editing cutover complete. Vercel Production remains the active
editor at the canonical hostname below; Preview and the Sites backup remain
read-only. Sixteen identities are configured for the expanded access rollout.
No real CRM field value was changed during verification. Individual coworker
logins have not been exercised. The expanded-account deployment is READY and
the hosted checks below passed.

## Profile actions and quick stage edits

- Contact tools moved to the right of stage list rows and profile headers in
  Call / Text / Email order. Text is present but explicitly unavailable: the live
  native Ticket menu offered Log SMS, whose empty dialog was inspected and closed
  without logging or sending. Its observed `interaction=logged-sms` route is not
  misrepresented as a sending action. The optional choice about opening that log
  versus keeping Text inactive remains unanswered at release preparation.
- Review links in the list were replaced with Up/back and Down/forward stage
  arrows. Stage cells have the eight ordered choices. New controls reuse the same
  `POST /api/recruits/:id` contract with only `hs_pipeline_stage`, its expected
  baseline, record version and a fresh request UUID. The backend, scopes, schema,
  database and account authorization were not changed.
- No optimistic stage move or automatic retry occurs. A global pending-write lock,
  disabled boundary arrows and read-only/stale-snapshot guards prevent invalid
  client actions. Conflict, denial, rate limit and uncertain outcomes retain the
  current record and require Refresh before another deliberate attempt.
- Name links open the existing profile, now with embedded edit/review/save.
  Independent review identified and fixed two draft-loss paths: global search and
  header Refresh are disabled during editing; reload of a missing edited record
  returns the missing result without replacing the displayed snapshot/draft.
  The reviewer found no remaining release blockers. Grok's request timed out and
  did not return a completed review; no successful Grok review is claimed.
- All 87 tests passed, including five stage-client tests and explicit unavailable
  Text behavior. TypeScript, lint, production build and HTTP smoke passed.
  New provider-facing stage mutations were tested with mocks; real recruiting
  records were not moved merely to exercise the controls.
- Production deployment `dpl_2tw2pagWPBCLV3VujWPDTcotxGvD` is READY from runtime
  source `e89976eb17648de9673557c023396a8b315001f0`. Hosted DOM and visual checks
  confirm five Call / unavailable Text / Email groups in the rightmost table
  cells, five eight-option Stage dropdowns, Up/back buttons and disabled Down
  buttons for Completed. There are no Review links in that list.
- Name navigation opened the correct profile. Its embedded editor has no modal
  dialog; search and header Refresh were disabled. One local Office draft was
  reviewed on that same profile, then explicitly discarded without pressing Save.
  Search and Refresh were restored, and the profile still showed Miami/Completed.
  Returning to Completed showed all five records still at stage `1416243218`.
- Fresh hosted anonymous read/edit/contact-create requests returned 401 with
  private/no-store headers. Root still redirects to sign-in, the old project
  hostname redirects to the canonical hostname, and Preview/generated URLs remain
  Vercel-protected. No credentials or environment settings changed in this release.
- Screenshots: `../../output/recruit-stage-actions-right-tools-live.png` and
  `../../output/recruit-profile-inline-editor-live.png`.

## Earlier contact entry rollout

The later eight-stage rollout below retires contact entry: the Add recruit UI is
removed and its Production flag is false. The contact-entry evidence in this
section records the earlier approved rollout, not current availability.

- Added Add recruit (`#add-recruit`) and `POST /api/contacts` for First name,
  Last name, Phone number and the user-confirmed Active 2-14 / 2-15 license flag.
  The checkbox maps to existing Contact property `licensed_2_14_2_15`, using the
  live-verified `Yes`/`No` enum. No custom property or recruiting Ticket is created.
- All 73 local tests passed, including shared PostgreSQL phone claims, concurrent
  callers, duplicate mobilephone matching, licensed payloads, wrong portal/app/scope,
  definite rejections, timed-out creates and failed database confirmation after a
  successful provider response. TypeScript, lint, production build and production
  HTTP smoke passed. Provider create/readback responses were mocked.
- Independent backend and frontend reviews found no release blocker. Grok's
  design review was reviewed independently; global phone uniqueness is not claimed.
- The user approved contact-write access. Native HubSpot build #6 deployed for
  app `59264745`, and the additional grant was completed in portal `50894788` as
  `chandler@lgcyap.com`. HubSpot confirmed the app was successfully installed.
  Existing ticket editing stays enabled; Preview and the old Sites backup remain
  read-only. No real Contact was created for testing, and no token was rotated.
- Enabled Production deployment `dpl_4j9sqsxaMLe8vXBj1B9dNvs3ritQ` is READY from
  the same reviewed runtime source `129b6f0f3af5307eb784f8cdf55d5d819870cd0a`.
  `RECRUITING_CONTACT_CREATION_ENABLED=true` is Production-only. After the grant,
  live Refresh showed Contact entry enabled and an enabled Save contact button.
  That capability requires the actual server token's portal/app/contact-read/write
  metadata checks to pass. Real provider create/confirmation was not exercised.
- Prepared Production deployment `dpl_BkrZVLBpZVtLFquAD7S9PnE9RZFP` is READY
  from source `129b6f0f3af5307eb784f8cdf55d5d819870cd0a`. Its four-field page was
  inspected live; the license checkbox toggles correctly and Save contact stays
  disabled. Recruits still shows five records with Editing enabled. Anonymous and
  forged-identity contact POSTs return 401; GET returns 405, all private/no-store.
  The former Vercel hostname still redirects 307 to the canonical hostname.
- Migration 0002 was applied to the Production Neon database using three separate
  additive statements because the Vercel query editor rejects multiple prepared
  statements. Catalog verification confirmed the eight metadata columns, durable
  key table, and unique phone index retaining pending/created/duplicate/uncertain
  claims. Both new tables had zero rows. The query editor was returned to read-only.
  Migration SHA256: `7bd46dd090dfdf7a8246a9dac6efa75acaf0df282bf1ee295b7139de6c3499e2`.
- The prepared deployment and disabled-state checks above preceded the approved
  native app upload/grant and enabled deployment. They remain historical evidence.
- The authenticated HubSpot browser identity was verified as
  `chandler@lgcyap.com` in portal `50894788`. The separate ChatGPT connector still
  lacks contact-write and USER_INFORMATION; it is not used as the app credential.

## Native call and email shortcuts

- Recruits list phone/email icons are immediately before the initials and name.
  Both use the exact recruiting Ticket's validated fixed-portal HubSpot URL.
  Phone opens the record for its native Call control. Email adds only the
  `interaction=email` query observed while opening the real Ticket email composer.
  No speculative call query, direct dialing, mail client navigation or sending API
  was added. No extra Contact/association reads or values enter the app dataset.
- Native Ticket email composition was inspected live with Send disabled; its
  empty composer was closed without sending. The native Contact Call menu and
  options window were inspected without selecting a phone number or pressing Call.
  One built-in refresh resolved an initial options-window loading error. The
  options window still uses the record's base URL, so no call deep link is claimed.
- All 77 local tests pass, including four URL/identity/interaction security tests.
  TypeScript, lint, the production build and production HTTP smoke passed.
- HubSpot's native calling UI reported that the inspected recruiting Ticket needs
  an associated Contact before calling. Five exact-name Contact candidates were
  found for the five currently loaded recruiting Tickets; the proposed links were
  presented for explicit identity confirmation. The user approved all five links.
  Existing Contacts were selected by the verified emails of the approved IDs in
  HubSpot's native association picker, without changing Contact property values
  or adding association labels. Independent MCP association reads confirmed one
  exact approved Contact for each of the five Tickets. Names alone were not used
  as authorization to associate records.
- Native HubSpot login, user permissions, connected inbox and calling settings
  apply. Opening these shortcuts is not proof of a completed communication or of
  its final activity associations. No call was placed and no email was sent.

## Today consolidation and typography

- Follow-up is part of Today, with the complete office-filtered review list,
  count, statistics and Coming up retained. The separate menu item/page and old
  three-row truncation/View all link were removed. Existing exact `#follow-up`
  links normalize to `#today`, with Today navigation and focus handling preserved.
- Typography uses the Apple system font stack and installed Segoe UI Variable
  on this Windows computer, plus standard fallbacks. Body/headings/controls use
  coherent weights, spacing, optical sizing and smoothing. No fonts were downloaded
  or bundled; black/gold colors, keyboard focus and responsive structure remain.
- Source-only independent review found no practical navigation blocker. Grok's
  text review was independently assessed; speculative changes to business-rule
  overlap and undocumented hash variants were not adopted. Key body, muted and
  gold text colors retain contrast ratios of 17.53, 9.35 and 9.42 respectively
  against the canvas, subject to the same rendering/platform limits as before.
- All 77 existing tests, TypeScript, lint, production build and HTTP smoke passed.
  No font-only unit tests or fictitious CRM records were added for verification.
- Production deployment `dpl_2v96gWhWNgj3Z2xqnvf7nHoHJ8tC` is READY from runtime
  source `1ba2bc277027ab6c20ab72adce149ce58aa00d0c`. The canonical live app was
  reloaded and visually inspected: Today, Recruits, Contracting and Add recruit
  are the four menu items, Follow-up is on Today, and visiting `#follow-up`
  normalizes to `#today` with Today highlighted. Computed font family and heading
  weights match the reviewed stylesheet. Final screenshot:
  `../../output/today-followup-apple-style-font.png`.
- On this deployment, Add recruit still shows Contact entry enabled, the license
  checkbox and enabled Save contact. Clicking the deployed Cristian Email link
  opened the exact HubSpot Ticket with `interaction=email` and a native Email
  composer. Its Send control was disabled; the composer was closed without
  sending. No real Contact was created and no call was placed for verification.
- Anonymous root requests redirect to sign-in; anonymous recruit-read and
  contact-create POST requests return 401 with private/no-store responses. The
  former project hostname still redirects 307 to the canonical hostname, while
  Preview and the generated deployment URL retain Vercel authentication.

## Eight Recruiting stages

- The user confirmed these are the Recruiting ticket pipeline stages, not Contact
  lifecycle values. Native HubSpot identity was reverified as `chandler@lgcyap.com`
  in portal `50894788`. The connector's separate write grant remains unavailable;
  the existing-pipeline editor was operated through the authenticated native UI.
- Before editing, a full pipeline-scoped read returned five of five tickets, all
  at stage `1416243218`; the native editor also showed zero tickets in each of
  the two omitted stages. Their permanent removal was explicitly approved.
- The native editor saved exactly this order and showed Success: Recruits
  (`1473225367`), Phone Interview (`1473225368`), Orientation (`1416243212`),
  Licensing (`1416243213`), Contracting (`1416243216`), Transfers (`1416243214`),
  Training (`1416243217`), Completed (`1416243218`). The first seven are open;
  Completed remains closed. A separate connector property read confirmed the
  exact eight IDs/labels and the retired options' absence. Support Pipeline was
  not modified. No ticket stage ID or Contact lifecycle property was changed.
- All stages and Add recruit are removed from the app UI. Each new page filters
  by its exact shared live stage ID; Contracting no longer groups other stages.
  Existing Add recruit links go to Recruits. Detail navigation follows the
  actual stage, and unmapped records have explicit review links. The sidebar
  scrolls on short screens. Typography and black/gold branding are retained.
- Production contact creation was disabled through its existing dedicated flag;
  ticket editing, session policy, Preview and the Sites read-only backup remain
  configured as before. Retained contact ledgers and app scopes were untouched.
- Independent source review found no blockers. Grok reviewed migration risks;
  count/ID preservation and deletion confirmation were verified independently.
- A fresh post-save full pipeline read confirmed five tickets, all still at the
  same Completed stage ID. Reloading HubSpot retained the eight saved rows/order.
- All 81 tests pass, including exact-stage navigation and accepting new stage
  IDs/rejecting retired or foreign stage edits. TypeScript, lint, production build
  and the actual production HTTP smoke passed without real CRM writes.
- Production deployment `dpl_A35aPMgmjekMj71PX7AdNeeuvsFs` is READY from runtime
  source `b1c4b73deef5a73ad030b5b96c84c5a7d8b4c94a`. All eight hosted page headings
  and active navigation states passed after waiting for React rendering. Completed
  has five rows; each other stage has zero. The list still has five phone and
  five email shortcuts. All stages and Add recruit controls are absent.
- Hosted detail navigation highlights/returns to Completed. The editor contains
  exactly the eight ordered stage options and Review changes is disabled without
  edits; it was closed without saving. Old `#add-recruit` normalizes to `#recruits`
  and exposes no Save contact control. No real record edit was used for QA.
- Fresh anonymous read/edit/contact-create POSTs return 401 with private/no-store
  headers. Unsupported edit PATCH returns 405. Root still redirects to sign-in,
  the old domain redirects to the canonical domain, and Preview/generated URLs
  retain Vercel authentication protection.

## Canonical hostname and expanded account access

- Canonical Production: `https://lgcyap-crm.vercel.app`.
- The former project domain `https://legacy-recruiting-private.vercel.app` returns
  a 307 redirect to the canonical hostname. Production's exact BETTER_AUTH_URL and
  registered Google callback use the new origin; cookies remain host-only and a
  new-host login is required. The same Production database and ledger are retained.
- Expanded-account Production deployment: **`dpl_dxpmcjiFg8bTGDfwDDByDgYGje3d`**
  is READY from source `c203c14c2e0ab4f3b049f5c57106ea9d0d67c9d9`.
- After deployment, anonymous root requests redirect to Google sign-in; the sign-in
  page returns 200 with no recruiting data. Anonymous read/edit requests and forged
  identity headers return 401, with private/no-store responses. The anonymous
  session endpoint returns null. Preview and the generated deployment URL still
  require Vercel authentication. The old Production hostname still returns the
  configured 307 redirect, preserving the requested path and query.
- Google consent remains in Testing, and all sixteen approved test-user identities
  were saved. Production's main email list contains all sixteen approved addresses.
  GOOGLE_PERSONAL_EMAILS contains only the three exact approved Gmail addresses.
  GOOGLE_EXTERNAL_EMAILS contains only `carlos@fam1life.net`; this is an individual
  exception and grants no other `fam1life.net` account access.
- The exact external Google identity must have a verified email. It may have an
  external Workspace claim or no Workspace claim. Company accounts still require
  the configured `lgcyap.com` Workspace claim. Removing an external exception denies
  its existing session on its next app request while that company domain remains
  configured; Gmail exceptions and the main email list are also rechecked.
- Existing owner Gmail sign-in on the new hostname was tested, and its session
  still loads all five HubSpot recruits with Editing enabled after deployment.
  That evidence does
  not establish successful first login for each coworker; their credentials were
  not requested or used, and individual coworker logins remain untested.
- The expanded policy passed all 58 tests, TypeScript, lint, the production build,
  HTTP smoke, and independent review. Tests cover exact external exceptions with
  absent/different hosted-domain claims, unverified/unlisted identities, invalid
  exception configuration, chooser behavior, and existing-session revocation.
- Production stays write-enabled with the approved writer credential. Preview and
  the Sites backup remain read-only; this account/hostname rollout does not create
  another writer or perform a field-changing HubSpot test save.

## Earlier three-account rollout evidence

- Production deployment `dpl_7V6DPKkD7t1LKFwzU9YUWMaKryJf` is READY from source
  `b2c5900cd9673e3a287a13571782ceded2cc9f9d` with the reviewed account-policy change.
- Production's exact list is `chandler@lgcyap.com`, `chandlerms@gmail.com`, and
  `sarah@lgcyap.com`. The only `GOOGLE_PERSONAL_EMAILS` exception is
  `chandlerms@gmail.com`; Workspace-domain checks still apply to work accounts.
  Google Testing audience visibly lists all three identities.
- A fresh real login selected `chandlerms@gmail.com`, completed Google's basic
  profile consent, and loaded all five records with Editing enabled. It passed
  before the extra Vercel gate was changed, then read access was refreshed afterward.
- Sarah's Google test access and app authorization are configured. Her credentials
  were not requested or used, and her actual Google login has not been exercised.
- All 52 tests, TypeScript, lint, production build, HTTP smoke, and independent
  code review passed. Tests use the installed Google provider and cover exact Gmail
  exceptions, unapproved/unverified identities, wrong/missing Workspace claims,
  invalid exception configuration, chooser behavior, and immediate denial of an
  existing Gmail session when its exception is removed.
- Google's cryptographic/provider verification, exact origin/CSRF boundaries,
  password-disabled and account-linking-disabled settings remain unchanged.
- Vercel now uses Standard Protection (`prod_deployment_urls_and_all_previews`):
  the Production domain reaches the app's Google sign-in without a Vercel account;
  Preview and generated Production URLs remain Vercel-protected. No team Viewer
  invitation, new infrastructure access, or additional paid seat was created.
- Live anonymous checks: Production `/` redirects to `/sign-in`, sign-in renders
  with no recruiting data, record read/update POSTs return 401, and responses retain
  no-store. Forged Sites identity headers also return 401. Anonymous get-session
  returns null. Preview and the generated Production URL still redirect to Vercel auth.
- Grok's separate access review did not return; the independent code review and
  automated/live checks above completed. No real CRM field values were changed.

## Editing cutover evidence

- Production deployment `dpl_BeHLaCboe7ZcMAeH4f34b33ZWzvj` is READY from reviewed
  source `7cb26b06e3bb3ea2342124a9d77a04372342e9a2`. Production alone has the approved
  writer token and `RECRUITING_WRITES_ENABLED=true`; Preview retains the reader
  token and false flag. Actual UI shows Editing enabled and five recruiting records.
- HubSpot's token-information endpoint returned 200 and confirmed portal `50894788`,
  writer app `59264745`, and granted tickets-read, tickets-write, and contacts-read scopes.
  No token was rotated or new HubSpot write scope granted during this cutover.
- The old Sites app first deployed with its write flag false. Its final backup
  deployment `appgdep_6ae37181a1fc8191ac2e8ea47f2ed6c1`, saved version 3, uses
  source `f2c22818aca1d41aa57ac54800c30a62c30ec376` and environment revision 5.
  That version installs the persistent D1 BEFORE INSERT trigger
  `recruit_write_cutover_fence`, and the runtime uses the read-only reader token.
- The published archive includes the exact trigger migration and Drizzle journal.
  Publication succeeded; authoritative full ledger reads after publication and
  after enabling Vercel found zero old rows, no pagination, and no truncation.
  The trigger rejects new claims even from delayed old Worker requests. Existing
  claims cannot be hidden because the inspected old save code never deletes rows.
- Old-app tests: all 35 passed, plus typecheck and the official Sites build helper.
  Actual SQLite/Drizzle tests verify INSERT OR IGNORE rejection before any provider
  call, preserved history/schema/indexes, completion of preexisting claims, and
  explicit future DROP TRIGGER rollback. No live synthetic old ledger rows were added.
- Production's editor allowed review of a local draft and enabled Save to HubSpot.
  The draft was discarded without clicking Save. The backup and Preview both
  continued showing read-only and five records.
- A direct backend integration check used the actual approved Google user's ID,
  actual production PostgreSQL ledger, writer credential, fresh recruiting data,
  and a same-value request. saveRecruit returned saved/unchanged:true, performed
  exactly one provider GET, and persisted one saved metadata row. A test fetch guard
  forbade every non-GET provider request; zero mutations were attempted and zero
  pending/uncertain PostgreSQL rows remained. This check did not exercise HTTP auth;
  that was separately verified through real browser login and hosted access checks.
- Anonymous requests to the enabled Production read/update APIs still returned 401;
  pages required Vercel authentication and responses retained no-store headers.
- Actual field-changing HubSpot PATCH sync was not tested against an arbitrary live
  recruit. Its permission is live-verified; the sparse PATCH/confirm behavior remains
  covered by the existing mocked integration tests. No CRM field values were changed.

## Earlier read-only setup evidence

- Vercel project `legacy-recruiting-private` is on the user-approved Main Team Pro plan.
  Deployment protection remains enabled for all deployments.
- Stable Preview: `https://legacy-recruiting-preview-main-team8.vercel.app`.
- Stable Production: `https://legacy-recruiting-private.vercel.app`.
- Final reader deployments are `dpl_Brt6mJtdiH4nMY7iUUPmGCPVuVUJ` (native Preview
  API target `staging`) and `dpl_8bLHRSmNzJjhwhgUEQdqR7TyPASf` (Production), both READY
  from source `3846e7636da14d4e15eed7b32ee1c2ab37dadddb`. These were the initial
  read-only builds; the current Production account-policy deployment is listed above.
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
- Both hosted environments read portal `50894788`, Recruiting pipeline `924992938`: five loaded
  records, no partial result. All five are in `Complete - Active`, so Today correctly
  shows zero active recruiting records. Recruits shows all five.
- Recruit detail and editor previews work. A local unsaved office draft could be
  reviewed in Production, but Save to HubSpot stayed disabled. The draft was
  discarded, and a fresh read confirmed the HubSpot value remained unchanged.
- Preview sign-out removed its database session. Production sign-out returned to
  sign-in and a fresh page required login again; subsequent Google login passed.
  Anonymous page/session GET requests redirect to Vercel auth, while anonymous
  record read/update POST requests return 401 with no-store headers on both hosts.
- The user approved and installed `Legacy Recruiting Vercel Reader` (`59299825`)
  with only tickets-read, contacts-read, and basic-account scopes. Its read-only
  token replaced the temporary Preview credential in project settings and is used
  by both final deployments. Current HubSpot secrets are server-only sensitive
  variables. The original writer token was not rotated. Superseded deployment
  snapshots retain their original environment settings and stay Vercel-protected;
  the stable aliases now point to the new read-only builds.
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

## Remaining validation and coworker rollout

Further coworkers require explicit Google-email authorization and Google test-user
access for Production. The requested Sarah identity is configured; her first real
login still needs confirmation from her account. A real unapproved Google-account
login was not exercised; denial rules are covered by installed-provider integration
tests and hosted anonymous/forged-identity checks. No paid seats were purchased.

An actual field-changing save can be checked on a user-chosen record/value. No
arbitrary real recruit was edited for QA. Keep the Sites backup read-only and do
not restore its writer flag or drop its D1 fence while Vercel accepts edits.

## Existing app retained as backup

The original Sites app remains available at its existing private URL and preserves
its data, save history, and owner-only access. The authorized cutover changed its
write flag, replaced its runtime writer credential with the reader, and added only
the append-only D1 fence migration and verification tests/documentation. Its source
is clean at `f2c22818aca1d41aa57ac54800c30a62c30ec376`. The public demo and DNS are
unchanged. See README for explicit fenced rollback requirements.
