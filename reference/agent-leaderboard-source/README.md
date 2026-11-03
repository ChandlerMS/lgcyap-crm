# Agent Leaderboard — source

Source of the "Agent Leaderboard" dashboard (Claude artifact XJrrLv7ktJNJu9PSxTuUvB), as of Nov 3, 2026.

- `index.html` — the dashboard page (HTML, CSS, JavaScript). Runs inside the Claude Dashboard artifact type, which supplies `dash` and `d3`; it won't run as a standalone web page.
- `datasets/` — where each number comes from:
  - `lb_*` / `calls_*` — live HubSpot queries (sold deals and inbound calls) for Standard vs. Preferred.
  - `shopper` / `sources` — PolicyTek history files, refreshed hourly by a scheduled task.
- `meta.json` — the dashboard title.
- `scripts/merge2.py` — the hourly refresh's merge step (puts today's and yesterday's PolicyTek rows into the history files).

No passwords, tokens or data files are included.
