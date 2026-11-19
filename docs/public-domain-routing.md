# Public website and CRM host routing

`lgcyap.com` and `www.lgcyap.com` are currently assigned to the CRM Vercel project. `lgcyap.vercel.app` belongs to the separate `lgcyap-website` project and is the public website source.

`proxy.ts` serves the public source through the two exact public hosts, preserving page paths, query strings and assets. Incoming cookies and authorization headers are stripped before forwarding. Public pages retain the source site's public caching and indexing headers instead of CRM's private/noindex defaults. The apex domain's existing Vercel redirect to `www.lgcyap.com` remains in place.

CRM sign-in, sign-out, admin, auth callbacks and session handoff paths reached on a public host redirect to `https://crm.lgcyap.com`. CRM, Queue and Leaderboard host behavior remains unchanged. The production `BETTER_AUTH_URL` is `https://crm.lgcyap.com`; changing it to the public website origin will break the fixed-origin OAuth flow. Google OAuth callbacks must stay registered for that CRM origin.

No DNS, MX, nameservers, credentials or project-domain assignments were changed. This host dispatch remains safe if the public domains are later moved to the public website project: traffic then bypasses this CRM proxy entirely. Do not move the CRM subdomain or change its authentication origin when managing the public website domains.
