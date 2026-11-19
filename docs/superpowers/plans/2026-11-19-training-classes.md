# Training Classes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a shared, editable Training Classes schedule to the Recruits flyout.
**Architecture:** PostgreSQL stores class records and actor timestamps. Authenticated route handlers enforce CRM access, editor permissions and production write restrictions. A focused client page manages upcoming/past views and create/edit/cancel forms.
**Tech Stack:** Next.js, React, TypeScript, PostgreSQL, node:test, PGlite, JSDOM.
**Spec:** docs/superpowers/specs/2026-11-19-training-classes-design.md

## Global Constraints
- Display dates in America/New_York with an explicit Eastern Time label.
- Use the existing authentication, same-origin checks, and production write restrictions.
- Do not add enrollment, recurrence, invitations, or calendar synchronization.
- Preserve other work and keep classes separate from recruiting stages.

## Review Focus
- Daylight saving gaps must be rejected; repeated times must be handled explicitly.
- Stale edits must fail rather than overwrite another editor's changes.
- Missing schema/database must yield an actionable error without exposing internals.
- Cancellation must persist and stay visible in the schedule.
- Failed saves must preserve the form and must not claim success.

### Task 1: Validation and persistence
Files: lib/training-classes.mjs, db/training-classes.mjs, migrations/0014_training_classes.sql, tests/training-classes.test.mjs.
Interfaces: validateClass(input) returns normalized class data; easternLocalToIso(value) converts form inputs; listClasses(database), saveClass(input, actor, database) query and persist records.
- [x] Write and run failing validation/timezone/concurrency/persistence tests.
- [x] Implement bounded fields, HTTPS links, date ordering and optimistic version checks.
- [x] Add idempotent versioned schema and lazy setup using the existing transaction/advisory-lock pattern.
- [x] Run tests using PGlite against the exact migration, including create/edit/cancel and audit fields.

### Task 2: Authenticated API
Files: app/api/training-classes/route.ts, lib/training-class-request.mjs, tests/training-class-request.test.mjs.
Interfaces: GET returns {classes,canManage}; POST accepts {action:'save'|'cancel',...} and returns saved class.
- [x] Write and run failing request tests for unsigned, unauthorized, cross-origin, disabled preview writes and oversized input.
- [x] Implement injectable request handling and fixed safe responses with private no-store headers.
- [x] Run API boundary tests including a conflict response.

### Task 3: Schedule page and navigation
Files: app/training-classes-page.tsx, app/training-classes.module.css, app/recruiting-navigation.mjs, app/recruiting-workspace.tsx, tests/training-classes-ui.test.mjs, tests/recruiting-navigation.test.mjs.
- [x] Add route #training-classes to RECRUITS_CHILD_PAGES and highlight Recruits.
- [x] Implement upcoming/past tabs, explicit canceled labels, empty/loading/error states and editor-only create/edit/cancel controls.
- [x] Add accessible labeled form with Eastern Time inputs, confirmation for cancellation and persistent drafts on failed saves.
- [x] Test read-only view, create/edit/cancel flow, failed save, and hash navigation.

### Task 4: Verification and handoff
- [x] Run relevant tests, lint, TypeScript, production-source tests, and npm run build.
- [x] Review the full diff for data leakage, permission bypasses, date errors and stale changes.
- [x] Document schema initialization and operational behavior; report verified results.

## Execution record
- Implemented the approved plan directly in the existing work branch.
- Task 1: validation/timezone and real PostgreSQL-compatible persistence tests passed.
- Task 2: authenticated API and write-boundary tests passed.
- Task 3: page interactions and navigation tests passed.
- Independent final review found duplicate-create replay, unload protection, read/write race, malformed-success handling, and stale-draft recovery gaps. Reproduction tests failed before the fixes and passed afterward.
- Decision: use the repository's existing advisory-lock schema initialization pattern, backed by a versioned migration, so the page can initialize safely without exposing database credentials or running unrelated migrations.
- Decision: include a stable create UUID and explicit conflict review to preserve edits and prevent duplicate creation.
- Final verification: full suite 663/663 passed; final UI regression, relevant ESLint, TypeScript, and production build/auth-bundle verification passed.
