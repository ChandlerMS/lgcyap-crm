# Contract Agent editing

Open Contract Agents, select an agent, then Edit record. Review changes before Save to HubSpot. Full name and first/last name are separate HubSpot fields; update the full name when changing the displayed name.

## API contract

POST /api/hubspot-tools/contract-agents with {"recordId":"<id>"} returns a fresh record, fields and canEdit capability. POST /api/hubspot-tools/contract-agents/<id> accepts requestId (UUID), expectedUpdatedAt (ISO), expectedValues and changes (matching sparse property maps).

Allowed properties: full_name, first_name, last_name, email, phone, npn, agent_status, hubspot_owner_id. NPN remains text, preserving leading zeroes. Status accepts Active, Inactive, Terminated, Pending, or empty. Empty strings explicitly clear fields; omitted fields are unchanged.

Only existing records of object 2-64481801 are updated. Production editor authorization, origin checks, durable ledger and portal/app token verification are required. Custom read AND write scopes are required. Credentials stay server-only.

The server reads the current record, rejects stale edits (409), PATCHes changed properties, then reads back to verify. Success returns status=saved and the refreshed record. Authentication/permission failures return 401/403; invalid edits 400; rate limits 429. Uncertain saves must be checked/reloaded and are never automatically retried. HubSpot does not offer an atomic version condition here; another external writer can race the pre-save read.

Verification: mocked HubSpot tests exercise custom scopes, fixed object routing, all editable fields, sparse PATCH, read-back and validation. Shared editor tests cover conflict/replay/uncertain outcomes and request authorization. No production agent record is changed solely for testing.


## Creating agents

Add Contract Agent opens a local draft with full name (required), first/last names, email, phone, NPN and status. Optional fields are not invented; owner can be assigned after creation. Review new agent shows exactly what Save to HubSpot will send.

POST /api/contract-agents accepts {requestId, properties}. It uses the same production editor authorization and custom object scope check. The provider endpoint is fixed to POST /crm/v3/objects/2-64481801. Email/NPN supplied in the form are checked for existing matches before creation. Search indexing is eventually consistent; this check is not a global uniqueness guarantee.

The durable existing ledger permits one create attempt per user/request ID. Success requires a matching read-back and ledger completion. Replayed completed requests refresh the list without another provider create. Uncertain outcomes block resubmission of that request and require checking HubSpot. The UI disables repeated submission and never automatically retries. Creation returns 201 with status=created, requestId and agent ID/link; completed replay returns 200 and replayed=true. Validation 400, auth 401/403, duplicate 409, rate limit 429, unavailable/uncertain 5xx are handled separately. No migration or additional credentials required.
