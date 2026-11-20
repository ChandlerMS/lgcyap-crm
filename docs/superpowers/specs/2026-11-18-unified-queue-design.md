# Unified Queue design

## Intent
Create one live Queue page at queue.lgcyap.com with Shopper and Standard vs Preferred visible together, grouped by source as requested.

## Experience
Use a shared Legacy black-and-gold page header. Show Shopper and Standard vs Preferred as clearly named sections, side by side on wide screens and stacked on smaller screens. Both sections load immediately; no tabs or source switch is required. Retain all current source metrics, agent rosters, source explanations, independent refresh intervals, and unavailable/stale states. Do not combine totals or wait measurements: the sources measure different things.

## Approach
Reuse the existing dashboard components and their authenticated API endpoints in a shared page. This preserves established behavior and avoids duplicating integration logic. A merged agent list was considered; the user selected separate source groups. Separate pages or tabs would not meet the requirement to see both dashboards together.

## Navigation and hosting
Replace the two sidebar entries with one Queue entry. Preserve old route/hash links through compatibility handling. Use the existing legacy-recruiting-private Vercel project in main-team8, with host-specific routing so queue.lgcyap.com opens the combined page and crm.lgcyap.com retains its recruiting home. Add the queue domain and verify DNS/TLS through Vercel.

## Authentication and constraints
Retain approved-employee Google sign-in and existing API authorization. Current authentication accepts only its configured canonical origin; the queue host therefore requires an explicit, narrowly scoped sign-in design, not merely a domain alias. Resolve this during implementation using supported Better Auth configuration and regression tests. Do not broaden trusted origins to wildcards or expose live records publicly.

## Validation and publication
Check responsive layout, simultaneous source rendering, independent source failures, old links, anonymous access and sign-in return behavior. Run relevant queue, RingCX, authentication and production-source tests, type checking and a production build. Publish only through main in ChandlerMS/lgcyap-crm and verify the deployed commit, as required by AGENTS.md. Report any hosting or sign-in configuration that cannot be completed with available access.
