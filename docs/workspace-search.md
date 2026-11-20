# Workspace title bar and search

Version 1 keeps Live Data/Demo Data, Search workspace, Inbox, Help Desk and Tickets beside the version tabs. The bar measures its rendered height when controls wrap. Inbox, Help Desk and Tickets remain reachable through their saved hashes but no longer appear in the sidebar. Version 2 remains a separate workspace.

Search accepts 2–200 characters and returns grouped Recruits, Contract Agents, Calls, Meetings, Inbox, Help Desk and Tickets results. CRM object queries run against HubSpot rather than filtering only the loaded dashboard. Calls and Meetings retain verified owner restrictions; Recruits retain the Recruiting pipeline restriction. Live CRM results open the matching HubSpot record in a new tab. Inbox results open the matching conversation in the CRM. Demo mode searches fictional local recruits and does not query live HubSpot.

Arrow keys select a result, Enter opens it and Escape closes results without clearing the query. Editing disables global search, data-mode changes and support navigation until the editor closes. Searches are POST requests with private/no-store responses; query strings and customer content are not written to browser history or logs.

Each CRM area returns up to eight matches. Narrow a query to find other matches. Inbox searches available plain-text message content across active/archived threads and both message archive states, in bounded requests. Continue Inbox search advances a signed, user/query-bound cursor; incomplete or withheld coverage is explicitly marked. Cursors expire after 15 minutes. HubSpot rate limits temporarily pause further reads. Missing API access is shown as unavailable, never represented as an empty completed search.

Native HubSpot unread counts are not supplied by the current connection. The title-bar links support verified future count values but show no substitute counters. Open tickets and items updated since a CRM visit are not treated as unread.

Legacy Bot and RingCentral share a responsive floating dock at the lower right. Existing HubSpot chat portal 50894788, RingCentral behavior and employee authorization remain unchanged. Dashboard Tasks and Follow Up headings use a larger shared heading style.
