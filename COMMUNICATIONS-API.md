# Native HubSpot communication actions

Call and Email icons at the right of each stage list and profile open HubSpot's native tools in the
recruiting Ticket's existing activity context. This is a frontend navigation
feature. The authenticated, same-origin `POST /api/recruits` read, normalized
recruit data, exact approved-account policy, pipeline scope, and private response
headers retain their existing behavior.

| Icon | Destination and behavior |
| --- | --- |
| Phone | Open the canonical HubSpot Ticket record. The user then chooses its native **Call** tool. No direct call-composer URL has been verified. |
| Text | Visible between Call and Email, currently unavailable. The native record menu exposes Log SMS only; it does not send a text. No sending integration or composer route has been enabled. |
| Email | Open the canonical HubSpot Ticket record with `interaction=email`, the query observed when opening its native email composer in the live HubSpot UI. |

Destinations must use `https://app.hubspot.com`, fixed portal `50894788`, Ticket
object type `0-5`, and the strictly validated positive numeric Ticket record ID.
For example, the Phone destination is
`https://app.hubspot.com/contacts/50894788/record/0-5/123`; Email adds only the
observed `?interaction=email` query. Invalid or mismatched record URLs/IDs must not
produce active navigation controls. Native tools open in a new tab with opener
and referrer protections.

This app does not choose recipients, infer Ticket-to-Contact associations from
names, or read extra Contact/association data for these controls. HubSpot resolves
recipient availability and association ambiguity in its native interface. Phone
and email values are not added to the recruiting API response.

Opening a control does not place a call or send an email. Those actions remain
explicit choices within HubSpot. HubSpot sign-in, permissions, seats, connected
inboxes, calling configuration, recipient availability, and other native settings
still apply. The app does not assert that every user or Ticket can communicate.

There is no communication API endpoint, new database state, additional permission
request, `tel:`/`mailto:` navigation, guessed calling query parameter, or direct
API request to create calls, emails, activities, or communication logs. Contact
creation through the old `/api/contacts` endpoint remains disabled. The separate
Add Recruits flow creates associated Contacts and recruiting tickets as documented
in [RECRUIT-INTAKE-API.md](RECRUIT-INTAKE-API.md).

The record's native Log SMS dialog and `interaction=logged-sms` route were
inspected and closed without logging an activity. This is recorded evidence of
logging only; that route is not used as a sending shortcut. HubSpot's separate
[SMS sending documentation](https://knowledge.hubspot.com/sms/create-and-send-sms-messages)
describes the setup and subscriptions for its marketing SMS tools.

Validation covers fixed host/portal/object/record URLs, the observed email query,
and safe failure for invalid inputs. Live verification established the Ticket
email composer and native Call toolbar; no call was placed and no email was sent.
