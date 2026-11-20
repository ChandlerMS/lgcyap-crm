# Workspace title bar and omnisearch

## Requested result
Move Version 1's Live Data/Demo Data controls and global search into the fixed Version 1/Version 2 title bar. Move Inbox, Help Desk and Tickets from the sidebar into that bar. Place Legacy Bot beside RingCentral at the bottom right. Increase Dashboard Tasks and Follow Up heading sizes.

## Approach
Extend the existing title bar and existing authenticated HubSpot readers. Keep the current workspace, record authorization, editing protections and navigation. A replacement CRM shell or an external search service would add unnecessary migration and synchronization work.

## Title bar
Use one responsive title bar with the brand/version tabs, Live Data/Demo Data controls, Search workspace input, and Inbox/Help Desk/Tickets links. On smaller screens, wrap controls into rows and measure the actual bar height so navigation and content never sit beneath it. Moving controls must retain the current disabled states during unsaved or in-flight edits. Version 2 remains its separate workspace; the HubSpot controls belong to Version 1.

## Omnisearch
Search Recruits, Contract Agents, Calls, Meetings, Inbox, Help Desk and Tickets in one accessible results panel grouped by area. Search starts after a short debounce and at least two characters. Support keyboard movement, Enter, Escape and stale-request cancellation. Show unavailable areas and incomplete coverage explicitly instead of reporting a false zero.

Use provider-side CRM search with fixed object types and pipeline filters; preserve viewer ownership restrictions for Calls and Meetings. Recruits remain restricted to the Recruiting pipeline. Do not limit CRM-object searches to the records already loaded in the dashboard. Inbox is a separate paginated conversations/messages source, so its reader needs bounded, resumable searching with coverage reported to the user; do not claim a partial conversation scan searched the entire inbox. Results open the matching record or conversation, retaining existing unsaved-edit protections. Demo searches use fictional local data and make no live HubSpot calls.

The server enforces employee authorization, same-origin requests, query/body limits and provider rate limits. It accepts no arbitrary provider endpoints, object types, fields or links. Search queries and customer content are not logged or stored in browser history.

## Native unread badges — current blocker
The user explicitly selected HubSpot's unread state, not new/updated-since-viewed counts. The current conversation reader exposes thread status and timestamps, with no user-specific unread state. Connected HubSpot schema discovery returned no conversation object and no Ticket property matching unread in portal 50894788. The connector's conversation search likewise has no unread filter or aggregation.

Do not invent unread counts, equate open tickets with unread tickets, or use CRM visit timestamps as a substitute. Build the title-bar navigation and the badge integration boundary, but native numerical badges require a supported, verified HubSpot unread-state source. This limitation must be reported until that source is available.

## Floating controls and Dashboard headings
Place the Legacy Bot launcher to the left of RingCentral with responsive spacing and no overlap. Preserve the existing HubSpot chat embed for portal 50894788 and RingCentral behavior. Raise the shared Tasks/Follow Up heading style from 15px to a readable heading scale without enlarging their individual chips.

## Validation and publication
Test global-search authorization, query validation, source scoping, partial results, cancellation, rate limits, keyboard interaction and demo isolation. Check responsive title-bar offsets, support navigation, launchers, and unsaved-edit behavior. Run relevant tests, type checking and the production build, obtain independent review, incorporate current origin/main and publish through the existing Vercel Git integration only.
