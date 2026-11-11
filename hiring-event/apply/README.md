# Agent Application (lgcyap-apply)

The public Legacy Agent Application at `lgcyap-apply.vercel.app`. It asks exactly the questions of the
LGCY Onboard `/apply` page (Agent Application v3.1, copied into `public/form.js`), in the same black
and gold look as the hiring-event sign-in, and writes each application to HubSpot.

## What it writes to HubSpot

Portal `50894788`, Recruiting ticket pipeline `924992938`, the same records the CRM reads.

The form is public and the email is not verified, so records found by email are only linked and
noted. The site never changes an existing contact or ticket.

| Situation | Result |
| --- | --- |
| New applicant who meets the five required items | A new contact (or a link to the existing contact with that email) and a new ticket at **Application** |
| The contact already has an open recruiting ticket | The application is added to that ticket as a note. Its stage and fields are not changed. If it is at **Hiring Event**, the note asks staff to confirm the person and move it to Application in the CRM. |
| Fails a required item (18+, work authorization, English, SSN, office hours) | Contact and note only, no ticket. The applicant sees the same "not able to move forward" message as Onboard. |

Every application also gets:

- a note on the ticket and contact with every answer, the five required items, and any answers that
  need a private conversation;
- the driver's license photo, uploaded as a **private** file to `/Agent Applications/Driver Licenses`
  and attached to that note.

Ticket fields set on a new ticket: `subject` (`Recruiting: Full Name`), `recruit_name`, `recruit_email`,
`recruit_phone_number`, `orientation_office`, `intake_license_status`, `already_licensed`, `npn_number`,
`invited_by_name`, `source_type` = Form, and `content`. When the email matches an existing contact,
the note says so and that the contact was not changed, so staff confirm details with the person
before updating it. Contact `lifecyclestage` is never touched. `recruiting_path` is left for staff
(the CRM allows the Application to Phone Interview move without one).

Because the email is not verified, anyone who knows a person's email can add an application note to
that person's contact or open ticket. They cannot change the person's data.

## Setup

1. **HubSpot service key.** HubSpot no longer creates private apps; service keys replace them
   (Development, Keys, Service Keys). The key "Legacy Hiring Event Forms (sign-in and apply)" serves
   both hiring-event sites with `crm.objects.contacts.read`, `crm.objects.contacts.write`,
   `crm.objects.tickets.read`, `crm.objects.tickets.write` and `files.write`. An older private-app
   token works too if it has the four CRM scopes and `files`. Before writing, the server confirms the
   token is for portal `50894788` (and its scopes, when HubSpot reports them) and refuses otherwise.
2. **Vercel project** `lgcyap-apply` in team `main-team8`: import the GitHub repository, set
   **Root Directory** to `hiring-event/apply`, Framework Preset **Other**, no build command.
3. **Environment variables** (Production):
   - `HUBSPOT_ACCESS_TOKEN`: the private app token. Paste it in Vercel only.
   - `APPLY_WRITES_ENABLED` = `true`. Any other value is an off switch: applicants are asked to try
     again later and nothing is written.
   - Preview deployments: leave the token out. `APPLY_DRY_RUN` = `1` there checks answers without
     writing (it is ignored in Production).
4. **Check it.** Open `/api/health`. Ready looks like `{"ok":true,"mode":"live","hubspot":"ok",...}`.
   `access_problem` means the token is for another portal, is missing a scope, or was rejected; the
   `step` and `status` fields say which HubSpot check failed. Environment variable changes apply only
   after a redeploy.
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
