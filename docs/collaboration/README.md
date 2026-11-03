# Codex + Claude Code collaboration

## Project

- GitHub: `https://github.com/ChandlerMS/lgcyap-crm`
- Vercel team: `main-team8` (`team_QQUI11r0DA1T0deViNT5khbf`)
- Vercel project: `legacy-recruiting-private` (`prj_tAhuHcbCr3HXxant1EGPbaFLjc6E`)
- Production branch: `main`. Collaboration setup is local and does not deploy.
- Coordinator checkout: `C:\Users\Chand\hubspot-front-end\lgcyap-crm-coordinator`
- Coordinator branch: `codex/claude-coordination`
- Worker checkout: `.claude/worktrees/recruiting-worker` inside the coordinator checkout.
- Worker branch: `worktree-recruiting-worker` (created by Claude Code's native worktree support).

## Working agreement

Codex writes a task packet naming the goal, allowed paths, acceptance criteria, and forbidden actions.
Claude edits files in its isolated checkout and returns a result. Codex inspects the diff,
runs checks, commits the reviewed worker changes, and integrates them into the coordinator branch.
Only reviewed, tested work moves to main under the user's authorization.
Neither model shares conversation history automatically; task packets and results are the handoff.

The worker uses file tools only, no shell tools or connected MCP servers. This lets Codex
own builds, tests, Git operations, and deployments. Tool restrictions and prompts are not
an operating-system sandbox; use a container or separate account for hostile code.
Do not place customer information or credentials in tasks. Environment files are denied.

## Dispatch from Codex

1. Save a UTF-8 task file outside the tracked source (for example in `.collaboration/runs/`).
2. From the coordinator checkout, run:

```powershell
& .\scripts\Invoke-ClaudeWorker.ps1 -TaskFile 'C:\path\to\task.md'
```

Use `-ValidateOnly` to check setup without calling Claude. The launcher uses the existing
Claude subscription and default model. It runs one task and exits; no background service is installed.
Every task has a unique ignored run folder containing its input, JSON result, and diagnostics.

The launcher refuses dirty worker checkouts. Codex must review and commit or otherwise resolve
the previous task first. It does not reset files or automatically merge divergent branches.
It creates the worker with native `claude --worktree` on the first task. Later tasks run in
the existing worker checkout. Before dispatch, Codex synchronizes reviewed changes when needed
using a fast-forward merge in the clean worker, or creates a new task worktree for divergent work.

## Review and integration

- Verify the worker branch and changed paths against the task packet.
- Run appropriate checks from the worker, with its own dependencies installed when needed.
- Inspect `git diff` and `git diff --check`; do not rely solely on Claude's summary.
- Commit only the reviewed paths on the worker branch, then cherry-pick that commit into the coordinator branch.
- Never copy `.env` files between checkouts. Fetch only the environment needed for an assigned task.
- Each checkout's ignored `.vercel/project.json` points to the same project; verify with
  `vercel project inspect --non-interactive` before a Vercel action.
- Vercel Git integration already uses the same repository. Pushing a work branch can trigger
  a preview deployment; production uses main. No push is needed for local collaboration.

## Task packet template

```text
Goal:
Allowed paths:
Acceptance criteria:
Forbidden actions: no secrets, production changes, pushes, or edits outside allowed paths.
Return: status, files changed, checks run, checks needed, blockers. Then stop.
```
