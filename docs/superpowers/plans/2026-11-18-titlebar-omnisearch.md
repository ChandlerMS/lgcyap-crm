# Title bar and Omnisearch Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the isolated search-service task, with native UI integration and independent whole-change review.

**Goal:** Implement the approved responsive title bar, seven-area search, support navigation, launcher placement and heading sizes.
**Architecture:** Extend the existing VersionSwitch title bar with client controls from the recruiting workspace. Add an authenticated aggregate search API reusing fixed HubSpot readers, with resumable Inbox message scanning. Preserve existing permissions, edit guards and data sources.
**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, existing HubSpot private app.
**Spec:** docs/superpowers/specs/2026-11-18-workspace-titlebar-omnisearch-design.md

## Global Constraints
- Native unread counts remain unavailable until verified; never substitute open tickets or visit-based counts.
- No arbitrary provider endpoints, fields, filters or objects from the browser.
- Demo search must not call live HubSpot.
- Preserve owner restrictions for Calls and Meetings and Recruiting pipeline scope.
- Preserve Legacy Bot portal 50894788 and existing production-source build guard.
- Publish through current origin/main and the existing Vercel Git integration only.

## Review Focus
- Search responses cannot expose another viewer's owned records, credentials or unsafe URLs.
- Signed Inbox continuation belongs to the user/query, expires and preserves complete scan progress.
- Abort/late results, rate limits and partial source failures do not masquerade as complete results.
- Responsive title-bar measurement preserves usable content, navigation and mobile search.
- Unsaved editors disable data-mode changes/navigation as currently required.

### Task 1: Search service
- [x] Add lib/workspace-search.mjs and app/api/workspace-search/route.ts with request validation, auth, fixed sources and resumable Inbox search.
- [x] Write meaningful failing tests first in tests/workspace-search.test.mjs for auth, scoping, query limits, continuation tampering and partial results; implement and verify.
- [x] Review task diff and integrate its isolated commit.

### Task 2: Title bar, UI search and local adjustments
- [x] Add client title-bar controls and grouped keyboard-accessible omnisearch; wire Live/Demo modes and support links into VersionSwitch.
- [x] Remove the duplicate controls and support sidebar links, preserve old destinations.
- [x] Add fictional demo search and precise Inbox result navigation; reject unsafe search hrefs.
- [x] Move Legacy Bot beside RingCentral and enlarge SummaryChips headings.
- [x] Test view helpers and browser flows for all groups, demo isolation, partial Inbox continuation, failure, keyboard and responsive layout.

### Task 3: Verify and publish
- [x] Run relevant/full tests, type checking and build; review independently and fix important findings.
- [ ] Incorporate latest origin/main, push reviewed commits and verify matching ready production deployment.

## Execution record
- Pre-flight: UI consumes POST /api/workspace-search with the schema documented in work/titlebar-search/backend-brief.md. Search service owns lib/workspace-search.mjs, route and its test only. UI work owns other app files. Backend implementation uses an isolated worktree.

- Task 1: complete, isolated commit d1b6b30 cherry-picked as1399322; independent backend review approved, all532 backend-worktree tests passed.
- Task 2: frontend helpers and integrated browser fixtures cover all seven groups, exact Inbox navigation, stale cancellation, responsive title-bar height and launcher placement.
- Integrated tests536/536, type checking and production build passed before final review.
- Keyboard Escape originally triggered the browser search-input clear action; a failing browser check demonstrated this and preventDefault now preserves the query while closing results.
- Native unread counts remain null by design; the title-bar links accept genuine future unread-count values but display no fabricated badges.

- Final review: four important findings fixed. Live Recruit links now open fixed native HubSpot records (local demo links retained); Inbox cursors independently track active/archived message phases. Backend regression fixes committed as5c342c5 after independent review.
- UI regression checks reproduced a clipped tablet panel and premature zero-result status; viewport anchoring and completion-aware status now pass.
- Final full suite538/538, type checking and build passed. Browser fixtures passed1440/1024/768/721/390/320 widths, all seven source groups, continuation, keyboard, exact Inbox conversation, cancellation, cooldown/retry, demo isolation and unsaved-edit guards.
