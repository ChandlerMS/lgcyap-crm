# Admin dashboard

The sidebar's Admin title opens `/#admin`; `/admin` is also available. The fifth flyout link opens `https://admin.google.com/u/1/ac/home` in a new tab. The trailing period in the supplied link is treated as punctuation.

Only the verified Google identities `chandler@lgcyap.com` and `sarah@lgcyap.com` can read the dashboard APIs or change permissions. Other approved CRM accounts receive 403. Identity comes from Better Auth's verified session, never from a request body or identity header.

## CRM access

The existing deployment allowlist supplies initial access. Postgres overrides grant/revoke exact emails; the two administrators are always retained. The dashboard lists approved emails, revoked overrides and registered Better Auth users. Granting CRM access enables the existing recruiting editor permissions, subject to the existing production write/intake switches. It does not assign Google privileges.

Sign-in profile checks, user/session creation, each CRM request, and Queue/Leaderboard session bridges use the current policy. Revoking a user blocks the next request even if they still have a valid session cookie. An internal Symbol marks server-verified dynamic grants for the existing editor permission checks; a JSON boolean cannot bypass those checks. Google personal/outside-domain identities need an explicit exact grant or their existing configured exception; domain-wide access is never granted.

Tables in `migrations/0013_admin_access.sql` initialize additively on first access, using a transaction advisory lock for concurrent functions. Changes to CRM access and their audit entries commit together. No deployment environment secrets are changed or returned to the browser.

## Google Workspace

Click **Connect Google Workspace** and sign in as Chandler or Sarah with Google Directory privileges. The existing Google OAuth callback and encrypted Better Auth token storage are reused; no new redirect URI is needed. Explicit reauthorization uses `linkSocial` so the installed authentication library persists the additional scopes. Only an already-linked Google subject bound to the same verified CRM administrator may be reauthorized; automatic account linking and different-email linking remain disabled. The additional scopes are:

- `admin.directory.user.readonly`
- `admin.directory.rolemanagement`

The Google OAuth project's Admin SDK API must be enabled and its consent policy must permit these scopes. The signed-in administrator must separately hold Google privileges to list users and manage administrator roles. Consent alone does not create those privileges. If Google blocks consent or the organization restricts the app, an authorized Google Workspace owner must approve it in Google Admin Console. The dashboard reports insufficient privilege/expired authorization and offers reconnection; it does not pretend a denied operation succeeded.

Directory reads list users, roles, and role assignments through every returned page up to 50 per resource, marking a partial result if that bound is reached. The UI manages direct administrator role assignments. Grants explicitly cover the entire customer/organization; existing organizational-unit assignments show their scope and may be removed. Group membership, Google licenses, user creation/deletion/suspension and product-specific permissions remain in Google Admin Console.

Directory tokens stay server-side in dashboard operations. Fixed Google API endpoints and numeric IDs prevent arbitrary resource URLs. Google writes are never retried automatically. A durable audit entry precedes each write so an uncertain response remains visible. Refresh permissions before repeating an unconfirmed change. The audit table shows the latest 100 dashboard actions, not a replacement for Google's own organization-wide audit log.
