# HubSpot and Vercel connection

Audited 2026-11-04 and updated 2026-11-05. Code facts come from GitHub `main` at `28b54c6`; the production address and Next.js version were rechecked on 2026-11-19 against `main` at `306cbb9`. Access changes whenever someone reconnects a connector or edits a HubSpot permission, so re-check it before relying on it.

## Goal

The owner wants this project connected to HubSpot to update the database and tie everything in with the Vercel app at https://crm.lgcyap.com. The app was already connected to HubSpot when this was written. The owner confirmed on 2026-11-05 that "updating the database" means full read and write on the HubSpot instance. Rule 1 on approval still applies until the owner says otherwise.

## Private notes

This repository is public for now (open item 4). Login details, HubSpot owner IDs, record counts, pipeline history and notes on related private work live in `CLAUDE.local.md`, which Git ignores. It exists only in the checkout at `C:\Users\Chand\Documents\GitHub\lgcyap-crm`, so read it from there when working in another worktree. Keep those details out of tracked files, commit messages and pull request text.

## Accounts

| System | Value |
| --- | --- |
| HubSpot portal | `50894788` (lgcyap.com), US/Eastern, USD |
| Vercel account | ChandlerMS (stated by the owner) |
| Vercel team and project | `main-team8`, `legacy-recruiting-private` (`prj_tAhuHcbCr3HXxant1EGPbaFLjc6E`) |
| Production URL | https://crm.lgcyap.com. `https://lgcyap-crm.vercel.app` redirects there. |
| GitHub | `ChandlerMS/lgcyap-crm`, production branch `main`. The owner wants it private, but GitHub's API still reported it public on 2026-11-05 (open item 4). |
| App stack | Next.js 16.4.6 on Node 24, Google sign-in through Better Auth, exact email allowlist |
| App database | Neon Postgres: sign-ins, save logs, sync state, imported call and sales reports. CRM records stay in HubSpot. |

## Working in this repo

- **Browser.** Use only the default Chrome on this computer. Claude's own built-in browser is also allowed if needed. On 2026-11-04 three Chrome extension instances were connected and looked identical (`Browser 1`, `2` and `3`), and `switch_browser` timed out, so do not guess among them. The built-in browser keeps its own sign-ins, and they expire. On 2026-11-04 it was signed in to the app with the account the owner used, and to HubSpot. On 2026-11-05 its HubSpot page redirected to the login screen.
- **Fetch first.** This checkout was 108 commits behind when the 2026-11-04 session began. Run `git fetch`, compare with `origin/main`, and audit from `origin/main`.
- **Branches.** The owner kept the 2026-11-04 doc work on checked-out `main` and has not set a standing branch rule.
- **Checks.** `npm test`, `npm run check`, `npm run lint`, `npm run preflight`, `npm run test:smoke`, and `node --test tests/production-source.test.mjs` when editing the main page or deployment checks. This checkout needs `npm ci` first, which also installs the Next.js guide that `AGENTS.md` points to. None of these were run for this doc.

| Checkout | State on 2026-11-04 |
| --- | --- |
| `C:\Users\Chand\Documents\GitHub\lgcyap-crm` | Used for this doc. Has no `node_modules`, `.env.local` or `.vercel/project.json`. |
| `C:\Users\Chand\OneDrive\Documents\ChatGPT\HubSpot-Front-End\sites\legacy-recruiting-vercel` | Named in `POLICYTEK-SYNC.md`. Same GitHub origin, on branch `codex/policytek-refresh-window` at `d966ce9`. |
| `C:\Users\Chand\hubspot-front-end\...` | Coordinator and worker paths in `docs/collaboration/README.md`. They do not exist on this computer. |

## Two separate HubSpot connections

Do not confuse these. They have different identities and different access.

1. **App to HubSpot.** The Vercel app uses a private-app token in `HUBSPOT_ACCESS_TOKEN`. Production uses writer app `Legacy Recruiting Command Center` (`59264745`). Preview and the old Sites backup use read-only app `Legacy Recruiting Vercel Reader` (`59299825`). Writes fail closed unless the token matches this portal, app and scopes. Every approved app user shares this token, so HubSpot seat permissions do not apply per person.
2. **Claude to HubSpot.** Claude uses the HubSpot connector on the claude.ai account. It acts as whichever person connected it, and its edits are attributed to that person. `get_user_details` shows who that is. A result from this connector says nothing about what the app's token can see, and the reverse is also true.

## What Claude's connector can do

Access depends on who connected the connector, so check instead of assuming. `get_user_details` shows the login, and `discover_hubspot_schema` shows read and write access for each object. The latest results are in `CLAUDE.local.md`.

The connector exposes no tool for creating properties or pipelines. Make those changes in HubSpot settings, then verify them with `get_properties` or `discover_hubspot_schema`.

Other tooling on this machine: the Vercel, GitHub and HubSpot CLIs (`vercel`, `gh`, `hs`) are not installed, and `vercel --prod` is forbidden by `AGENTS.md` anyway. Git reads from GitHub work without a sign-in. On 2026-11-05 `git credential-manager github list` returned `ChandlerMS`. Pushing has not been tested. No Vercel connector appears in the session's connector list. Vercel visibility needs one, signed in as ChandlerMS.

## How the app uses HubSpot

| App feature | HubSpot source | App can |
| --- | --- | --- |
| Recruiting pipeline | Tickets in pipeline `924992938` | Read, edit 14 fields, move stages through validated routes |
| Add Recruits | Contact plus associated Ticket | Create or safely reuse the Contact, create the Ticket |
| Stage mirror | Contact `recruiting_lifecycle_stage` | Two-way sync, cron every minute |
| Contract Agents | Custom object `2-64481801` | Read, edit, create |
| Contacts | Contacts | Read, edit name, phone, email, company. Contact-only creation is retained but disabled in Production (`CONTACT-API.md`), so `canCreateContact` reads false. Add Recruits uses `/api/recruit-intake`. |
| Tickets, Help Desk | Tickets (Help Desk is pipeline `0`) | Read, edit title, priority, owner |
| Tasks, Meetings, Calendar | Tasks, Meetings, filtered to the signed-in user's owner records | Read, edit |
| Calls | Calls, filtered the same way | Read only |
| Customer Success | Companies where `hs_current_customer = yes` | Read; edits need `crm.objects.companies.write` |
| Inbox | Conversations | Read only |
| Leaderboard | Deals in pipeline `default`, stage `closedwon` | Read only |
| Legacy Bot | Chat embed for this portal | The production build fails if it is removed |

**Not used by app code:** the custom Recruits object, Carriers, Carrier Appointments, Agent Performance Events, and ticket pipeline `Agent Licensing & Contracting` (`955871346`). In this app a "recruit" is a Ticket in pipeline `924992938`, not a record of the custom Recruits object. Do not write recruits to the custom object without an explicit decision to migrate.

Scopes the code checks on the writer token: `crm.objects.contacts.read/write`, `crm.objects.tickets.read/write`, `crm.objects.custom.read/write`, `crm.objects.companies.read/write`, `crm.objects.deals.read`, `conversations.read`. `HUBSPOT-TOOLS-API.md` also lists `crm.objects.owners.read` for showing owner names; without it those views stay readable with blank owners. On 2026-11-04 the signed-in app read contacts, tickets, Contract Agents, companies, conversations, calls, tasks and meetings with no permission errors, and reported ticket editing and recruit creation as enabled. The deal read and the Contract Agent and company write grants were not exercised.

## Other data sources

| Feature | Source | How it updates | More |
| --- | --- | --- | --- |
| Standard vs. Preferred calls | RingCX saved report, stored in Postgres | Cron `svp-ringcx-calls`. Workbooks apply only to ranges before the report begins, currently none. | `SVP-CALLS-IMPORT.md` |
| Lead Data | RingCX saved reports plus kept workbooks, stored in Postgres | Cron `lead-data` and `npm run lead-data:import` | `LEAD-DATA.md` |
| RingCX live desk (`/ringcx`) | RingCX | Read on request, cached 15 seconds | `docs/ringcx-dashboard.md` |
| Shopper and Source boards | PolicyTek reports, stored in Postgres | Browser bridge attached to a Codex chat, not Vercel Cron. Needs this computer awake, Codex running, Chrome connected and PolicyTek signed in. Runs 9 AM to 9 PM Eastern. | `POLICYTEK-SYNC.md` |
| WhatsApp Sales board | Monthly workbooks, stored in Postgres | `npm run whatsapp:import` | `WHATSAPP-IMPORT.md` |
| Call history in HubSpot | RingCentral Activity Sync, the sole call writer | Native RingCentral sync | `RINGCENTRAL-CALL-SYNC.md` |
| `/v2` (LGCY Onboard at `/v2/app`) | `onboard` Postgres schema | Vendored byte-for-byte in `vendor/lgcy-onboard/`. It gets no HubSpot access. Do not port or redesign it. | `docs/version-switch.md` |

The RingCX credential expires 2027-02-01 UTC and must be rotated before then (`docs/ringcx-dashboard.md`).

LGCY Onboard also exists as a separate project outside this repository. Read `CLAUDE.local.md` before changing `vendor/lgcy-onboard/` or connecting Onboard to HubSpot.

## Vercel crons

From `vercel.json`. All three require `CRON_SECRET`.

| Route | Schedule | Limits |
| --- | --- | --- |
| `/api/cron/recruit-lifecycle` | Every minute | Runs the stage mirror when `RECRUITING_LIFECYCLE_SYNC_ENABLED` is on |
| `/api/cron/svp-ringcx-calls` | Every 5 minutes | Reads only 9 AM to 9 PM Eastern |
| `/api/cron/lead-data` | Every 5 minutes | Reads only 9 AM to 9 PM Eastern |

## App database

Claude has no connector for the Neon database, and this checkout holds no connection string. Git builds do not run migrations (`README.md`), but the app applies some itself, as shown below.

| Task | Command | Behavior |
| --- | --- | --- |
| Migrations 0001 to 0005 | `npm run db:migrate -- --apply` | Without `--apply`, nothing changes |
| Migrations 0006 to 0012 | None | `db/whatsapp.mjs`, `db/svp-calls.mjs` and `db/lead-data.mjs` apply them on first authorized use, so a merged change can alter Production's schema when its route next runs. The import scripts also apply 0006, 0007, 0011 and 0012. |
| Intake and lifecycle tables | `node scripts/migrate-intake.mjs --apply`, `node scripts/migrate-lifecycle.mjs --apply` | Refuse to run without `--apply` and a Production Vercel environment |
| Auth tables | `npm run db:auth:check`, `npm run db:auth:migrate` | Managed separately from the others |
| Imports | `npm run whatsapp:import`, `npm run svp-calls:import`, `npm run lead-data:import` | Only validate without `--apply`. With it, they ask for the connection string if `DATABASE_URL` is not set. |

Tables by feature:

- Recruit saves: `recruit_write_requests`
- Contact-only creation: `contact_create_*`
- Add Recruits: `recruit_intake_*`
- Stage mirror: `recruit_lifecycle_*`
- PolicyTek: `policytek_*`
- WhatsApp Sales: `whatsapp_*`
- Standard vs. Preferred calls: `svp_*`
- Lead Data: `lead_data_*`
- LGCY Onboard: the `onboard` schema, or a separate database if `ONBOARD_DATABASE_URL` is set

## Checking the live app

- **Anonymous.** `POST /api/recruits` returns 401, and `/` returns 307 to `/sign-in`. Last run 2026-11-05.
- **Signed in.** The main data reads, such as `POST /api/recruits` and `POST /api/leaderboard`, enforce the exact app origin, so run them from a tab on `crm.lgcyap.com`. Check the tab's host first: one stray fetch on 2026-11-04 hit `app.hubspot.com` and got a harmless 404.
- **Capabilities.** `POST /api/recruits` also returns `capabilities`.
- **Baseline.** The latest counts and capability values are in `CLAUDE.local.md`. Calls, Meetings and Tasks are per signed-in user.

## Recruiting pipeline IDs

All ten stage IDs matched live HubSpot and `lib/recruiting-config.mjs` on 2026-11-04.

| Stage | Ticket `hs_pipeline_stage` | Contact `recruiting_lifecycle_stage` |
| --- | --- | --- |
| Hiring Event | `1473318768` | `hiring_event` |
| Application | `1473318769` | `application` |
| Phone Interview | `1473225368` | `phone_interview` |
| Offer | `1473318770` | `offer` |
| Licensing Reminders | `1473318771` | `licensing_reminders` |
| Licensed w/ NPN | `1473318772` | `licensed_npn` |
| Contracting | `1416243216` | `contracting` |
| Training | `1416243217` | `training` |
| Completed | `1416243218` | `completed` |
| Withdrawn | `1473318773` | Not synced |

`recruiting_path` stores `genpop` (labeled Referrals) or `mass_recruiting` (labeled Recruiters). Older docs use the GenPop and Mass Recruiting names for the same values. `licensing_branch` stores `licensed` or `not_licensed`.

Sales pipeline `default`: `closedwon` Sold, `1378710284` Underwriting, `1378710285` Follow Up, `closedlost` Not Sold— Not Interested, `1410497689` Test Call, `1410497690` Missed Call, `1410497691` New York Resident, `1410497692` Not Sold — Health Declined, `1410497693` Wrong Number— Non Life.

## Rules for changing data

1. **Approval.** Until the owner sets a different policy, show exactly which records and fields will change, get approval, apply the change, then read it back to confirm it. Deletes and bulk changes always need approval.
2. **Stage moves.** Prefer the app, which validates the branching stage graph. Direct HubSpot edits bypass that validation.
3. **Stage mirror.** Change a recruit's stage on the Ticket or the Contact, never both. If both sides change, the sync pauses for review instead of choosing a winner. See `RECRUIT-LIFECYCLE-SYNC.md`.
4. **Sales lifecycle.** Never touch Contact `lifecyclestage` for recruiting. It belongs to the insurance sales process.
5. **Workflows.** Any edit can trigger HubSpot workflows, so say so before bulk changes.
6. **People with the same name.** Match owners by owner ID or email, never by name alone. Some active owners in the portal share a name. The IDs are in `CLAUDE.local.md`.
7. **Test records.** Do not create test records in production without approval. Use the fixture pattern in `docs/drag-drop-all-stages-verification-2026-11-03.md`. `scripts/verify-lifecycle-live.mjs` runs only with `--approved-test` in a Production build, and it archives only the fixtures it created.
8. **Single writer.** Vercel Production is the only writer. Preview and the Sites backup stay read-only. See `README.md` before changing this.
9. **Deployments.** Production ships only by landing on `main` through the Vercel Git integration. See `AGENTS.md`. Pushing to `main` deploys, so treat a push as a production release.
10. **Secrets.** Never put tokens, environment values or customer records in code, docs, chat or logs. Variable names are fine. The repository is public for now, so anything pushed can be read by anyone and stays in Git history. Use a role instead of a staff email where a role works.
11. **Other agents.** Codex also manages HubSpot in some instances, so re-read a record right before changing it and do not assume Claude made the last edit.

## Write gates

Production's values cannot be read from Claude without a Vercel connector, but `capabilities` shows their effect.

| Variable | Effect |
| --- | --- |
| `RECRUITING_WRITES_ENABLED` | Saves need this set to `true`, plus `VERCEL=1` and `VERCEL_ENV=production`. `npm run preflight` fails if it is `true` in Preview. |
| `RECRUITING_CONTACT_CREATION_ENABLED` | Production only, and needs writes enabled. It stays `false` while contact-only creation is retired. |
| `RECRUITING_INTAKE_ENABLED` | Gates Add Recruits, on top of the write requirements |
| `RECRUITING_LIFECYCLE_SYNC_ENABLED` | Gates the stage mirror, on top of the write requirements |
| `RECRUITING_EDITOR_EMAILS` | Exact email allowlist. Empty denies everyone. |
| `GOOGLE_PERSONAL_EMAILS`, `GOOGLE_EXTERNAL_EMAILS` | Sign-in exceptions. Each entry must also be in `RECRUITING_EDITOR_EMAILS`. |

## Environment variables missing from `.env.example`

The code on `main` reads these, and `.env.example` does not list them: `CRON_SECRET`, `ONBOARD_DATABASE_URL`, `POLICYTEK_SYNC_SECRET`, `RECRUITING_INTAKE_ENABLED`, `RECRUITING_LIFECYCLE_SYNC_ENABLED`, `RINGCENTRAL_CLIENT_ID`, `RINGCX_CLIENT_ID`, `RINGCX_CLIENT_SECRET`, `RINGCX_JWT`.

## Recruiting pipeline state

Zero recruits in the app is not automatically a fault. Read the pipeline state in `CLAUDE.local.md` before raising it as one or restoring anything.

- **Recovery.** HubSpot's ticket recycling bin is at `/recycling-bin/50894788/restore/0-5`. Deleted tickets are recoverable for 90 days, according to `docs/drag-drop-all-stages-verification-2026-11-03.md`. HubSpot's help page gives 90 days for HubSpot-defined records but does not name tickets. Do not restore tickets unless the owner asks. Never use the bin's "Delete immediately" links, which skip that window.
- **Adding the same people again.** `lib/recruit-intake.mjs` keeps its phone and email claims after a ticket is deleted. For recruits first entered through Add Recruits, identical details return `already_exists` with a link to the deleted ticket, and changed details return a conflict. Neither creates a new ticket, so expect this and raise it with the owner.

## Related docs

- Setup, deployment and stage rules: `README.md`
- Verification steps and records: `VERIFICATION.md`
- Codex and Claude process: `docs/collaboration/README.md`
- Add Recruits: `RECRUIT-INTAKE-API.md`
- Stage mirror: `RECRUIT-LIFECYCLE-SYNC.md`
- HubSpot tool pages and scopes: `HUBSPOT-TOOLS-API.md`
- Contact-only creation: `CONTACT-API.md`
- Contract Agents: `docs/contract-agents-editing.md`
- Help Desk: `docs/help-desk.md`
- Non-HubSpot sources: see the docs listed under "Other data sources"

## Open items

Remove each item once it is resolved.

1. **Connector login and access.** The owner decided on 2026-11-05 that Claude should use the owner's own HubSpot login, with full read and write. The connector has not been reconnected yet, so `get_user_details` still shows another login. After reconnecting, run `discover_hubspot_schema`: custom objects may still need a permission change in HubSpot before they can be written.
2. **Vercel connector.** Not connected yet. It should be signed in as ChandlerMS. Until then, deployments and build logs cannot be checked from Claude.
3. **Worker contract.** `CLAUDE.md` describes Claude as a file-only worker under a Codex coordinator, yet recent merged work came directly from `claude/*` branches. The coordinator and worker paths in `docs/collaboration/README.md` do not exist on this computer, while the PolicyTek sync still runs from a Codex chat. The owner confirmed on 2026-11-05 that Codex still manages HubSpot in some other instances, so both are in use. Whether the `CLAUDE.md` contract also binds sessions the owner runs directly has not been decided.
4. **Repository visibility.** The owner decided on 2026-11-05 that the repository should be private. GitHub's API still reported it public that day, with no forks. Do not change the visibility until the build guard can read a private repository: `scripts/verify-production-source.mjs` runs `git ls-remote` with no credentials and rejects the build if that read fails, so making it private first would probably block Production builds. That comes from reading the code and was not tested on Vercel. The order is: give the guard a read-only GitHub token through a Vercel environment variable, deploy that, make the repository private, then confirm a Production build passes. Also confirm that Vercel's Git integration can still deploy from a private repository.

More open items are in `CLAUDE.local.md`.
