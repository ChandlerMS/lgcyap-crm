# Hiring-event sign-in

Two small sites for walk-in recruits at hiring events. Neither shares code or settings with the CRM in the repository root.

| Folder | Vercel project | Address | What it is |
| --- | --- | --- | --- |
| `signin/` | `lgcyap-signin` | https://lgcyap-signin.vercel.app | The sign-in form. Writes each sign-in to HubSpot. |
| `signinqr/` | `lgcyap-signinqr` | https://lgcyap-signinqr.vercel.app | The QR screen for the 100-inch conference room TV. `/print` is the security-desk sign. |
| `signinqr/public/Legacy-Sign-In-QR-Security-Desk.pdf` | | `/Legacy-Sign-In-QR-Security-Desk.pdf` | Printable Letter PDF: page 1 is the desk sign, page 2 is four cut-out cards. |

The QR codes add where the person scanned: `?s=room` on the TV and `?s=lobby` on the security-desk sign. The HubSpot ticket records it, and lobby sign-ins are told to head up to the 4th floor.

## What a sign-in writes to HubSpot

Portal `50894788`. Each sign-in:

1. **Contact.** Finds the contact by email. If one exists, it is used as-is and never edited: the form is public, and nobody proves they own the email they type. What the person entered goes on the ticket and the note, which says the email matched an existing contact so staff can confirm the details before changing it. Otherwise it creates a contact with first name, last name, email and phone. It never touches `lifecyclestage`.
2. **Ticket.** If the contact already has an open ticket in the Recruiting pipeline (not Completed or Withdrawn), it reuses that ticket. Otherwise it creates one in the Recruiting pipeline (`924992938`) at **Hiring Event** (`1473318768`) with `recruiting_path = genpop`. That matches the CRM's own Add Recruits, and the CRM only moves Hiring Event tickets forward when they have a path.
3. **License photos.** Uploads the front photo, and the back if given, to File Manager folder `/Hiring Event Sign-Ins/Driver Licenses` as **private** files. File names hold the contact ID and a timestamp, never the person's name.
4. **Note.** Adds a note with every answer and the photos attached, on both the ticket and the contact.

Ticket fields set on a new ticket:

| Answer | Ticket property |
| --- | --- |
| Name | `subject` (`Recruiting: First Last`), `recruit_name` |
| Email, phone | `recruit_email`, `recruit_phone_number` (+1 format) |
| Office | `orientation_office` (`orlando`, `miami`, `tampa`) |
| Licensed or unlicensed | `intake_license_status` (`already_licensed` or `unlicensed`), `already_licensed` |
| Contracted before (licensed only) | `has_recruit_contracted_before_transfer` (`Yes` or `No`) |
| NPN (licensed only, optional) | `npn_number` |
| Who referred them | `invited_by_name` |
| How they heard about us, where they scanned | `content` (ticket description) and the note. Also the property named in `HUBSPOT_HEARD_ABOUT_PROPERTY`, if set. |
| | `source_type = FORM` |

`licensing_branch` is left for staff, as the CRM expects. Creating a ticket can start HubSpot workflows, such as the one that matches `invited_by_name` to an agent, and the CRM's stage mirror copies the stage to the contact within a minute.

## One-time setup

### 1. HubSpot service key (owner)

HubSpot no longer lets you create private apps, so the sign-in site and the application site share one **service key**, "Legacy Hiring Event Forms (sign-in and apply)", under Development, then Keys, then Service Keys. It has only these scopes:

- `crm.objects.contacts.read`, `crm.objects.contacts.write`
- `crm.objects.tickets.read`, `crm.objects.tickets.write`
- `files.write`. A legacy private-app token with `files` also works.

Copy the key straight into Vercel in step 3. Do not paste it into chat, code or docs.

Before writing, the site confirms the token belongs to portal `50894788`, and refuses to write otherwise. Each server instance repeats the check every 10 minutes. HubSpot's token lookup also lists the token's scopes, and when it does, every scope above is required. HubSpot does not document that lookup for service keys. If it answers 400 or 404, the site confirms the portal through the account details endpoint instead. HubSpot still refuses any call the key has no scope for. `/api/health` reports which check ran as `via`: `token_info` or `account_info`.

### 2. Optional: a "How did you hear about us?" ticket property

Without this, the answer is still in the ticket description and the note. To report on it, create a ticket dropdown property, for example `how_did_you_hear_about_us`, with these internal values: `referral`, `indeed`, `facebook`, `instagram`, `linkedin`, `tiktok`, `google`, `ziprecruiter`, `job_fair`, `other`. Then set `HUBSPOT_HEARD_ABOUT_PROPERTY` to the property's internal name.

### 3. Vercel projects

Create two projects in team `main-team8` from the GitHub repository `ChandlerMS/lgcyap-crm`. Do not change the existing CRM project.

| Setting | `lgcyap-signin` | `lgcyap-signinqr` |
| --- | --- | --- |
| Root Directory | `hiring-event/signin` | `hiring-event/signinqr` |
| Framework Preset | Other | Other |
| Build and output | Leave empty. `vercel.json` sets the output to `public`. | Same |
| Production branch | `main` | `main` |

Vercel names the domain after the project. If `lgcyap-signin.vercel.app` is already taken, Vercel adds a suffix. In that case, regenerate the codes for the real address (see "Changing the address").

Environment variables, on `lgcyap-signin` only:

| Variable | Production | Preview |
| --- | --- | --- |
| `HUBSPOT_ACCESS_TOKEN` | The service key from step 1. Mark it Sensitive. | Leave unset |
| `SIGNIN_WRITES_ENABLED` | `true` to accept sign-ins, `false` to close them | Leave unset |
| `SIGNIN_DRY_RUN` | Leave unset. Production ignores it. | `1`: validates everything and writes nothing |
| `HUBSPOT_HEARD_ABOUT_PROPERTY` | Optional, from step 2 | Leave unset |

Recommended: in the project's Firewall, add a rate-limit rule for `POST /api/submit`, for example 10 requests per minute per IP. The form already has a honeypot field, a minimum fill time, a same-origin check and size limits.

### 4. Deploy

Merge the branch into `main`. All three Vercel projects deploy from `main`, so the merge is also a production release of the CRM, which follows the root `AGENTS.md` rules. That commit changes only `hiring-event/`.

## Before each event

1. Open `https://lgcyap-signin.vercel.app/api/health`. It should return `"ok":true`, `"mode":"live"` and `"hubspot":"verified"`, plus `via`.
   - `"mode":"closed"`: set `SIGNIN_WRITES_ENABLED=true` and redeploy.
   - `"hubspot":"access-needed"`: the token is wrong, expired or missing a scope.
2. Scan the TV code and the printed code with a phone. Both should open the sign-in page.
3. On the TV, open `https://lgcyap-signinqr.vercel.app` in the TV's browser, or on a laptop connected to it, then press **F** or click once for full screen. The page keeps the screen awake, hides the cursor, shifts a few pixels every two minutes to avoid burn-in, and reloads itself daily at 4 AM.
4. Print the PDF from `https://lgcyap-signinqr.vercel.app/print` or `/Legacy-Sign-In-QR-Security-Desk.pdf`, at 100% scale, for the first-floor security desk.

A test sign-in creates a real contact, ticket and note in HubSpot, so only do one with the owner's approval, and archive the test records afterward.

After the event, set `SIGNIN_WRITES_ENABLED=false` to close sign-ins until the next one.

## Changing the address

If the sign-in site moves to another domain, run these from `hiring-event/`:

```bash
npm ci
npm run qr -- https://new-address.example
npm run pdf
npm run verify-qr -- https://new-address.example
```

`qr` rewrites both QR codes and the printed address on the TV page and the print page. `pdf` re-prints the PDF with headless Chrome or Edge, using a throwaway profile. `verify-qr` renders the codes, the TV page at 1080p, 4K and portrait, and the print page, then decodes each one and checks the address.

## Local development

```bash
npm ci
npm test
npm run dev:signin
npm run dev:qr
```

`npm test` runs the sign-in unit tests against a fake HubSpot. `dev:signin` serves the form at http://localhost:3010 in dry-run mode, so nothing is written. `dev:qr` serves the TV page at http://localhost:3011.

## Privacy

- License photos are resized in the browser to at most 1800 px and re-encoded as JPEG before upload. They go straight to HubSpot as private files and are never stored by Vercel or written to logs.
- Server logs hold outcome codes and HubSpot record IDs only: no names, emails, phones, NPNs or images.
- The form asks for consent before a license photo is kept.
