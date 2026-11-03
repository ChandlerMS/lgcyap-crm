<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Codex coordinator / Claude Code worker

- Address the user as Hive Commander; use short, clear bullet updates.
- Codex owns task assignment, independent review, verification, and integration.
- Claude Code edits only its own worktree and branch. Never run concurrent writers in one checkout.
- Read `docs/collaboration/README.md` before coordinating Claude work.
- Use `scripts/Invoke-ClaudeWorker.ps1` with a bounded task file. It records task/result files locally.
- After Claude returns, inspect its actual diff and run relevant checks independently. Resolve unrelated edits before integration.
- Codex handles commands, tests, commits, pushes, and Vercel actions; the default Claude worker has file tools only.
- Keep credentials, environment files, and customer records out of task packets and logs.
- Both checkouts target existing Vercel project `legacy-recruiting-private`, team `main-team8`; never create a second Vercel project.
- Do not deploy, merge into main, or push merely to test collaboration. Follow the user's deployment authorization for actual work.
