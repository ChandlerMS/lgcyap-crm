# Standard vs. Preferred call import

The Standard vs. Preferred leaderboard's **Calls** and **Close** come from the RingCX report "Agent Close Rate - Standard vs Preferred SYNC" wherever it covers the range (2026-06-25 on, see [RingCX sync](#ringcx-sync)), and from the `Agent_Daily_Calls_YYYY-MM_Month_YYYY.xlsx` workbooks (source `AGENT_DAILY_CALLS_SVP`, metric: total calls connected/answered) for ranges wholly before that. Ranges outside both fall back to HubSpot inbound call logs, and the board's call notice says which source is in use.

## Run

```sh
npm run svp-calls:import -- "G:/My Drive/LGCYAP"           # validate only, no database change
npm run svp-calls:import -- "G:/My Drive/LGCYAP" --apply   # import; asks for the connection string if DATABASE_URL is not set
```

Each listed month replaces that month only. Re-running is no longer needed to keep the board current, and it cannot change days the report covers: report counts live in a separate table and win.

## How it is used

- Daily sheets (`YYYY-MM-DD`) are read; `Monthly_Summary` is ignored because its totals are formulas without saved values. `Unassigned (No Agent)` rows are skipped.
- Agents are matched to HubSpot writing agents by full name, ignoring case and extra spaces. Unmatched agents with calls count in the Calls total only.
- Agent Close = sold deals ÷ calls; total Close = all sold deals in the range ÷ all calls. Close is withheld when HubSpot may not have returned every deal.
- These are the same dialer calls the WhatsApp board shows from 2026-06-17 (identical daily totals); Hive Commander chose to show them on both boards.

Storage: `migrations/0007_svp_calls.sql` (`svp_calls_import_months`, `svp_calls_daily`), additive and reversible.

## RingCX sync

`GET /api/cron/svp-ringcx-calls` runs every five minutes (`vercel.json`, `CRON_SECRET`) and reads only from 9 AM to 9 PM Eastern, so the last read of the day is at 8:55 PM. The hours are checked in the route because a UTC cron schedule cannot follow daylight saving, using the same window as PolicyTek (`lib/policytek-schedule.mjs`). `lib/svp-ringcx-calls.mjs` reads the saved report [`aaB7aXOESEiB`](https://ringcx.ringcentral.com/analytics/voice/historical/reports/aaB7aXOESEiB) and stores Calls and Sold per agent per day.

- **Access.** RingCX's Historical reports run on GoodData and no public API exposes saved reports, so the job signs in the way RingCX's own page does: `POST /platform/api/ev-report-catalog/v1/gd/session/account/50560000` with the RingCX token, then GoodData's `customerlogin` and `token`. Those claims and cookies are credentials and are never logged or stored. This route is not a documented API, so a RingCX release could change it; the board then keeps its last counts and the status route says why.
- **The report is the definition.** Each run reloads the saved report and keeps its filters and its Calls and Sold measures, replacing only the date range and grouping by day and agent. Saving the report changes its `meta.updated`, which rebuilds all history. Renaming the Calls or Sold column, adding a row attribute or removing the Date (Started) filter fails the run with `REPORT_CHANGED`.
- **What each run reads.** The last seven days plus today, because dispositions can change after a call, and those days are replaced whole so vanished rows go away. Older days stay as first read, unless the report is saved.
- **Close Rate.** Report Sold ÷ report Calls, so an agent's Close Rate matches the report even where HubSpot's Policies sold differs.
- **Names.** Agents match HubSpot writing agents by full name. `AGENT_ALIASES` holds the three RingCX spellings that differ. Agents with calls but no HubSpot sale in the range count in the Calls total only.
- **Freshness.** RingCX reloads this data about every 8–12 minutes (four samples on 2026-11-03), so that limits the board more than the five-minute job. The notice shows RingCX's last load time, or how old the board's read is once it passes 15 minutes during sync hours.
- **Overnight.** The pause is planned, so the board shows no late warning. Until the 9 AM read, today counts as covered by the report with no calls yet, and the 9 AM read's seven-day re-read picks up anything RingCX loaded after the last read. Open pages stop reloading too, like Shopper and Source; loading the page still reads HubSpot live.
- **Failures.** A failed or empty read keeps earlier counts, because each write is one statement and an empty read never writes. Rejections are stored for the status route and never reach the board.
- **Status.** `GET /api/ringcx/calls-sync`, for signed-in editors, shows the last run, the error if any, the days covered, RingCX's last load time and the latest 15 days beside the imported workbook's Calls.

Storage: `migrations/0009_svp_ringcx_report.sql` (`svp_ringcx_report_daily`, and the report columns on `svp_ringcx_sync`), additive and reversible. `svp_ringcx_windows` and `svp_ringcx_days` from `0008` are unused and empty: RingCX refused the `agg-agent-extended-stats` report they were for with a 403. The RingCX login expires February 1, 2027 UTC (`docs/ringcx-dashboard.md`).
