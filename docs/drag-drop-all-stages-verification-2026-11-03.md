# All-stage live drag verification — November 3, 2026

- Application: https://lgcyap-crm.vercel.app
- HubSpot portal: 50894788. Recruiting pipeline: 924992938.
- Scope: all nine real recruiting lifecycle stages, Referrals and Recruiters source orders, and Not Licensed and Licensed branches.
- Method: actual pointer drags of recruit name links in the signed-in live app. Each successful drop was followed by independent HubSpot connector reads of the ticket and linked Contact. No API call substituted for a browser drag.
- Result: 28 successful native name drags; every successful drop matched both HubSpot stages. Contact sales lifecyclestage stayed lead throughout.
- Automated matrix: 228 compatible direct source/destination pairs, covering both source paths and both license routes. The lifecycle tests also cover all 72 distinct mapped stage pairs.
- Branch headings such as Referrals/Recruiters/Licensed describe routing, not separate HubSpot lifecycle stages. Withdrawn is not a visible logic-tree stage and is outside the nine-stage Contact sync.

## Fixtures

Both fixtures were created by the live Add Recruits form with reserved fictional phone numbers and no email. Only these test records were moved:

| Fixture | Ticket | Contact | Source | License route |
|---|---|---|---|---|
| StageQA Referrals | 50512752981 | 259962850201 | genpop | not_licensed |
| StageQA Recruiters | 50605294341 | 259962251527 | mass_recruiting | licensed |

## Independent HubSpot observations

| Move | Fixture | Direction | Destination | Ticket stage ID | Contact recruiting_lifecycle_stage | Contact sales lifecycle |
|---|---|---|---|---|---|---|
| 1 | referrals | forward | application | 1473318769 | application | lead |
| 2 | referrals | forward | phone_interview | 1473225368 | phone_interview | lead |
| 3 | referrals | forward | offer | 1473318770 | offer | lead |
| 4 | referrals | forward | licensing_reminders | 1473318771 | licensing_reminders | lead |
| 5 | referrals | forward | licensed_npn | 1473318772 | licensed_npn | lead |
| 6 | referrals | forward | contracting | 1416243216 | contracting | lead |
| 7 | referrals | forward | training | 1416243217 | training | lead |
| 8 | referrals | forward | completed | 1416243218 | completed | lead |
| 9 | referrals | backward | training | 1416243217 | training | lead |
| 10 | referrals | backward | contracting | 1416243216 | contracting | lead |
| 11 | referrals | backward | licensed_npn | 1473318772 | licensed_npn | lead |
| 12 | referrals | backward | licensing_reminders | 1473318771 | licensing_reminders | lead |
| 13 | referrals | backward | offer | 1473318770 | offer | lead |
| 14 | referrals | backward | phone_interview | 1473225368 | phone_interview | lead |
| 15 | referrals | backward | application | 1473318769 | application | lead |
| 16 | referrals | backward | hiring_event | 1473318768 | hiring_event | lead |
| 17 | recruiters | forward | phone_interview | 1473225368 | phone_interview | lead |
| 18 | recruiters | forward | hiring_event | 1473318768 | hiring_event | lead |
| 19 | recruiters | forward | offer | 1473318770 | offer | lead |
| 20 | recruiters | forward | contracting | 1416243216 | contracting | lead |
| 21 | recruiters | forward | training | 1416243217 | training | lead |
| 22 | recruiters | forward | completed | 1416243218 | completed | lead |
| 23 | recruiters | backward | training | 1416243217 | training | lead |
| 24 | recruiters | backward | contracting | 1416243216 | contracting | lead |
| 25 | recruiters | backward | offer | 1473318770 | offer | lead |
| 26 | recruiters | backward | hiring_event | 1473318768 | hiring_event | lead |
| 27 | recruiters | backward | phone_interview | 1473225368 | phone_interview | lead |
| 28 | recruiters | backward | application | 1473318769 | application | lead |

## Rejections and test limitations

- First Completed→Training attempt correctly rejected an outdated HubSpot version after a workflow modified the ticket. Refreshing and repeating the name drag succeeded; no blind retry or concurrency bypass.
- First Recruiters Hiring Event→Offer attempt returned a confirmed not-saved message. Independent read showed Hiring Event unchanged. After refresh, the native drag and both HubSpot stages succeeded. Specific rejection cause was not exposed by the UI.
- Some pointer attempts were not registered while another browser session switched the visible page or while cards/scroll positions changed. These attempts are excluded from the 28 successful and independently verified moves. Hive Commander authorized coordination notices to the other CRM chats; the final two live moves then passed.
- Optimistic concurrency remains active. A HubSpot-side edit can require Refresh before another move; rejected/uncertain writes were never blindly retried.

## Production source

The drag implementation commit 74e08e1 is an ancestor of GitHub main. The versioned and Vercel project Build Commands both run scripts/verify-production-source.mjs before and after building. The guard checks the expected Vercel project, GitHub repository, main branch, and equality with the current GitHub main SHA; tests confirm other branches, stale commits, missing metadata and remote-check failures are rejected. Older checkouts without the guard script also fail the configured project build.

These checks govern builds and do not remove a Vercel owner's ability to override settings or manually promote an existing deployment. Production must be verified against current main after deployment.

## Cleanup

All four fixture records were removed through HubSpot's restorable-delete UI, with 90-day recovery. Independent HubSpot connector reads then returned both ticket IDs and both Contact IDs as notFound. No real recruit was moved or removed. Production environment secrets were not exported; an attempted CLI cleanup could not access the protected token and made no mutations, so cleanup was completed in the browser.

Grok review was attempted and unavailable (HTTP 429). Codex performed the tests and independently checked the results.

