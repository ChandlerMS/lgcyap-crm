# Private leaderboard read API

`POST /api/leaderboard` accepts exactly:

```json
{"board":"sp","period":"day"}
```

Boards are `sp`, `shopper`, `source`, or `whatsapp`; periods are `day`, `week`, or `month`.
The JSON body is limited to 512 bytes. Access requires a verified app session,
an approved email, and the app's exact origin. Responses are private/no-store.
GET returns 405; anonymous or forged identity returns 401.

Responses echo `board` and `period`, with `status` (`available`,
`connection-required`, or `unavailable`), `rows`, `partial`, `source`, `notice`,
`fetchedAt`, `startDate`, and `endDate`. Failures include a safe `error`; rate
limits include `retryAfterSeconds` and a matching HTTP Retry-After header.

The `sp` board reads HubSpot portal `50894788`, app `59264745`. Private-app
introspection verifies that account, app, and `crm.objects.deals.read` before
reading deals. The existing credential stays on the server, including inside
the introspection POST body; it is never put in a URL or response.

HubSpot metadata verified on 2026-10-30 identifies Sales Pipeline as `default`
and Sold as `closedwon`. The read also requires `hs_is_closed_won=true` and
filters `closedate`. Day starts at Eastern midnight, week starts Monday, and
month starts on the first. Bounds include the whole current Eastern calendar
day; daylight-saving days may contain 23 or 25 hours.

Rows group `writing_agent_name` and contain `name`, `attributed`, `sales`, and
`annualPremium`. Premium sums `annual_premium_amount` in USD, rounded per deal
to cents before exact integer addition. Signed adjustments remain signed.
Missing/invalid/non-USD premiums produce null for that agent's premium total;
missing agent names form an explicitly unattributed bucket (`attributed=false`).
That bucket contributes actual policies/premium, not an identified producer or
agent count. No owner-based attribution, currency conversion, customer details,
or Standard/Preferred classification is invented. Standard/Preferred is the
board title from the design reference, not a newly inferred property filter.

Reads deduplicate deal IDs, reject repeated/invalid cursors, and stop at 10,000
deals or the read budget. Incomplete pagination, changing result counts, and
missing attribution/premium are marked partial with a notice. Rankings from
partial data are not complete account totals. HubSpot search indexing can lag.

WhatsApp reads daily rows imported from the LAP Daily Agent Report workbooks (see `WHATSAPP-IMPORT.md`).
Rows contain `name`, `attributed`, `sales`, `production` (the reports' Total Production, not annual premium),
`queueConnected`, `queueSold`, and `closeRate` (queue sold ÷ connected inbound queue calls). The response adds
`calls` (`status` `available`/`partial`/`not-covered`, `coverageStart`, `connected`, `sold`, `closeRate`,
`unmappedConnected`, `unmappedSold`) and `dataThrough`. Calls exist from 2026-06-17; per-agent call fields are null
before that. Unmapped dialer seats count only in `calls` totals. `partial` is true when a requested month is not
imported or the range runs past the latest imported activity. Before any import the board returns `unavailable`
with error `WHATSAPP_NOT_IMPORTED`.

Shopper and Source read stored PolicyTek browser captures. See `POLICYTEK-SYNC.md` for the five-minute local bridge, publisher contract, date semantics and freshness limits. Report totals and incomplete named rankings remain distinct. Missing date ranges are queued; no financial values are fabricated.

Validation: 12 mocked tests cover exact schema/grants, aggregation, unknowns,
pagination, rate limits, privacy, auth/origin/body limits, and Eastern/DST dates.
`scripts/smoke.mjs` includes this endpoint in anonymous/forged identity and
method checks without credentials. These tests do not verify a live data read
or change any CRM records.

Provider references: [CRM Search](https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm)
and [private-app token information](https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview#view-private-app-access-token-information).
