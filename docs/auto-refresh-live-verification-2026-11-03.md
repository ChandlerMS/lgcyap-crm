# Live automatic-refresh verification — November 3, 2026

- App: https://lgcyap-crm.vercel.app
- Tested GitHub main commit: dc24d0f262aa61f66975f1e782fd8b4af3d2d870.
- Tested production deployment: dpl_FFPbesYW85mnNHEv5zopQsX5ads8. Vercel confirmed the live alias still points to it after these checks.
- One synthetic fixture only: Ticket 50512598684, associated Contact 259965083513, named AutoRefresh LiveQA20261103. Created using the live intake form with a reserved fictional phone number and no email.
- All stage gestures were native pointer drags of the name link in Live data mode. **The Refresh button was never clicked.**

## Case 1 — unrelated HubSpot edit survives the drag: PASS

1. The app displayed Application on the Recruiters path.
2. In HubSpot, edited only the ticket description to: Auto-refresh QA: latest unrelated edit must survive the drag.
3. Independently confirmed the description and Application stage before dragging. HubSpot last-modified was 2026-11-03T13:06:15.773Z.
4. Dragged the name from Application to Phone Interview without using Refresh.
5. The app displayed a successful save and matched Contact stage.

Independent post-drag HubSpot reads:

| Field | Observed value |
|---|---|
| Ticket hs_pipeline_stage | 1473225368 (Phone Interview) |
| Ticket content | Auto-refresh QA: latest unrelated edit must survive the drag. |
| Ticket hs_lastmodifieddate | 2026-11-03T13:06:35.639Z |
| Contact recruiting_lifecycle_stage | phone_interview |
| Contact sales lifecyclestage | lead (unchanged) |

## Case 2 — newer HubSpot stage blocks stale drag: PASS

1. An initial trial was abandoned without dragging because the app's scheduled background refresh had already updated its stage. That trial is not counted as evidence of blocking.
2. Established that the app displayed Offer. Changed the ticket's stage in HubSpot; independently confirmed the settled newer value was Contracting (1416243216), with timestamp 2026-11-03T13:09:35.122Z. The UI selection was initially Training, but the actual saved value observed through the connector was Contracting; no cause is inferred.
3. The test required the app name link to remain under Offer before performing the gesture; otherwise it would abort without dragging. This condition passed.
4. Dragged the stale Offer name toward Recruiters Application, without Refresh.
5. The app blocked the move and displayed: “HubSpot changed this recruit’s stage or routing. The latest data is now shown; review it before dragging again.” Its name then appeared under stage ID 1416243216, Contracting.

Independent post-attempt HubSpot reads confirmed:

| Field | Before drag | After blocked drag |
|---|---|---|
| Ticket hs_pipeline_stage | 1416243216 | 1416243216 |
| Ticket hs_lastmodifieddate | 2026-11-03T13:09:35.122Z | 2026-11-03T13:09:35.122Z |
| Ticket content | Auto-refresh QA: latest unrelated edit must survive the drag. | Auto-refresh QA: latest unrelated edit must survive the drag. |

The timestamp and stage were identical before and after the blocked attempt: the newer HubSpot stage was preserved. The Contact sales lifecycle remained lead.

## Evidence limits and cleanup

- Runtime-log lookup returned no entries. The live assertions above use visible app results and independent HubSpot connector reads, rather than a browser network trace. The separately committed automated integration test verifies the actual server version check also rejects changes between the preflight read and save, without PATCH or automatic retry.
- Both synthetic records were removed through HubSpot's restorable-delete UI (90-day recovery). Independent connector reads returned both IDs as notFound. No real recruit was changed.
- Grok review was attempted but unavailable (HTTP 429). Codex performed and independently checked these tests.

