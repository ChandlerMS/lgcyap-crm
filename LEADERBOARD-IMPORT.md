# Agent Leaderboard source integration — November 3, 2026

Original user-supplied ZIP is unpacked under `reference/agent-leaderboard-source/` for provenance. It is not served from `public/`, and its scripts are not executed. The production implementation is `app/leaderboard.tsx`, the CSS module, and the authenticated `POST /api/leaderboard` route.

The export depends on Claude Dashboard's `dash` runtime and D3. Its design and behavior are adapted to the CRM's React components: three boards, gold bars and podium badges, large gradient totals, premium/policy rankings, daily/weekly/monthly/custom dates and previous-period shortcuts. Existing Google sign-in and allowlist checks remain required.

## Request contract

- Existing: `{ "board": "sp", "period": "day" }`. Boards: `sp`, `shopper`, `source`; periods: `day`, `week`, `month`.
- Added: `{ "board": "sp", "period": "custom", "from": "2026-10-01", "to": "2026-10-31" }`.
- Dates must be real, ordered calendar dates from 2000–2099, at most 366 days inclusive. End date includes its whole Eastern calendar day; UTC bounds account for daylight saving. Quick ranges use the previous Monday–Sunday and previous calendar month.
- Existing response and errors are preserved. The Standard vs. Preferred result adds `calls` (status, total, partial, soldPerInboundLog), `callNotice`, and row `inboundCalls` / `soldPerInboundLog`. No raw call records are returned.

## Data boundaries

Sales retain the existing verified Sold stage / Sales Pipeline / writing-agent grouping and USD premium validation. Call queries read only inbound HubSpot engagement logs, activity dates and owner IDs, using the same server-only token after fixed portal/app/scope verification. They are bounded to 10,000 records and the shared request deadline. Missing or failed call data does not hide valid sales data. Partial data withholds ratios and per-agent call counts.

The export calls inbound logs “calls taken” and their sales ratio “close rate.” Those claims are not established by the data. The app labels them inbound logs and sold/log ratio. Agent rows attribute logs through a unique deal owner only when that owner maps to one writing-agent name within the selected loaded sales period; this is not proof that the owner is the agent or that a call led to a sale. Missing/ambiguous owners show unavailable. Duplicate integration engagements with distinct HubSpot IDs can still inflate log counts; they are not silently deleted or merged.

The ZIP references private Claude blob URLs for `shopper-history.json` and `sources-history.json` but includes neither file. Those boards were disconnected at initial import; the subsequently authorized local browser bridge is documented in `POLICYTEK-SYNC.md`. Importing this source does not transfer the Claude hourly automation or establish a PolicyTek feed. No fabricated data or unsupported hourly-refresh claims are displayed.

## Verification

Run `npm test`, `npm run check`, `npm run lint`, and `npm run build`. Added tests cover custom dates, DST, range limits, owner ambiguity, bounded pagination, optional provider failure, and request security.

HubSpot field definitions were verified in portal 50894788 on November 3. Calls API reference: https://developers.hubspot.com/docs/api-reference/legacy/crm/activities/calls/guide
