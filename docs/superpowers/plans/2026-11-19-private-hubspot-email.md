# Private HubSpot Email Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
**Goal:** Real received HubSpot email on both Email surfaces, restricted to Chandler.
**Architecture:** Read-only channel discovery and a request-local Conversations privacy transport; existing signed Inbox pagination; owner-only Email API and reusable Inbox UI.
**Tech Stack:** Next.js, native fetch, React, Node test runner and JSDOM.
**Spec:** docs/superpowers/specs/2026-11-19-private-hubspot-email-design.md

## Global Constraints
- Exact mailbox chandler@lgcyap.com; only Chandler can access its incoming-mail view.
- No sending tests, mailbox disconnections, or new sharing grants.
- Source is HubSpot Conversations; no false promise of historical Gmail import or successful channel connection.

## Review Focus
- Missing/revoked/inactive/ambiguous mailbox channel must not fall back to support email.
- Direct messages/replies and generic Inbox/search must not bypass owner restriction.
- Signed continuations must stay scoped to the private mailbox and preserve active/archived pages.
- Both Email surfaces must show the same received-mail source and retain compose functionality.
- Failed provider reads and disconnected accounts must not be announced as an empty connected mailbox.

### Task 1: Privacy and source
- [x] Add failing tests for exact mailbox discovery, private/public thread filtering, direct-access denial, owner permission, source status and continuation scope.
- [x] Implement lib/hubspot-mailbox.mjs and lib/hubspot-email-inbox.mjs; run their tests to GREEN.
### Task 2: Routes and UI
- [x] Test owner-only API authorization and Email UI placement/requests before implementation.
- [x] Add app/api/email/route.ts; apply guard to generic Inbox/search/reply routes; use shared received-mail panel in Email page and dashboard with existing compose underneath.
- [x] Verify relevant tests, type check, full suite and build. Run targeted lint and independent code review.
### Task 3: Integration
- [x] Merge latest main without dropping other work, publish through existing Git integration, verify deployment SHA.
- [x] Report exact required owner mailbox connection and historical limits; do not claim the upstream mailbox is connected without evidence.

Execution: native, per the user's action request and explicit privacy choice. No further visibility approval is needed.

## Verification ledger
- RED→GREEN tests cover the new feature, owner/private access boundaries, disconnected states, provider failures and report-specific behavior.
- Independent review completed. Important findings were fixed and reproduced with regression tests before the full run.
- Combined full suite: 817/817 passed after integrating production main at 2136139. Full repository lint passed. Production build passed, including TypeScript and auth bundle validation. Sign-Ins migration0016 is included in both API deployment traces.
- Provider activation remains separate from code completion: the HubSpot metadata read found no Chandler mailbox channel; Google Drive search found no current-month report files. The browser connection could not open, so no Google/HubSpot consent or mailbox settings were changed.
- Review fixes: use supported v3 ID sorting/single inbox; active-then-archived metadata preflight; preserve public non-message events; preview inbound emails and exclude outbound-only threads; retain loaded history on background failure; filter private/unknown CRM email engagements. Activation requires a manually verified dedicated Inbox pin and rejects Help Desk. Related regression group39/39 passed.
