# Contract Agent editing

Open Contract Agents, select an agent, then Edit record. Review changes before Save to HubSpot. Full name and first/last name are separate HubSpot fields; update the full name when changing the displayed name.

## API contract

POST /api/hubspot-tools/contract-agents with {"recordId":"<id>"} returns a fresh record, fields and canEdit capability. POST /api/hubspot-tools/contract-agents/<id> accepts requestId (UUID), expectedUpdatedAt (ISO), expectedValues and changes (matching sparse property maps).

Allowed properties: full_name, first_name, last_name, email, phone, npn, agent_status, hubspot_owner_id. NPN remains text, preserving leading zeroes. Status accepts Active, Inactive, Terminated, Pending, or empty. Empty strings explicitly clear fields; omitted fields are unchanged.

Only existing records of object 2-64481801 are updated. Production editor authorization, origin checks, durable ledger and portal/app token verification are required. Custom read AND write scopes are required. Credentials stay server-only.

The server reads the current record, rejects stale edits (409), PATCHes changed properties, then reads back to verify. Success returns status=saved and the refreshed record. Authentication/permission failures return 401/403; invalid edits 400; rate limits 429. Uncertain saves must be checked/reloaded and are never automatically retried. HubSpot does not offer an atomic version condition here; another external writer can race the pre-save read.

Verification: mocked HubSpot tests exercise custom scopes, fixed object routing, all editable fields, sparse PATCH, read-back and validation. Shared editor tests cover conflict/replay/uncertain outcomes and request authorization. No production agent record is changed solely for testing.
