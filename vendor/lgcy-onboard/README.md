# LGCY Onboard

Legacy Agency Partners' recruiting CRM, rebuilt from the demo at `lgcy-onboard.carlos-831.workers.dev`. It runs on **Vercel** with a **Postgres** database, the same setup as the recruiting app (`lgcyap-crm`).

- **Front end — the same as the demo.** `src/pages/app.html` (the CRM), `src/pages/login.html` and `src/pages/apply.html` are the demo's pages byte for byte, apart from the three placeholders the server fills in on `/apply`. The images in `public/brand/` are copied from the demo.
- **Back end — rebuilt.** The demo's server code isn't public, so `src/` reimplements it from the API the pages call: the same routes, the same JSON shapes and the same error codes the page already handles.

## How it works

`npm run build` produces Vercel's [Build Output](https://vercel.com/docs/build-output-api) in `.vercel/output`. Vercel runs it on every deploy (`vercel.json`). The output has three parts:

- the brand images, served from Vercel's CDN
- one Node.js function holding the whole app (`src/vercel.ts`, bundled with esbuild)
- the routing and a daily cron job

| Path | What it serves |
|---|---|
| `/` | The CRM when signed in, otherwise the sign-in page (any other path signed out also gets the sign-in page) |
| `/apply`, `/apply/<token>` | The public agent application; a token pre-fills it for a candidate the team sent it to |
| `/brand/*` | Logos and icons (public, static) |
| `/api/*` | JSON API (needs sign-in, except `POST /api/login/*`, `POST /api/apply` and the cron job) |

**One shared record.** The whole CRM (candidates, tasks, classes, users, rules) is one JSON document in the `onboard.record` table, with a version number:

- The page saves with `PUT /api/state` and an `if-match: <version>` header.
- If someone else saved first, the server answers `409`. The page then merges and retries.
- Every 12 seconds the page checks `/api/state/version` to pick up other people's changes.
- Server-side changes (new applications, Indeed applicants, calendar links) go through the same versioned write (`mutate()` in `src/record.ts`).

**Database.**
- **Tables:** they live in their own Postgres schema, `onboard`, so the app can share a database without touching anything else in it. `src/schema.sql` lists them.
- **Setup:** the app creates them on its first request to a new database. There is no migration step.
- **Local development:** `npm run dev` uses an embedded Postgres ([PGlite](https://pglite.dev)) under `.data/`, unless you set `DATABASE_URL`.

**Sign-in** is by emailed code, with no passwords:

- **Who can sign in:** anyone on the CRM's Users list who isn't inactive, plus `OWNER_EMAILS`. Until the first save, the built-in team in the page is used.
- **The code:** 6 digits, good for 10 minutes and 5 tries. Only a salted hash is stored.
- **The session:** 30 days, in an HttpOnly cookie. Only a hash of the session ID is stored.

**Google** is optional. Without it the CRM still works; email, calendars and Indeed show their "not set up" states.

| Approval | Variable | Signed in as | Used for |
|---|---|---|---|
| Team | `GOOGLE_TEAM_REFRESH_TOKEN` | `MAIL_FROM` (carlos@lgcyap.com) | Sends sign-in codes, invites and application emails. Reads and writes `TEAM_CALENDARS` (pre-screens, group reviews, Meet links). |
| Inbox | `GOOGLE_INBOX_REFRESH_TOKEN` | `INDEED_INBOX` | Reads Indeed notices, read-only. New applicants become cards marked "From inbox". |
| Per person | stored in the database | each recruiter | Optional. Lets a recruiter put events on their own calendar ("Connect Google" in the CRM). |

**Sync.** Calendars and the Indeed inbox are read:

- every 10 minutes while anyone has the CRM open (the page's 12-second check starts it)
- once a day at 11:00 UTC by Vercel's cron job (`/api/cron`), which works on every Vercel plan

On the Pro plan you can make the cron job run every 10 minutes: change `schedule` in `scripts/build.mjs`.

### Files

```
src/pages/app.html        the CRM page (unchanged from the demo; not public, served only when signed in)
src/pages/login.html      sign-in page
src/pages/apply.html      public application page
public/brand/             logos, icons, manifest (static)
src/index.ts              routing, origin check, sync, cron
src/vercel.ts             the Vercel Function entry
src/dev.ts                the local dev server (npm run dev)
src/db.ts                 Postgres: connection pool, statements, transactions, creating the tables
src/schema.sql            the tables (schema "onboard")
src/env.ts                settings and their defaults
src/node.ts               Node req/res <-> web Request/Response
src/record.ts             the shared record: read, save with version check, mutate()
src/auth.ts               email-code sign-in, sessions, /api/me, user invites
src/apply.ts              /apply page, scoring, sending the application link
src/cands.ts              creating and moving candidate cards server-side
src/gcal.ts               Google Calendar: pull, invite, move, group review
src/indeed.ts             Indeed notices from Gmail
src/google.ts             OAuth tokens and Google API calls
src/mail.ts               sending through Gmail, email templates
src/shared.generated.ts   TEAM, STAGES, OFFICES, CITIES, TEMPLATES copied out of app.html (npm run extract)
scripts/build.mjs         builds .vercel/output
scripts/dev.mjs           runs src/dev.ts, restarting on changes
scripts/smoke.mjs         checks a running copy from outside
scripts/authorize-*.mjs   the two Google approvals
vercel.json               tells Vercel to run npm ci and npm run build
```

If you change the team, stages or email templates in `src/pages/app.html`, run `npm run extract` so the server uses the same wording.

## Run it locally

Needs Node.js 22.9 or newer (Vercel runs it on Node.js 24).

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Open http://localhost:3000 and sign in with any team email (for example sarah@lgcyap.com). With `DEV_LOGIN_CODES=1` and Google not set up, the code isn't emailed. It's printed in the terminal as `dev_login_code`. Data is kept in `.data/`; delete that folder to start over.

In a second terminal, check the running copy:

```bash
npm run smoke
```

```bash
npm run check
```

## Deploy to Vercel

### 1. Create the project

Pick one of these:

- **From Git (recommended):** push this folder to a GitHub repository, then in Vercel choose **Add New → Project** and import it. If the repository holds other things too, set **Root Directory** to this folder. Leave the build settings alone; `vercel.json` sets them.
- **From your computer:** run these in this folder. The first creates and links the project; the second deploys to production.

```bash
npx vercel
```

```bash
npx vercel --prod
```

### 2. Add a database

In the Vercel project, open **Storage → Create Database → Neon (Postgres)** and connect it to the project. This sets `DATABASE_URL`. Pick the **Washington, D.C. (iad1)** region, where Vercel runs the function by default.

- **Your own database is simplest.** You can also connect the recruiting app's existing database to this project instead. This app only uses the `onboard` schema, so it won't touch the recruiting app's tables.
- **Preview deployments:** if `DATABASE_URL` applies to Preview as well as Production, preview deployments read and write the live data. Either limit it to Production, or let Neon create a branch per preview.

### 3. Set environment variables

Under **Settings → Environment Variables** (Production):

| Name | Value |
|---|---|
| `CRON_SECRET` | A long random string. Vercel sends it with the cron job; without it, `/api/cron` refuses to run. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From step 5 |
| `GOOGLE_TEAM_REFRESH_TOKEN`, `GOOGLE_INBOX_REFRESH_TOKEN` | From step 5 (the scripts can set these for you) |

Optional, with these defaults:

| Name | Default |
|---|---|
| `MAIL_FROM` | `carlos@lgcyap.com`. Must be the team-approval account. |
| `MAIL_FROM_NAME` | `Legacy Agency Partners` |
| `TEAM_CALENDARS` | `carlos@lgcyap.com,ed@lgcyap.com` |
| `INDEED_INBOX` | `recruitinglegacyam@gmail.com` |
| `OWNER_EMAILS` | Empty. Comma-separated emails that can always sign in, as owner, even if removed from Users. |

Redeploy after changing variables (**Deployments → ⋯ → Redeploy**).

### 4. Check it

Replace `<your-project>` with your project's address:

```bash
npm run smoke -- https://<your-project>.vercel.app
```

Until Google is set up, sign-in codes can't be emailed, so nobody can sign in on Vercel yet. That's deliberate: `DEV_LOGIN_CODES` is ignored on Vercel.

### 5. Google

1. In [Google Cloud console](https://console.cloud.google.com/), create a project (or use the recruiting app's).
2. Enable the **Gmail API** and **Google Calendar API**.
3. **OAuth consent screen:** choose **External**, because the Indeed inbox is a gmail.com account.
4. Publish the app (**In production**). An app left in "Testing" has its refresh tokens expire after 7 days. It doesn't need Google's verification for a handful of team users; you'll click through an "unverified app" warning once per approval.
5. **Credentials → Create OAuth client ID → Web application**, with these authorized redirect URIs:
   - `http://localhost:53682/oauth2callback` (the approval scripts)
   - `https://<your-domain>/api/google/callback` (per-person "Connect Google")
   - `http://localhost:3000/api/google/callback` (local testing)
6. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local` and in Vercel's environment variables.
7. Link this folder to the Vercel project:

```bash
npx vercel link
```

8. Run the two approvals. Each opens Google's permission page. Sign in as the account it names.
   - With `--put`, the token goes straight to the project's Production environment variables, without being printed.
   - Without `--put`, it's written into `.env.local`.

```bash
npm run google:team -- --put
```

```bash
npm run google:inbox -- --put
```

9. Share ed@lgcyap.com's calendar with carlos@lgcyap.com, with "Make changes to events", so the team approval can reach both `TEAM_CALENDARS`.
10. Redeploy.

### 6. Your domain

In the Vercel project, open **Settings → Domains**, add e.g. `onboard.lgcyap.com`, and create the DNS record Vercel shows (a CNAME). Then add `https://onboard.lgcyap.com/api/google/callback` to the OAuth client's redirect URIs.

## What to know

- **It starts empty**, like the demo did. The first person to sign in creates the record. The demo's candidates aren't copied over; that data belongs to the demo's owner.
- **Rebuilt behavior** follows the page's own code wherever the page shows it: application scoring, the stage list, email templates, recruiter assignment. A few things couldn't be seen from outside and are best guesses:
  - the exact HTML of the sent emails, which use the CRM's own templates in a simple branded wrapper
  - the wording of notes the server adds to cards
  - how Indeed emails are recognized: `parse()` in `src/indeed.ts`. Check it against a real Indeed notice before relying on it.
- **Limits:**
  - Vercel accepts request bodies up to 4.5 MB, so the whole CRM record is capped at 4 MB. That's plenty for thousands of candidates. Store attachments elsewhere, not in notes.
  - Functions run up to 300 seconds on every plan, which covers the longest sync.
