# Connected HubSpot workspace reads

`POST /api/hubspot-tools/{tool}` reads one fixed HubSpot workspace dataset. These endpoints do not create, update, delete, call or send messages. They use the existing server-side HubSpot token and the same verified Google session, exact employee allowlist and pinned same-origin policy as recruiting reads.

## Requests

Send `Content-Type: application/json` with `{}`. The only optional input is `{ "threadId": "123" }` for `inbox`, selected deliberately to load that thread's plain-text messages. Inputs cannot choose provider URLs, properties, filters, scopes, pagination or object types. Thread IDs must be positive decimal strings of at most 20 digits. Bodies are limited to 1,024 bytes.

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
- Local search/date filters cover loaded records only. A partial read must not be presented as all CRM records or complete calendar availability.
- Each upstream response is limited to 2 MiB, with a 30-second total read budget including optional metadata. Individual provider reads time out after at most eight seconds. Additional CRM search pages are paced to reduce search rate bursts. Requests are never retried automatically.
- Optional ticket pipeline labels are read once from `/crm/v3/pipelines/tickets` when needed, bounded by response size and stage counts, with a five-minute successful cache and 30-second failure cache. Unresolved stage IDs are explicitly shown as IDs.
- Owner labels use the same credential-scoped short server cache as recruiting data. Neither cache is persisted or shared across credentials.

HubSpot 401/403 responses become HTTP 200 datasets with `status: "permission-required"`, empty records and a safe error explaining that grants, subscription or seat access may be required. Other provider failures become `status: "unavailable"`; they cannot masquerade as a successfully empty dataset. Rate limits include safe `retryAfterSeconds` and `Retry-After` metadata. Provider error bodies are discarded.

HTTP boundary failures remain 401 (no session), 403 (allowlist/origin), 404 (unknown tool), 405 (non-POST), 413 (oversized body), 415 (content type), 400 (invalid input), or safe 502 errors. Responses carry `Cache-Control: private, no-store`, `Vary: Cookie`, `nosniff` and `no-referrer`.

## Deliberate product limits

These are connected read views built inside the app. Customer Success health-score calculation, plays, automation and native workspace seat behavior are not recreated. Inbox cannot send replies or attachments. Calls display logged records; calling stays with the approved recruit HubSpot calling buttons. Calendar is a view of CRM meetings, not HubSpot's marketing campaign calendar or a complete connected Google calendar. Scheduling links, meeting availability, task completion and generic CRM editing are not exposed by these reads.

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

`node --test tests/hubspot-tools.test.mjs` covers fixed provider authority, exact scopes/properties, real field normalization, safe optional metadata, bounded pagination, honest partials, message response limits, permission and transport errors, and the session/allowlist/origin/body boundary. Fixtures are fictional. Successful mock tests establish these contracts; they do not establish upstream grants, subscription access, record completeness or message visibility until live read verification succeeds.
