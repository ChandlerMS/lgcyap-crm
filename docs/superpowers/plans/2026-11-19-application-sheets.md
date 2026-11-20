# Application Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Automatically mirror application records into monthly Google Sheets with weekly tabs.
**Architecture:** Shared HubSpot reader, Postgres connection/month/lease state, owner-only offline OAuth, and an idempotent Sheets writer. A minutely production cron detects new records, also running a full daily repair at 9 am Eastern; an authenticated submission notification can trigger the same sync.
**Tech Stack:** Next.js 16, Node crypto, Postgres, Google OAuth/Drive/Sheets REST APIs.
**Spec:** docs/superpowers/specs/2026-11-19-application-sheets-design.md

## Global Constraints
- Account: chandler@lgcyap.com. No added sharing grants.
- File title: MM-YY Applications; time zone America/New_York; Monday–Sunday tabs clipped at month boundaries.
- Keep the existing application reader and production deployment guard.
- Never log credentials, answers, or provider error bodies.

## Review Focus
- Month boundaries around midnight Eastern and DST: calendar tests.
- Retries, duplicate events, and overlapping cron calls: DB lease and deterministic replacement tests.
- Partial/failed reads: abort before modifying a workbook.
- Wrong Google account, CSRF, and expired consent state: OAuth tests.
- Expired permission and provider failures: explicit disconnected/error state, no success timestamp.

### Task 1: Calendar and workbook export
**Files:** lib/application-sheets-layout.mjs; tests/application-sheets.test.mjs
**Interfaces:** buildApplicationWorkbooks(report, now) produces month, title, weekly tabs and literal row arrays.
- [x] Write and run failing tests for Eastern boundaries, week clipping, separate submissions, full answers, and partial data refusal.
- [x] Implement the deterministic layout; run node --test tests/application-sheets.test.mjs (Expected: all pass).

### Task 2: Persistent sync and Google connection
**Files:** migrations/0015_application_sheets.sql; db/application-sheets.mjs; lib/application-sheets-google.mjs; lib/application-sheets-sync.mjs; lib/application-sheets-oauth.mjs; tests/application-sheets-integration.test.mjs
**Interfaces:** getApplicationSheetsDb(); syncApplicationSheets({db, env, now, fetchImpl}); owner-bound OAuth handlers; status reader. Consumes Task 1 layout.
- [x] Write and run failing integration tests for encrypted tokens/state, identity checks, lease contention, retry recovery, unchanged runs, daily repair, and failed/partial reads.
- [x] Implement schema, Google transport and OAuth, serialized sync and status. Run both new test files (Expected: all pass).

### Task 3: Routes, UI, and activation guidance
**Files:** app/api/applications/sheets/**; app/api/cron/application-sheets/route.ts; app/application-sheets-panel.tsx; app/applications-page.tsx; vercel.json; docs/application-sheets.md
**Interfaces:** GET status and callback; POST connect/manual sync; secret-authenticated cron/notification; panel consumes status and connection URL.
- [x] Add route authorization tests before handlers, wire owner-only connection, current-month link, visible sync errors and no false connected state.
- [x] Add production cron, setup instructions, and tests. Run npm test, npm run check, npm run lint and npm run build (Expected: pass).
- [x] Review diff and confirm whether production OAuth consent/deployment can actually be activated; report exact outstanding activation steps.

## Pre-flight
Task 1 → Task 2: layout month/tab/values shape is the sole export contract.
Task 2 → Task 3: shared handler and status API, with no tokens returned to the client.
Execution: native in current session, authorized by Proceed. Do not overwrite unrelated work.

## Verification ledger
- Task 1: 4 layout tests RED→GREEN (Eastern month boundary, calendar weeks, literal full-answer columns, partial-data refusal).
- Task 2: persistence/OAuth/sync tests RED→GREEN; tested owner identity, PKCE/expiry, encrypted tokens, job lease, safe retries and daily repair.
- Task 3: route authorization and React DOM interaction tests RED→GREEN. Full suite 714/714 after refreshing locked dependencies; type check and build passed. Targeted lint passed. Full-repository lint has five existing errors in recruit-path-page.tsx, workspace-search.tsx and workspace-titlebar.tsx plus one existing unused-import warning in event-attendance.test.mjs.
- Independent review: review_application_sheets requested changes; fixed all reported data integrity/access findings with regression tests. Complete Sheets reader removes the dashboard's lifetime page cap, checks terminal totals and batch completeness, and preserves full answers. Failed writes persist needs_repair; daily progress is per month and catches up after 9 am. Previously managed months are cleared when absent from a complete snapshot. Status links require synced_at and connection metadata is owner-only. Regression group 23/23 plus owner UI/handler group 5/5 passed.
- Additional regression: HubSpot keyset searches can reuse offset 100 on each request; duplicate-offset rejection now applies only to offset pagination. Strict-source group 3/3 RED→GREEN.
- Deployment uses only the existing main Git integration. Google offline consent is the owner's final activation step; the optional external submission notification hook is not installed.
- Final integration: merged latest production changes at 32f2133, preserving both application-sheets and custom-recruits crons and both environment examples. Combined full suite: 774/774 passed; production build passed including type validation and auth bundle verification. The 0015 SQL migration is present in both API route deployment traces. No product source changes followed those checks.
