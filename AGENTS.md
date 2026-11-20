<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Production deployments

- Version 2 (`/v2`) requires CRM sign-in, then redirects to `https://lgcy-onboard.carlos-831.workers.dev/` as a top-level navigation. Do not restore the cross-site iframe: the browser refused its navigation and the site's SameSite=Lax session also prevents reliable embedded sign-in. The site's source is `LegacyAgencyPartners/LGCY-Onboard` (Cloudflare app in `onboard/` and the root mockup). Its deployment requires access to its owning Cloudflare account. Legacy Vercel routes and their separate database remain unchanged.

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

## Bottom window launchers

Use `FloatingLauncher` from `app/floating-launcher.tsx` for every bottom window button,
inside `FloatingActions`. Keep WhatsApp, PolicyTek and RingCentral in `floating-actions-communications` on the bottom right. Keep Legacy Bot and Support in `legacy-bot-dock` at the bottom left of the workspace, just to the right of the expanded desktop sidebar, with Support immediately to the right of Legacy Bot. Gemini has been removed. Supply its current `expanded` state and `onExpand`/`onCollapse`
callbacks. Keep the launcher visible while open. Embedded windows must remain mounted
when collapsed so sign-in and ongoing work survive. WhatsApp is a separate popup and
its second click closes that popup. The dock measures its wrapped height so panels
remain above all buttons on narrow screens.

## lgcyap-crm design rules

The CRM (crm.lgcyap.com, also lgcyap-crm.vercel.app) is Legacy Agency Partners' private recruiting workspace, used by signed-in staff. Follow these rules for any change to how the site looks. They cover Version 1, the HubSpot-connected workspace; Version 2 (`/v2`) opens the separate LGCY Onboard site, which these rules don't cover. The goal in one line: **everything fits neatly and is easy to read without wasting space.**

### Brand

- The site is always black and gold.
- Use only the named colors in `:root` at the top of `app/globals.css` (`--canvas`, `--sidebar`, `--panel`, `--gold`, `--gold-hover`, `--text`, `--muted`, `--line`, `--control-line`, `--error`). Never type a new hex value into a style. If a design needs a new shade, add a named variable to `:root` first, then use it.
- The stylesheets already hold ~370 distinct one-off hex values, and the number keeps growing. Most are black, gold, or beige near-duplicates (`#e1c66f` vs `#ddc46f`). When you edit a rule that has one, swap it for the closest named color instead of adding another.
- Gold is for emphasis: the active menu item, key numbers and counts, main buttons, links. Don't fill large areas with gold.
- No other hues (blue, green, purple, etc.). Errors use `--error`. A few older status colors break this rule (green for ready, done, and approved in Shopper, Event Attendance, and quick actions; `#f08080` for Deny). Don't add more, and ask before recoloring them.

#### Logo

- The full logo is `public/legacy-logo.png`: a gold-and-white mark above the gold word LEGACY, with AGENCY PARTNERS in white underneath, on a transparent background. Its white parts vanish on light backgrounds (and in image viewers with a white background), so it only goes on the dark theme. Its alt text stays "Legacy Agency Partners".
- The mark alone is `public/v2/brand/legacy-mark-light.png` (cream strokes and the gold swoosh, made for dark backgrounds). Don't use `legacy-mark-dark.png` on black; its strokes disappear.
- Keep the logo visible whenever possible. The full logo stays at the top of the sidebar; in the Leaderboard and Lead Data headers; on the Shopper (`app/queue`), Standard vs Preferred (`app/ringcx`), Event Attendance, and TV boards; and on the sign-in and sign-out cards.
- The mark alone sits at the very top of every page: the left end of the LEGACY WORKSPACE bar (`app/version-switch.tsx`), just before the words LEGACY WORKSPACE. It stays visible when the sidebar is hidden (collapsed on a computer, or closed on a phone).
- Never stretch, recolor, or crop the logo, and never place it on a light background.

### Layout and space

- No large empty voids. When part of a page sits empty, fill it with something small and useful.
- Anything added to empty space must fit in height the page already has. It must never push the content below it down.
- In small spaces, show more items with less detail each, with the full detail one click away.
- Get density from smaller gaps, never from smaller controls or text. Buttons, inputs, and menu items keep their 44px minimum height, and text stays high-contrast.
- Spacing comes from the fixed scale in `:root`: `--space-1` to `--space-7` = 4, 8, 12, 16, 24, 32, 48px. Use it instead of one-off numbers. Most existing rules still use raw pixels, so switch the ones you edit.
- Known oversized spots to tighten when you work nearby: `.data-table td` (20px top and bottom) and `.content` (1440px cap plus 48px padding, which leaves dark bands on large monitors).

**Worked example: the summary cards on the Dashboard.** The Dashboard menu item opens `#today`, the page this project used to call the Recruits page. From the top:
- The recruiting pipeline starts collapsed.
- A row of small cards: Tasks, Follow up, Meetings, Calendar, Email, Inbox, Help Desk, and Tickets (`.today-summaries`, built from `app/summary-chips.tsx`). The row shows 4 cards across on computers, 2 under 1100px, and 1 on phones.
- Event Attendance.
- The full panels, one per row.

Each card shows its title and a gold count, a one-line note, the first 3 names with a short gold badge, and "+N more" for the rest. For Follow up the badge is days waiting, longest first. Hovering a card's title lists every item with its details; Follow up adds Call, Text, and Email buttons. A chevron folds a card down to its title row.

This grew out of the first version (`50529b4`, Nov 3), which put Follow Up name chips into the empty space beside the old Today title without pushing anything down. Names with a short badge were chosen over a detailed card because seeing more people at a glance matters more than showing each person's stage, which stays one hover away.

### Who uses it

- Staff, on computers. Design for laptops through large monitors first.
- On wide screens, let tables and lists use the width; keep paragraphs at a comfortable reading width.
- Phones must still work, with nothing broken, cut off, or overlapping, but they don't drive design decisions.

### Previews and going live

- Every design change gets a preview before it goes live: screenshots of each changed page at computer width (add a phone screenshot only if the phone layout changed), plus a short plain-language list of what changed. Screenshots are enough; no live link is needed. Use Demo data, not real recruits, in screenshots.
- Build and screenshot from the latest `origin/main` code. Older branches can look very different from the live site.
- **Wait for the user's explicit command before pushing or merging to `main`**, which publishes the live CRM. When the command comes, publish only as "Production deployments" above describes.
- Local preview: `.claude/launch.json` runs `next dev` on port 3000. Adding `?demo=1` (for example `http://localhost:3000/?demo=1#today`) switches the workspace to Demo data, but only after Google sign-in.
  - The sign-in-free local preview on branch `claude/local-demo-preview` (`9b1cfcf`) was never merged, and it now conflicts with `main`.
  - Until something like it is on `main`, previews need a temporary local sign-in stub, plus stand-in API routes for pages fed by live data. Never commit the stub.
  - If you can't reach a page to screenshot it, say so; don't skip the preview.

### Boundaries

- Design changes change how the site looks, not what it does. Don't change how records save to HubSpot, the PolicyTek, RingCentral, or lifecycle syncs, sign-in and access, or API routes as part of design work. If a design idea needs any of that, ask first.
- Keep the accessibility that is already there: the skip link, visible focus states, labels on icon-only buttons, and screen-reader text.
