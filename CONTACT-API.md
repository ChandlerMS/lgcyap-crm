# Contact creation API contract

Status: retained but disabled in Production after the user removed Add recruit.
There is no contact-entry page or CTA; old `#add-recruit` links go to Recruits.
`RECRUITING_CONTACT_CREATION_ENABLED=false` denies authenticated create attempts
before a provider mutation. The contract below describes the retained guarded code.

`POST /api/contacts` creates one HubSpot Contact. It never creates a recruiting
Ticket, association, owner assignment, marketing subscription, or workflow action.
Existing HubSpot automations may run in response to a contact being created.

## Request and access

Same-origin JSON, at most 4,096 UTF-8 bytes, with exactly these keys:

```json
{"requestId":"UUID","firstName":"First","lastName":"Last","phone":"(407) 555-0123","licensed":false}
```

All fields are required, including an explicit boolean `licensed`. This records
the user-confirmed Active 2-14/2-15 license field: true maps to `Yes`, false to `No`
in `licensed_2_14_2_15`. It is not independent license verification.
Names are trimmed/NFC-normalized, 1–100 Unicode code
points, without control characters. Phone accepts digits, spaces, parentheses,
periods and hyphens, with an optional leading `+`; extensions, letters, and control
characters are rejected. Ten US digits become `+1…`; eleven digits must start with
`1`. An explicit international `+` accepts 7–15 digits with a nonzero first digit.

Requires the normal verified Google session and current exact account policy,
editor allowlist, real Vercel Production, persistent creation ledger, valid server
HMAC key, and both `RECRUITING_WRITES_ENABLED=true` and
`RECRUITING_CONTACT_CREATION_ENABLED=true`. Preview/local writes are denied.
`capabilities.canCreateContact` in `/api/recruits` also checks runtime HubSpot token
metadata before it becomes true; failure denies only this capability and does not
change existing ticket behavior.

HubSpot must separately grant contacts-read and contacts-write access. Provider
authority is fixed server-side. A bounded token-information POST verifies portal
50894788, writer app 59264745, and both contact scopes before any contact search or
create. It sends the token only in headers/JSON, never in a URL. The only create
properties are `firstname`, `lastname`, normalized `phone`, and the confirmed
`licensed_2_14_2_15` enum.

## Responses

First confirmed creation: HTTP 201. Same user's same UUID and normalized payload
replay: HTTP 200, without another provider creation.

```json
{"status":"created","contact":{"id":"123","hubspotUrl":"https://app.hubspot.com/contacts/50894788/record/0-1/123"},"requestId":"UUID","replayed":true}
```

`replayed` is omitted on the first success. No contact name/phone is returned.
Errors use `{ "error": { "code": "…", "message": "…" } }`, optionally with
`requestId`, `retryAfterSeconds`, and a safe `contact: {id, hubspotUrl}` link.
Validation errors may include `error.fieldErrors` keyed by `firstName`, `lastName`,
`phone`, or `licensed`; messages never echo submitted values.

| HTTP/code | Meaning |
| --- | --- |
| 400 `INVALID_CONTACT` | Invalid/unsupported fields or UUID; no provider call |
| 401 `SIGN_IN_REQUIRED` | No authorized session |
| 403 `CONTACT_CREATION_DISABLED` | Application/environment gates deny creation |
| 403 `ORIGIN_NOT_ALLOWED` | Wrong request origin |
| 403 `CONTACT_ACCESS_REQUIRED` | HubSpot denied contact access |
| 409 `CONTACT_EXISTS` | Known matching contact; safe `contact` link included |
| 409 `REQUEST_ID_REUSED` | Same UUID with a different normalized payload |
| 409 `CREATE_IN_PROGRESS` | An active claim already owns this phone/request |
| 409 `CREATE_ALREADY_PROCESSED` | A definitively failed UUID cannot be retried |
| 409/502 `CREATE_UNCERTAIN` | Possible create/crash outcome; phone remains blocked |
| 409 `CONTACT_CONFLICT` | Provider rejected creation as a conflict without a known safe contact ID |
| 413 `INVALID_REQUEST` | Body too large |
| 415 `INVALID_REQUEST` | JSON required |
| 429 `HUBSPOT_RATE_LIMITED` | Retry-After supplied; no automatic retry |
| 502/503 `CONTACT_SEARCH_UNAVAILABLE` / `CREATE_UNAVAILABLE` | Safe unavailable response |
| 405 `METHOD_NOT_ALLOWED` | GET/other methods cannot create |

Failures before creation or definite provider 4xx rejection settle as `failed` and
release the phone claim. A deliberate new attempt needs a new UUID. Network,
timeout, 5xx, redirects, malformed create acknowledgement, or failed confirmation
after the create attempt settle as `uncertain`; neither the same nor a new UUID
can repeat that phone automatically. Operators must reconcile uncertainty in
HubSpot. Successful and duplicate phone claims remain blocked against new creates.

## Durable and provider behavior

Migration `0002_contact_creation_ledger.sql` adds metadata-only PostgreSQL state.
A user/UUID primary key and app-wide normalized-phone HMAC claim arbitrate callers
across users/functions. Names/phone values are never stored in this ledger.
Purpose-separated keyed hashes use BETTER_AUTH_SECRET; a durable key fingerprint
fails closed on an unexpected key rotation rather than bypassing previous claims.
Do not rotate that key or clear/migrate claims without a reconciliation plan.

Search precedes the single provider create POST. NANP search uses the national ten
digits, requests only `phone`/`mobilephone`, and canonical-compares returned values.
International searches use exact canonical/compact property filters; their duplicate
coverage is weaker because country-code stripping cannot be guessed reliably.
Search is bounded to 200 candidates and fails closed on truncation/malformed data.
Search indexing lag, archived records, formatting, and other integrations mean this
is best-effort global deduplication. App-local durable phone claims are stronger;
HubSpot has no shared transaction with this database or promised phone uniqueness.

The create response must contain a safe numeric ID. A fresh GET confirms the four
properties before the ledger reports `created`. Provider requests are bounded,
use manual redirect handling, and are never automatically retried. No request
payload, credential, or raw provider error is logged or echoed to clients.

Primary references: [HubSpot Contacts](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide),
[HubSpot CRM search](https://developers.hubspot.com/docs/api-reference/legacy/crm/search-the-crm).
