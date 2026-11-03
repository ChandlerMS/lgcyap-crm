# Support ticket creation

`POST /api/support-tickets` saves a ticket to portal `50894788`, Support Pipeline `0`.

Request:

```json
{
  "requestId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "title": "Cannot access the dialer",
  "description": "Describe the issue and steps already tried.",
  "priority": "MEDIUM"
}
```

- Title: required, 1–200 trimmed characters. Description: up to 4,000 characters; line breaks allowed. Priority: `LOW`, `MEDIUM`, `HIGH`, `URGENT`.
- The server fixes the pipeline and retrieves its first open stage. Caller-supplied pipeline, stage, owner, endpoint and additional properties are rejected.
- Requires an authenticated allowlisted editor, production environment, existing writes flag, database ledger and verified private-app ticket read/write access. The same-origin JSON body is limited to 32 KiB.
- Success: `201 {status:"created",requestId,ticket:{id,title,hubspotUrl}}`, after read-back confirmation of all submitted properties. Replayed confirmed submissions return `200 {status:"created",requestId,replayed:true}`; the metadata-only ledger does not store a result ticket ID.
- Errors use `{error:{code,message},uncertain,retryAfterSeconds?}` with appropriate 4xx/5xx status. All responses are private and uncached.
- The existing Postgres write ledger atomically claims each request before the provider POST. Reusing a UUID with different content is rejected. Ambiguous responses, timeouts and failed confirmation never trigger an automatic retry. The user must check Help Desk before starting another request.
- No contacts, owner assignments, email notifications, conversation threads or associations are created by this endpoint. HubSpot workflows may act on new tickets according to the portal's existing configuration.

Verification: `node --test tests/support-ticket-create.test.mjs`. Tests use synthetic HubSpot responses and the real ledger schema in PGlite; they create no production records.
