# Agent Application (lgcyap-apply)

The public Legacy Agent Application at `lgcyap-apply.vercel.app`. It asks exactly the questions of the
LGCY Onboard `/apply` page (Agent Application v3.1, copied into `public/form.js`), in the same black
and gold look as the hiring-event sign-in, and writes each application to HubSpot.

## What it writes to HubSpot

Portal `50894788`, Recruiting ticket pipeline `924992938`, the same records the CRM reads.

| Situation | Result |
| --- | --- |
| New applicant who meets the five required items | Contact (created, or reused by email) and a ticket at **Application** |
| Already has an open recruiting ticket at **Hiring Event** (Referrals path or no path) | That ticket moves to **Application**. No second ticket. |
| Already has an open recruiting ticket at any other stage, or on the Recruiters path | Stage unchanged. The application is added as a note. |
| Fails a required item (18+, work authorization, English, SSN, office hours) | Contact and note only, no ticket. The applicant sees the same "not able to move forward" message as Onboard. |

Every application also gets:

- a note on the ticket and contact with every answer, the five required items, and any answers that
  need a private conversation;
- the driver's license photo, uploaded as a **private** file to `/Agent Applications/Driver Licenses`
  and attached to that note.

Ticket fields set on a new ticket: `subject` (`Recruiting: Full Name`), `recruit_name`, `recruit_email`,
`recruit_phone_number`, `orientation_office`, `intake_license_status`, `already_licensed`, `npn_number`,
`invited_by_name`, `source_type` = Form, and `content`. On an existing ticket only blank fields are
filled. Existing contact values are never overwritten. Contact `lifecyclestage` is never touched.
`recruiting_path` is left for staff (the CRM allows the Application to Phone Interview move without one).

## Setup

1. **HubSpot private app.** In HubSpot, Settings, Integrations, Private Apps. The sign-in site's app
   works here too if it has these scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`,
   `crm.objects.tickets.read`, `crm.objects.tickets.write`, `files`. The server checks the portal and
   scopes and refuses to write otherwise.
2. **Vercel project** `lgcyap-apply` in team `main-team8`: import the GitHub repository, set
   **Root Directory** to `hiring-event/apply`, Framework Preset **Other**, no build command.
3. **Environment variables** (Production):
   - `HUBSPOT_ACCESS_TOKEN`: the private app token. Paste it in Vercel only.
   - `APPLY_WRITES_ENABLED` = `true`. Any other value is an off switch: applicants are asked to try
     again later and nothing is written.
   - Preview deployments: leave the token out. `APPLY_DRY_RUN` = `1` there checks answers without
     writing (it is ignored in Production).
4. **Check it.** Open `/api/health`. Ready looks like `{"ok":true,"mode":"live","hubspot":"ok"}`.
   `access_problem` means the token is for another portal or is missing a scope.
5. Recommended: a Vercel Firewall rate limit on `/api/submit` (for example 10 requests per minute per IP).

## Limits and privacy

- Photos are resized on the phone to at most 1800 px before upload. PDFs can be up to 3 MB.
  Vercel rejects request bodies over 4.5 MB.
- Answers are kept in the browser tab's session storage while typing and removed on submit, so a
  shared tablet does not keep the previous applicant's answers.
- Server logs hold outcome codes and HubSpot IDs only, never answers or contact details.
- Bot checks: a hidden honeypot field and a minimum fill time. Posts from other sites are refused.

## Local run and tests

```bash
node hiring-event/apply/scripts/dev-server.mjs hiring-event/apply 3020
```

Set `APPLY_DRY_RUN=1` in the environment to submit without HubSpot. Tests use a fake HubSpot and
never touch the network:

```bash
node --test "hiring-event/apply/tests/*.test.mjs"
```
