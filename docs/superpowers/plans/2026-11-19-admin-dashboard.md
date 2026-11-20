# Admin dashboard implementation plan

Goal: CRM access and Google Workspace directory/administrator permissions managed by Chandler and Sarah only.
Architecture: Postgres access overrides supplement the existing exact-email deployment policy; every session rechecks the effective policy. Better Auth's existing Google consent flow obtains Directory scopes for privileged users. Server-only Directory requests manage Google administrator role assignments. No Google token is returned by dashboard endpoints.

- [x] Add the fifth Google Admin destination and route the parent Admin link to an authenticated dashboard.
- [x] Add durable CRM grants, revocations and audit entries; preserve the two named administrators; use effective policy for sign-in, existing sessions and embedded host access.
- [x] Add server endpoints for listing users/roles and adding/removing Google role assignments using the signed-in administrator's Google token and privileges.
- [x] Build a dashboard with CRM access form/list, Google user search, role grants/removals, explicit errors, authorization connection, and audit history.
- [ ] Test forbidden identities, verified sessions, revoked access, protected admins, exact destinations, Google failures and write inputs; run build and suite; publish via main and verify production commit.

Constraints: Google must consent to Directory scopes and authorize each operation. CRM access grants editor-level access subject to existing global write switches. No Google user deletion or suspension is included. Google directory pagination remains explicit; no truncated list is represented as complete.
