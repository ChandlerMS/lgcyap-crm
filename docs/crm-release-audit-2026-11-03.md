# CRM source consolidation — November 3, 2026

Compared all registered local worktrees and fetched remote branches against current GitHub `main`, including patch-equivalent cherry-picks. Source worktrees and pending changes were left intact. Normal fast-forward pushes only; no force push or rollback of newer main changes.

## Already represented on main

- Version 1/Version 2 switch, iframe edge sizing and available-width layout.
- Legacy Bot embed and production provenance/presence guards.
- Queue navigation, embedded Queue, mobile width fixes and collapsible Recruits navigation.
- Connected recruiting tree, direct stage drops, HubSpot stage sync and current Today/Follow-up layout.
- Recruit intake validation implementation; the divergent validation branch's missing path-specific regression cases are included in this release.

## Consolidated in this release

- `7451489`: month/week picker and WhatsApp Sales spreadsheet import/read feature, including its API contract, additive tables, import CLI and tests. User explicitly chose to integrate it. No historical workbook data was imported by this consolidation.
- `a3d40a5`: Vercel Speed Insights integration and dependency lockfile.
- `67b719c` plus matching uncommitted Queue-release diff: Queue flex layout and board growth. Documentation heading normalized. The original files remain untouched in their source checkout.
- `ddd1e5c` through `de6f95b`: reviewed Claude worker launcher, collaboration documentation/readiness record and ignore rules. Current production instructions remain in force.
- `e275b7a`: Follow-up full-width rule was already present after newer main layout work; not applied twice.
- `d9f4cb9`: older bot embed was superseded by the current main embed; not applied twice.
- `6b2a28c`: intake implementation already present; preserve the additional invalid/missing recruiting-path test cases.
- `.sidebar-review.mjs` is an untracked local browser review helper, not an application change. It remains in the original sidebar worktree and is not bundled into production.

## Legacy Bot appearance

Native HubSpot chat channel `1434817084`, portal `50894788`: widget position Left; accent `#D4AF37`; existing black-and-gold Legacy logo; compact icon launcher on published chatflow `101790158`. These are HubSpot settings, not secrets or CSS injected into the cross-origin chat iframe. Recheck this live setting after changing the HubSpot channel or chatflow.

The CRM adds an accessible black button with gold text, icon and border at bottom-left. It uses HubSpot's documented widget open/close events and hides only the outer stock launcher while closed. The conversation itself retains HubSpot's native gold header, black-and-gold logo and standard light message area.

## Deployment

Production remains GitHub `main` through the existing Vercel Git integration. The guarded build rejects stale commits, wrong branches/repositories/projects, and a missing or wrong-portal bot embed. Active chats may keep advancing main; always fetch and integrate newer commits before publishing.
