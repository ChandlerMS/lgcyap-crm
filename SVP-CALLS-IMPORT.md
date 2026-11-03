# Standard vs. Preferred call import

The Standard vs. Preferred leaderboard's **Calls** and **Close** come from RingCX from 2026-11-03 on (see [RingCX sync](#ringcx-sync)) and from the `Agent_Daily_Calls_YYYY-MM_Month_YYYY.xlsx` workbooks (source `AGENT_DAILY_CALLS_SVP`, metric: total calls connected/answered) before that. Ranges wholly outside both fall back to HubSpot inbound call logs, and the board's call notice says which source is in use.

## Run

```sh
npm run svp-calls:import -- "G:/My Drive/LGCYAP"           # validate only, no database change
npm run svp-calls:import -- "G:/My Drive/LGCYAP" --apply   # import; asks for the connection string if DATABASE_URL is not set
```

Each listed month replaces that month only. Re-running is no longer needed to keep days from 2026-11-03 on current, and it cannot change them: RingCX counts live in separate tables and win for any day RingCX has fully read.

## How it is used

- Daily sheets (`YYYY-MM-DD`) are read; `Monthly_Summary` is ignored because its totals are formulas without saved values. `Unassigned (No Agent)` rows are skipped.
- Agents are matched to HubSpot writing agents by full name, ignoring case and extra spaces. Unmatched agents with calls count in the Calls total only.
- Agent Close = sold deals ÷ calls; total Close = all sold deals in the range ÷ all calls. Close is withheld when HubSpot may not have returned every deal.
- These are the same dialer calls the WhatsApp board shows from 2026-06-17 (identical daily totals); Hive Commander chose to show them on both boards.

Storage: `migrations/0007_svp_calls.sql` (`svp_calls_import_months`, `svp_calls_daily`), additive and reversible.

## RingCX sync

`GET /api/cron/svp-ringcx-calls` runs every five minutes (`vercel.json`, `CRON_SECRET`). `lib/svp-ringcx-calls.mjs` reads RingCX's `agg-agent-extended-stats` report and stores answered calls (`answIxnCnt`) per agent for the queues in group 1973.

- **Windows.** Each Eastern day is 12 two-hour windows. A run makes at most two report reads: the newest window with unread data and the oldest one. Finished windows are rechecked every 15 minutes until an hour after they end, then settled. That is 4–6 of RingCX's 9 report requests per 15 minutes.
- **Freshness.** RingCX refuses windows newer than five minutes and groups calls in 15-minute blocks, so counts can trail live calls by up to about 20 minutes (estimate from RingCX's docs).
- **When a day joins the board.** Once every started window has been read, recorded in `svp_ringcx_days`. A later failure keeps the last good counts, and the notice says when they were last read.
- **Failures.** Upstream rejections are stored for the status route and never reach the board. Calls with no agent are skipped, as in the workbooks.
- **Status.** `GET /api/ringcx/calls-sync`, for signed-in editors, shows the last run, per-day progress, and RingCX against the imported workbook, agent by agent, for each fully read day. 2026-11-02 is read only for this comparison. The 2026-11-03 workbook covers part of that day, so its comparison will not match.

Storage: `migrations/0008_svp_ringcx_calls.sql` (`svp_ringcx_windows`, `svp_ringcx_days`, `svp_ringcx_sync`), additive and reversible. The RingCX login expires February 1, 2027 UTC (`docs/ringcx-dashboard.md`).
