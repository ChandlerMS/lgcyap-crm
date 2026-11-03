# Standard vs. Preferred call import

The Standard vs. Preferred leaderboard's **Calls** and **Close** come from the `Agent_Daily_Calls_YYYY-MM_Month_YYYY.xlsx` workbooks (source `AGENT_DAILY_CALLS_SVP`, metric: total calls connected/answered) for any range those workbooks cover. Ranges wholly outside the imported days fall back to HubSpot inbound call logs, and the board's call notice says which source is in use.

## Run

```sh
npm run svp-calls:import -- "G:/My Drive/LGCYAP"           # validate only, no database change
npm run svp-calls:import -- "G:/My Drive/LGCYAP" --apply   # import; asks for the connection string if DATABASE_URL is not set
```

Each listed month replaces that month only. Re-run after new workbooks are exported; days after the last imported day use HubSpot logs until then.

## How it is used

- Daily sheets (`YYYY-MM-DD`) are read; `Monthly_Summary` is ignored because its totals are formulas without saved values. `Unassigned (No Agent)` rows are skipped.
- Agents are matched to HubSpot writing agents by full name, ignoring case and extra spaces. Unmatched agents with calls count in the Calls total only.
- Agent Close = sold deals ÷ calls; total Close = all sold deals in the range ÷ all calls. Close is withheld when HubSpot may not have returned every deal.
- These are the same dialer calls the WhatsApp board shows from 2026-06-17 (identical daily totals); Hive Commander chose to show them on both boards.

Storage: `migrations/0007_svp_calls.sql` (`svp_calls_import_months`, `svp_calls_daily`), additive and reversible.
