# Sign-In Sheets Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
**Goal:** Add the approved monthly/weekly Google Sheets sync for signed-in recruits.
**Architecture:** Shared monthly workbook calendar/writer and generic per-report sync; separate Sign-In state/month tables and cron; existing Chandler OAuth connection.
**Tech Stack:** Next.js, Postgres, native Google REST APIs, Node test runner/PGlite.
**Spec:** docs/superpowers/specs/2026-11-19-sign-in-sheets-design.md

## Global Constraints
- Same Drive/Sheets account chandler@lgcyap.com; no new sharing grants.
- MM-YY Sign-Ins; Monday–Sunday weeks; 9 am America/New_York with retry/catch-up.
- Complete source only; preserve every event by note ID and current fields.

## Review Focus
- Applications and Sign-Ins have distinct namespaces, tables and independent leases.
- Repeat visits/imported event dates survive stable replacement and retries.
- Empty month, Eastern boundary and removed historical rows are handled.
- Source paging exceeds the dashboard cap and refuses inconsistent totals/errors.
- Missing Google consent never reports either report as active.

### Task 1: Attendance source and layout
- [x] Add failing tests for note IDs, complete keyset reads, missing pages and expected sign-in columns/week assignment.
- [x] Implement shared calendar helpers and strict attendance source; preserve normal dashboard behavior.
### Task 2: Shared sync and delivery
- [x] Add failing tests for isolated report state/markers, new sign-ins, retries, daily repair and connection status.
- [x] Refactor Applications sync into shared monthly sync; add Sign-In schema/state/cron/notification and owner-only controls on Event Attendance.
### Task 3: Verification and release
- [x] Run both report regression suites, full suite, type check, lint and build. Independent review.
- [x] Merge current main, preserve other work and deploy via Git integration. Report the remaining Google consent/mailbox setup requirements for both active tasks.

## Verification ledger
- RED→GREEN tests cover the new feature, owner/private access boundaries, disconnected states, provider failures and report-specific behavior.
- Independent review completed. Important findings were fixed and reproduced with regression tests before the full run.
- Combined full suite: 817/817 passed after integrating production main at 2136139. Full repository lint passed. Production build passed, including TypeScript and auth bundle validation. Sign-Ins migration0016 is included in both API deployment traces.
- Provider activation remains separate from code completion: the HubSpot metadata read found no Chandler mailbox channel; Google Drive search found no current-month report files. The browser connection could not open, so no Google/HubSpot consent or mailbox settings were changed.
- Review fixes: strict requested-body validation, individual resolution of omitted association rows and continued association pages, one stable visit for multi-ticket notes, unknown aggregate fields left blank, encrypted initiating-report OAuth state and matching callback dispatch. Existing Applications and new Sign-Ins regression tests pass together; no extra sharing grants or external notification hooks were installed.
- Final integrated verification after current Inbox changes: full suite824/824, repository lint and production build passed. The shared Google connection still routes a Sign-Ins consent flow to Event Attendance and the Sign-Ins initial job. All current main changes were preserved.
