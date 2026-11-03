# Help Desk connection

The `#help-desk` workspace reads real support tickets through the existing authenticated HubSpot tools route.

- `POST /api/hubspot-tools/help-desk` accepts `{}` or `{ "query": "search text" }` using the existing bounded query validation.
- The server searches HubSpot tickets with a fixed `hs_pipeline EQ "0"` filter. Pipeline `0` was verified as **Support Pipeline** in portal `50894788` on November 3, 2026. Recruiting and Agent Licensing & Contracting pipelines are excluded.
- Responses use the existing tool envelope, with `tool: "help-desk"`, ticket projections, genuine totals, partial-result notices and safe error states. Non-support provider results fail validation.
- Existing account allowlisting, session, origin and ticket read-scope requirements apply. Credentials stay on the server.
- Ticket detail reads and edits reuse `/api/hubspot-tools/tickets` and its existing permission checks. No support tickets are created automatically.
- This page shows ticket records; email replies, channel routing, SLAs and HubSpot Help Desk automation remain in HubSpot.

Verification: `node --test tests/recruiting-navigation.test.mjs tests/hubspot-tools.test.mjs tests/hubspot-record-edit.test.mjs`.
