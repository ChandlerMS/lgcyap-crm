# Gmail in-app Implementation Plan

> **For agentic workers:** Use isolated worktrees for parallel mailbox and frontend work; coordinator owns integration and sending.

**Goal:** Read, reply, select templates and send Gmail messages entirely in the CRM Email workspace.
**Architecture:** Gmail API through authenticated production server routes, native React inbox/composer, encrypted existing Google connection.
**Tech Stack:** Next.js 16, React 19, Node/Postgres, Gmail REST API.
**Spec:** docs/superpowers/specs/2026-11-19-gmail-in-app-design.md

## Constraints and review focus

No website embedding or automatic Gmail launch. Own verified employee email and Google subject only; no credentials in browser. Keep source guard, sign-in and Sheets intact. Tests use synthetic mail and mocked Google. Check partial mailbox failures, hostile MIME/HTML, stale async UI/account changes, changed recipients/previews and ambiguous sends.

## Tasks

- [ ] Expand Gmail consent/status/access with readonly permission and a backwards-compatible reconnect state. Test old and new grants, missing consent, wrong identity.
- [ ] Add lib/gmail-mail.mjs and /api/gmail/mail for paged Inbox/Sent and message reading; export readReplyTarget for composer. Test authorization, bounded work, MIME sanitization, incomplete/provider errors and safe reply headers.
- [ ] Extend lib/gmail-compose.mjs preview/prepare for replyMessageId and send action. Add gmail_send_requests schema/migration and preview-bound durable send/confirmation tests, including ambiguity/duplicate replays. Keep old drafts backwards compatible.
- [ ] Update composer and Email connection panel with mailbox, reading/reply, template dropdown and explicit preview/send, no Gmail launch. Test template selection, successful/uncertain sends, close/account races and mailbox paging.
- [ ] Update privacy and setup docs; independently review; run relevant/full tests, TypeScript, lint and build; integrate current main, push through Git deployment and verify production commit.
