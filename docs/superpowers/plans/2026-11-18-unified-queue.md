# Unified Queue Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display both live dashboards together at queue.lgcyap.com, grouped by source.
**Architecture:** Compose existing React dashboards inside a responsive shared page; preserve authenticated APIs and source polling. Route only the Queue hostname's root to the combined page. Reuse canonical CRM Google login and copy only a verified, unexpired session into a distinctly named Queue cookie on the parent domain through a fixed authenticated handoff route.
**Tech Stack:** Next.js 16, React 19, Better Auth, Vercel Git deployment.
**Spec:** docs/superpowers/specs/2026-11-18-unified-queue-design.md

## Global Constraints
- Preserve separate source metrics, timers, errors and refresh rates.
- Retain approved-employee access and exact origin checks; no wildcard trusted origins.
- Existing Vercel project only; production publication through origin/main only.

## Review Focus
- Queue POSTs must work only from an exact approved same origin.
- Session handoff must reject forged, expired and unapproved sessions and never include a token in a URL.
- Source failures must leave the other dashboard usable.
- Legacy queue and ringcx URLs/hashes must remain usable.
- Wide and narrow layouts must retain all metrics and accessible heading structure.

### Task 1: Unified presentation and navigation
- [x] Compose both dashboards in app/queue/unified-queue.tsx with app/queue/unified-queue.module.css.
- [x] Add compact grouped rendering to queue-board.tsx and ringcx-dashboard.tsx without changing source polling.
- [x] Update app/queue/page.tsx, app/ringcx/page.tsx and sidebar navigation to show the combined page; preserve old hashes.
- [x] Verify server-rendered composition, navigation and existing queue/RingCX tests.

### Task 2: Host routing and authenticated access
- [x] Add failing tests in tests/queue-host.test.mjs for exact host rewrites, login redirects, same-origin queue reads and verified session handoff.
- [x] Implement lib/queue-host.mjs and app/queue-access/route.ts; update next.config.ts and app/api/queue/route.ts.
- [x] Test with real Better Auth signed sessions in tests/auth-integration.test.mjs, including forged/expired/revoked sessions.
- [ ] Run full tests, typecheck and build; independently review the diff.

### Task 3: Publication
- [ ] Attach queue.lgcyap.com to existing Vercel project and verify DNS/TLS.
- [ ] Fetch origin/main, incorporate changes, push reviewed change to main.
- [ ] Verify Git deployment commit and anonymous/sign-in redirects at both hostnames.

## Verification and review record
- Source groups render concurrently in the real React components; one main landmark and separate level-two headings.
- Browser fixture checks passed at 1600, 1280, 768 and 390 pixels with no horizontal overflow; tested each upstream failing while the other source remained visible. Screenshots are local QA artifacts in work/queue-ui-qa.
- Independent review found a same-name parent/host cookie collision on sign-out followed by login. Fixed using a distinct Queue cookie and host-specific server-side adaptation. Verified through real Better Auth/PGlite tests for re-login, forged/expired/revoked/unapproved sessions and cookie/session mismatch.
- No unresolved review findings.
