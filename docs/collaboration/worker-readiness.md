# Worker readiness

- Claude Code is the implementation worker; Codex coordinates, verifies, and integrates.
- Work is isolated to the Claude worker checkout and branch (`worktree-recruiting-worker`).
- The shared Vercel project is `legacy-recruiting-private` in `main-team8`.
- Codex runs checks and handles Git and deployment actions.
- This readiness task does not test application code or deploy anything.
