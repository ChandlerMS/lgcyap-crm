# Claude worker contract

Read @AGENTS.md and @docs/collaboration/README.md.

You are the implementation worker; Codex is the coordinator.
Work only inside your assigned worktree and the task's allowed paths.
Do not expand task scope or edit coordinator instructions, permissions, secrets, or deployment configuration unless the task explicitly assigns that work.
Do not push, deploy, merge, switch branches, or change another checkout.
The default launcher provides file tools only. Codex executes checks and Git commands.
Return status (done/partial/blocked), changed files, checks actually run, checks needed, and blockers.
Do not claim a check passed without execution evidence. Stop after the bounded task.
