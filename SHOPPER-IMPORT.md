# Shopper report import

The Shopper leaderboard's **Calls**, **Close rate**, **Submitted** and **Submitted premium** come from two PolicyTek exports wherever they cover every day of the selected range:

- **Calls report** (`calls-report_MM-DD-YYYY_HHMM.xlsx`): every inbound call row counts as one call for its agent, on the call's date.
- **Applications report** (`applications-report_MM-DD-YYYY_HHMM.xlsx`): every row counts as one submitted application for its agent on its Policy: Application Submit Date, and its Policy: Premium adds to Submitted premium.

Close rate is submitted ÷ calls. Ranges that run past the last imported day (today, this week, this month) or start before either report's first imported day keep the PolicyTek browser sync described in `POLICYTEK-SYNC.md`, so the board stays live while past months and weeks use the reports. Days before a report's first row are treated as unknown, not empty.

## Run

```sh
npm run shopper:import -- "C:/Users/<you>/Downloads"           # validate only, no database change
npm run shopper:import -- "C:/Users/<you>/Downloads" --apply   # import; asks for the connection string if DATABASE_URL is not set
```

A folder imports every `calls-report_*.xlsx` and `applications-report_*.xlsx` in it; single files work too. Exports for several date ranges can be imported together. The output names files, dates and counts only, never agents, callers or customers.

## How it is read

- **Days.** Call times and submit dates are Eastern, as exported. Rows dated on the export day (from the file name) are skipped because that day is unfinished; re-export it the next day.
- **Coverage.** Each report covers every day from its first to its last row, including days with no activity. An import replaces that report's rows for exactly those days; other days and the other report are untouched. More than three days with no rows between two files of one report stops the import, because an export is probably missing.
- **Overlapping exports.** Two files of one report that cover the same days must hold identical rows on those days, each repeated the same number of times, and then those rows count once (as often as one file has them). If they differ (for example an older export whose rows were updated since), the import stops and names both files: import only one export for those days. Rows within one file are the report's own and all count, including the few applications that share a policy number.
- **Names.** Agents are matched by full name, ignoring case and extra spaces. The Calls report includes middle initials ("First R Last") and the Applications report does not, so single-letter middle initials are dropped before matching. If two agents differ only by middle initial, both keep their full names and neither is merged. The shown name prefers the Applications report's spelling.
- **Agents with calls but no applications** count in the Calls total but are not ranked, as on the browser-sync board. Additional agents on an application are not credited; the application counts for its agent.

Storage: `migrations/0017_shopper_reports.sql` (`shopper_report_imports`, `shopper_report_days`, `shopper_calls_daily`, `shopper_applications_daily`), additive and reversible. Only per-agent daily totals are stored; no caller, customer, phone, carrier or policy details.
