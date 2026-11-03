# RingCX dashboard

Route `/ringcx` and read-only API `GET /api/ringcx` require the existing CRM employee session. The UI can be embedded with `<iframe src="/ringcx" title="RingCX live desk" style="width:100%;height:760px;border:0"></iframe>` on the same CRM origin. Sign in in the top-level CRM first. No credentials or caller records reach the browser.

## Contract

200: `{ observedAt, timezone: "America/New_York", scope, agents: { loggedIn, available, onCalls, other }, queues, calls: { connected: null, answered: null, status: "pending_validation" } }`.
401: `{error:"SIGN_IN_REQUIRED"}`. 503: sanitized upstream/configuration error. All responses are private/no-store. Empty valid agent arrays mean zero logged-in agents; malformed responses, missing queues and auth failures do not mean zero. Instance-local 15-second snapshot cache coalesces concurrent requests; this is not a global rate limiter across Vercel instances. Upstream 429s enforce at least 60 seconds cooldown. Production concurrency must be monitored before broad wallboard rollout.

## Live checks on 2026-11-03

- Production JWT grant and RingCX token exchange succeeded. Account listing returned `50560001`, SUB-Legacy Agency Partners.
- Agent group `2498` is **Agents - Standard vs Preferred** (one group).
- Matching queue group `1973` is **Standard vs Preferred**, with 53 queue records. User confirmed queue totals should be limited to this group.
- Both real-time endpoints succeeded. Agent snapshot was empty; visible native Analytics also showed zero agents. This does not validate non-empty live state mapping.
- Queue responses contain `connected` and `accepted`, but equality to Historical Analytics **Queue Inbound Connected Interaction** and **Inbound Answered** is NOT established. Account reset timezone is also not established. Daily totals deliberately remain unavailable until both are reconciled; do not substitute session callsHandled or RingEX analytics.

## Credentials

Existing Vercel project `legacy-recruiting-private` (`lgcyap-crm.vercel.app`), production-only sensitive variables: `RINGCX_CLIENT_ID`, `RINGCX_CLIENT_SECRET`, `RINGCX_JWT`. Credential is restricted to this app and expires February 1, 2027 UTC. No secret values belong in source, logs, fixtures or browser responses. Rotate before expiration. App has Read Accounts only; platform reporting permissions apply separately.

## Remaining acceptance work

Observe AVAILABLE → ON_CALL → wrap → AVAILABLE using actual non-empty data, verify account timezone in RingCX Admin, reconcile non-zero `connected`/`accepted` queue counters with the requested historical metrics including transfers/callbacks, then implement verified daily aggregation. Do not remove pending-validation labels just because zero counters agree.

Sources: https://developers.ringcentral.com/guide/authentication/jwt-flow ; https://developers.ringcentral.com/engage/voice/guide/authentication/auth-ringcentral ; https://developers.ringcentral.com/engage/voice/guide/analytics/reports/realtime-supervisor-view ; https://developers.ringcentral.com/engage/voice/guide/users/agents/agent-groups .

## Nonzero validation — November 3, 2026, 10:51 Eastern

- Account General settings explicitly show `(GMT-05:00) Eastern Time (America/New_York)`.
- At 15:51:27 UTC, the API sum for all 53 queues in group 1973 was `accepted=23`, `presentedInbound=41`, `connected=6`, `answeredAll=23`, callback/manual-outbound answered both zero. Native Real-Time Inbound for **1973 - Standard vs Preferred** showed **Ans IB 23 / Pres IB 41 / Conn. 6**. This validates this nonzero snapshot against native realtime analytics, not historical equivalence for all call scenarios.
- `connected` is the concurrent gauge: it was 5 then 6 while accepted was 23. It must never populate **Connected today**. Exposed separately as `calls.activeConnected`; `calls.answered` now uses accepted. `calls.connected` stays null, status `connected_pending_validation`.
- Historical reports twice displayed **Historical Analytics is temporarily unavailable**. Daily connected cannot be reconciled with the historical metric until that service is available. No synthetic cumulative counter or hardcoded total is substituted.
- Live API agents use ENGAGED/WORKING, not only ON_CALL. Six ENGAGED records had active call identifiers; two held calls were still ENGAGED and displayed Hold in native analytics. ENGAGED now counts as on calls, including hold. PENDING-DISP/WORKING remain other states. No caller records are returned or retained.

This supersedes the earlier pending status for answered and timezone. Remaining: historical daily connected integration and reconciliation, including transfers/callbacks. Auth boundaries and secret handling are unchanged.
