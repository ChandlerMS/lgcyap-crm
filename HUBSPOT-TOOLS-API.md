# Connected HubSpot workspace reads

`POST /api/hubspot-tools/{tool}` reads one fixed HubSpot workspace dataset. These endpoints do not create, update, delete, call or send messages. They use the existing server-side HubSpot token and the same verified Google session, exact employee allowlist and pinned same-origin policy as recruiting reads.

## Requests

Send `Content-Type: application/json` with `{}` to load the current bounded dataset. CRM pages (every tool except `inbox`) also accept `{ "query": "Example" }` for a real HubSpot search across that configured object's default searchable properties. Queries are trimmed, limited to 2–200 characters and reject ASCII control characters. Query text travels only in the private POST body, never a URL. Customer Success keeps its current-customer filter when searching. The response echoes the normalized `query`, or `null` for the default dataset. This search can find records outside the initial 500-row dataset; results retain the same 500-row cap and honest upstream total/partial status.

For `inbox`, `{ "archive": "all" }` starts a thread walk; `active` and `archived` select one archive partition. Optional `threadId` selects that conversation's plain-text message history. Optional `continuation` resumes the signed next page returned by the server. Thread IDs are positive decimal strings of at most 20 digits. Each authenticated request reads at most 100 provider rows/2 MB, and returns `complete`, `partial`, `continuation`, `archive`, and `records` or `messages`. A continuation is bound to the user, credential, thread and archive scope, expires after 30 minutes, and cannot choose arbitrary URLs. All walks both archive partitions. Inbox bodies are limited to 8 KB; other tools retain 1 KB. Provider URL-encoded cursors are decoded exactly once before query serialization; supplied next-links are never fetched. The browser deduplicates pages, supports Pause/Continue, and retains committed rows on errors. It pauses after 100 pages per run with an explicit Continue control rather than imposing an overall 500-row ceiling. `complete:false` without a continuation indicates a blocked read requiring Refresh; it never means all records loaded.

Contacts, Tickets, Tasks, Customer Success and Meetings additionally accept `{ "recordId": "123" }` to fetch one fresh record directly. This cannot be combined with search or thread selection. The response includes `selectedRecordId`, one `records` item, server-provided `fields`, canonical raw `editValues`, and `capabilities.canEdit`. Calendar opens the same record through the Meetings tool. `readOnly: true` describes this read endpoint; edits use the separate reviewed-write endpoint below. A read grant alone never enables editing.

| Tool | Fixed upstream source | Minimum read scope | Visible meaning |
| --- | --- | --- | --- |
| `customer-success` | Companies search, `hs_current_customer = yes` | `crm.objects.companies.read` | Current customer companies, recorded CSM sentiment and renewal dates |
| `inbox` | Conversations v3 thread list or selected thread messages | `conversations.read` | Threads in HubSpot ID order and plain-text history |
| `tickets` | Tickets search; optional ticket pipeline labels | `crm.objects.tickets.read` | Tickets across all pipelines |
| `calls` | Calls search | Existing `crm.objects.contacts.read` | Logged call records; inbound phone uses From, outbound uses To |
| `contacts` | Contacts search | Existing `crm.objects.contacts.read` | Contact names, phone, email, company and lifecycle value |
| `tasks` | Tasks search | Existing `crm.objects.contacts.read` | Logged tasks, status, priority, type and due date |
| `calendar` | Meetings search | Existing `crm.objects.contacts.read` | HubSpot CRM meeting records arranged by date |
| `meetings` | Meetings search | Existing `crm.objects.contacts.read` | HubSpot CRM meeting records |

Optional `crm.objects.owners.read` resolves the actual HubSpot owner ID to first and last name. Owner emails and teams are discarded. Missing owner permission leaves the main dataset readable with nullable owner labels.

CRM requests use fixed `POST https://api.hubapi.com/crm/v3/objects/{configured-object}/search` endpoints, fixed property lists, limit 100 and descending object ID. Meetings use descending `hs_meeting_start_time`. Conversations use fixed `GET https://api.hubapi.com/conversations/v3/conversations/threads` and `.../{numeric-thread-id}/messages` endpoints. Bearer credentials never leave the server and redirects are not followed.

## Responses

Successful HTTP reads return:

```json
{
  "tool": "contacts",
  "label": "Contacts",
  "status": "available",
  "source": "HubSpot",
  "readOnly": true,
  "query": null,
  "records": [],
  "total": 0,
  "loadedCount": 0,
  "partial": false,
  "fetchedAt": "2026-10-30T12:00:00.000Z",
  "hubspotUrl": "https://app.hubspot.com/contacts/50894788/objects/0-1",
  "requiredScopes": ["crm.objects.contacts.read"],
  "notice": "Description of the displayed dataset."
}
```

Each record has `id`, `title`, `subtitle`, `status`, `owner`, `ownerId`, `createdAt`, `updatedAt`, `scheduledAt`, `endedAt`, `phone`, `email`, `company`, `health`, `preview` and a fixed-portal `hubspotUrl`. Missing facts are `null`. `health` on Customer Success is **recorded CSM sentiment**, never an invented numeric health score. Its actual verified options are At-Risk, Neutral and Healthy. Renewal dates are calendar dates represented at UTC midnight.

Inbox thread selection additionally returns `selectedThreadId`, `records: []`, and `messages`, each containing only `id`, `text`, `createdAt`, `direction`, `type`, and `truncated`. Rich HTML, attachments, original email reply history and sender address arrays are excluded. Individual message text is limited to 20,000 characters, with an aggregate 2 MiB message response budget; truncation and partial history are disclosed.

### Limits and honest totals

- Maximum five pages of 100 records or messages. Record IDs are deduplicated.
- CRM `total` is the upstream search total; `loadedCount` is the displayed dataset size. `partial` is true when the bounded read is incomplete or disagrees with the reported total.
- Inbox does not expose a global total. Its `total` remains `null` if pagination or message budget limits truncate history; otherwise it equals the exhausted, deduplicated count.
- Provider-issued pagination cursors remain opaque, bounded to 4,096 characters and passed only through fixed-endpoint JSON bodies or `URLSearchParams`. Invalid type, controls, excessive length and repeated cursors have distinct static validation codes. If Inbox already supplied valid threads/messages, unusable pagination preserves those rows with `partial: true`, `total: null`, `paginationWarning` and an explicit incomplete-history notice. It never follows a provider-supplied link or guesses another cursor.
- Local search/date filters cover loaded records only. The separate submitted HubSpot query searches the configured object's default searchable properties across HubSpot; its returned matches are still capped. A partial read must not be presented as all CRM records or complete calendar availability.
- Each upstream response is limited to 2 MiB, with a 30-second total read budget including optional metadata. Individual provider reads time out after at most eight seconds. Additional CRM search pages are paced to reduce search rate bursts. Requests are never retried automatically.
- Optional ticket pipeline labels are read once from `/crm/v3/pipelines/tickets` when needed, bounded by response size and stage counts, with a five-minute successful cache and 30-second failure cache. Unresolved stage IDs are explicitly shown as IDs.
- Owner labels use the same credential-scoped short server cache as recruiting data. Neither cache is persisted or shared across credentials.

HubSpot 401/403 responses become HTTP 200 datasets with `status: "permission-required"`, empty records and a safe error explaining that grants, subscription or seat access may be required. Other provider failures become `status: "unavailable"`; they cannot masquerade as a successfully empty dataset. Rate limits include safe `retryAfterSeconds` and `Retry-After` metadata. Provider error bodies are discarded.

Safe provider failure diagnostics expose only numeric `providerStatus` and static `validationReason`. Production warnings contain the configured tool, static code/reason, HTTP status, and—only for pagination—cursor type, length and repeated boolean. Tokens, cursor values, query text, record IDs, provider bodies and customer information are never logged.

HTTP boundary failures remain 401 (no session), 403 (allowlist/origin), 404 (unknown tool), 405 (non-POST), 413 (oversized body), 415 (content type), 400 (invalid input), or safe 502 errors. Responses carry `Cache-Control: private, no-store`, `Vary: Cookie`, `nosniff` and `no-referrer`.

## Deliberate product limits

These are connected views built inside the app. Customer Success health-score calculation, plays, automation and native workspace seat behavior are not recreated. Inbox cannot send replies or attachments. Calls display logged records; calling stays with the approved recruit HubSpot calling buttons. Calendar is a view of CRM meetings, not HubSpot's marketing campaign calendar or a complete connected Google calendar. Scheduling links and meeting availability remain in HubSpot. Supported existing-record edits are listed below.

## Reviewed existing-record edits

`POST /api/hubspot-tools/{tool}/{numeric-record-id}` accepts only `requestId` (UUID), canonical `expectedUpdatedAt`, dirty-field `expectedValues` and sparse `changes`. It cannot create/delete records, send messages, change associations or bypass recruiting stage logic. Unknown keys such as `isDemo` and nonnumeric demo IDs are rejected.

| Tool | Editable existing-record fields | Required write grant |
| --- | --- | --- |
| Contacts | First name, last name, phone, email, company | Existing `crm.objects.contacts.write` |
| Tickets | Title, priority, owner | Existing `crm.objects.tickets.write` |
| Tasks | Title, status, priority, due time, owner | Existing `crm.objects.contacts.write` |
| Customer Success | Company name, domain, phone, city, recorded CSM sentiment | Additional `crm.objects.companies.write` |
| Meetings | Title, start/end, location, outcome, owner | Existing `crm.objects.contacts.write` |

Company renewal is calculated by HubSpot from active contracts and remains display-only; its writability is not assumed. Ticket pipeline, stage and branching fields are deliberately excluded from the generic writer and continue through the existing validated recruiting graph. Calls and Inbox have no generic write endpoint. Calendar uses Meetings for approved meeting-record edits.

Dates use `YYYY-MM-DD`; editable datetimes and versions use canonical UTC ISO strings with milliseconds. The UI displays Eastern time and rejects ambiguous/nonexistent DST wall times. Email and domain values are lowercased consistently before review and save; other text is trimmed. Server validation enforces the fixed field definitions, lengths, select values, IDs, date validity and merged meeting start/end order.

Before enabling Edit, and again before a save can claim its ledger row or read/PATCH a record, fixed server-only token introspection verifies **portal 50894788**, **app 59264745**, and that tool's read and write grants. Credentials travel only in the existing private-app introspection POST body. A short 60-second cache is scoped to the exact credential and fetch implementation; a missing requested grant forces fresh verification. Missing or wrong account/app/grants fail closed. Production hosting, enabled writes, the verified session, exact editor allowlist, pinned origin, a durable ledger and an HMAC secret are all required.

The writer reuses `recruit_write_requests` without a schema migration. Ticket IDs keep the recruiting writer's raw numeric lock key so both surfaces serialize on the same pending record. Other object IDs are namespaced, such as `contacts:123`. Only UUIDs, user/object IDs, HMAC-SHA256 payload fingerprints, status and timestamps are stored; no field values or credentials are persisted. Object, record, reviewed version, expected raw values and changes are bound into the HMAC.

Every save reads a fresh authoritative record, compares the reviewed version and dirty-field raw baselines, sends one sparse PATCH and confirms each changed value through a fresh GET before reporting `{ status: "saved", requestId, record }`. Confirmed duplicates may return `replayed: true` after a read without another PATCH. Stale records return conflict; reused UUIDs with different payloads are rejected. Definite provider rejections settle as failed. Ambiguous transport, server, redirect, malformed acknowledgment, mismatched confirmation or unconfirmed ledger completion stays uncertain and is not automatically retried. The UI preserves the draft and requires explicit reload/review.

HubSpot does not provide an atomic compare-and-swap for these PATCHes. The app's SQL lock serializes its own writers and fresh reads detect prior changes, but a simultaneous native HubSpot or outside API edit can still race between read and PATCH. Existing HubSpot workflows may run after a deliberate save.

## Recruiting contact facts

Recruiting reads optionally batch actual ticket-to-contact associations, then read first name, last name, primary phone, email and `notes_last_contacted` from the unique associated Contact. No identity is inferred from names. Duplicate association labels for one Contact are deduplicated; multiple Contacts or truncated association results remain ambiguous. Batches are capped at 100 inputs, 1,000 tickets and a 12-second optional enrichment budget. Failure preserves verified ticket facts and marks contact enrichment unavailable.

Phone/email prefer the actual Contact with verified ticket `recruit_phone_number`/`recruit_email` as fallback. The ticket name is not split or overwritten. `firstName`, `lastName`, `contactName`, `contactId` and `contactStatus` state the actual source. Last contacted is the latest verified logged-contact date from the Ticket and its unique Contact, with `lastContactedSource`; notes/tasks/last-modified dates are never substituted. Missing contact-history access must not be described as confirmed never-contacted. Bare write normalization uses `contactStatus: "not-loaded"`, allowing the UI to preserve previously loaded contact facts only for that exact record.

## Provider evidence

Current official documentation was checked alongside Orbit's task-specific endpoint briefs. Orbit correctly identified the search/list limitations but one earlier owners brief suggested an unsupported legacy header; implementation follows the official `Authorization: Bearer` contract.

- [CRM search](https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm)
- [Calls API and required scopes](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/calls/guide)
- [Tasks API and required scopes](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/tasks/guide)
- [Meetings API and required scopes](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/meetings/guide)
- [Conversations read scope, threads and messages](https://developers.hubspot.com/docs/api-reference/legacy/conversations/guide)
- [Owners API](https://developers.hubspot.com/docs/api-reference/latest/crm/owners/guide)
- [Ticket pipeline metadata](https://developers.hubspot.com/docs/api-reference/latest/crm/pipelines/guide)

Actual portal property metadata verified `hs_current_customer` as **yes/no**, `hs_csm_sentiment` options, `hs_next_renewal_date` as a calendar date, ticket `hs_lastcontacted` semantics, and ticket `hubspot_owner_id` semantics. No customer records were changed to test these reads.

## Verification

Focused suites `tests/hubspot-tools.test.mjs`, `tests/hubspot-tool-write.test.mjs` and `tests/recruit-contact-read.test.mjs` cover fixed authority, scopes/properties, normalization, optional metadata, pagination/partials, response limits, session/origin/input boundaries, wrong-portal/app/grant denials, HMAC metadata, SQL lock interoperability, stale baselines, sparse confirmed saves, no-ops, replay, uncertainty and contact-source ambiguity. Existing PostgreSQL migrations are exercised using PGlite. All provider mutation tests use fictional mocks; no live HubSpot record was mutated for QA. Mock tests do not establish upstream grants, subscription access, record completeness or live save behavior.
