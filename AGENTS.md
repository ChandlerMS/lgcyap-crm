<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Production deployments

- Production is `main` in `ChandlerMS/lgcyap-crm` on GitHub, deployed by the existing Vercel Git integration.
- Before publishing, fetch `origin/main` and incorporate its latest changes without overwriting other work. Push or merge the complete reviewed change to `main`; wait for that Git deployment and verify its commit against GitHub.
- Do not use local `vercel --prod`, `vercel deploy --prod`, prebuilt production uploads, arbitrary alias assignments, or promotion of another branch to publish this project. Local checkouts are for development and preview deployments.
- Vercel's project Build Command must remain `node scripts/verify-production-source.mjs && npm run build && node scripts/verify-production-source.mjs`. The same command is versioned in `vercel.json` so the current code and project settings agree. An older checkout without the guard must fail its production build.
- The guard checks production project, GitHub repository metadata, `main`, and equality with the current remote `main` SHA. If GitHub cannot be checked, the build must fail closed; do not bypass it to make a deployment pass.
- Keep the main-page Legacy Bot chat embed for HubSpot portal `50894788`. The production guard rejects its removal or a different portal. Run `node --test tests/production-source.test.mjs` when editing the main page or deployment checks.
- Repository/build checks prevent accidental stale deployments; Vercel owners can override configuration, use prebuilt uploads, or move aliases. Do not claim these checks remove an owner's platform permissions.

## Codex coordinator / Claude Code worker

- Codex owns assignment, independent review, verification, Git integration, and deployment.
- Claude Code works only in its assigned isolated worktree. Read `docs/collaboration/README.md` before using `scripts/Invoke-ClaudeWorker.ps1` for a bounded task.
- Inspect the actual diff and run relevant checks after a worker returns. Never run concurrent writers in one checkout.
- Keep credentials, environment files, and customer records out of task packets and logs.
- Both checkouts target existing Vercel project `legacy-recruiting-private`, team `main-team8`. Never create a duplicate project or deploy merely to test collaboration.
