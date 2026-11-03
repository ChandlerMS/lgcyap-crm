# WhatsApp Sales import

The WhatsApp Sales leaderboard reads daily agent rows imported from the monthly
`LAP Daily Agent Report - YYYY-MM Month.xlsx` workbooks, which are generated from
`LAP Historical Production - Daily.xlsx`. Only each workbook's raw `Agent Detail` and
`Queue Call Data` sheets are read; the day sheets' formulas are not used.

## Run it

```bash
npm run whatsapp:import -- "C:/Users/Chand/OneDrive/Documents/LAP Daily Agent Reports"
npm run whatsapp:import -- "C:/Users/Chand/OneDrive/Documents/LAP Daily Agent Reports" --apply
```

Without `--apply` the files are only validated and summarized (counts per month, never names or amounts).
With `--apply` the database in `DATABASE_URL` is updated in one transaction: every supplied month is replaced,
other months stay as they are, and any validation or database error leaves everything unchanged.
Re-run after regenerating the monthly reports. Months removed from the folder are not deleted.

## What is stored

- `whatsapp_sales_daily`: date, agent (grouped case-insensitively, as the reports' SUMIFS do), Number of Sales,
  Total Production in cents.
- `whatsapp_queue_daily`: date, dialer seat, mapped agent (blank in the source = unmapped seat), Sold, Calls,
  Connected (Answered). Present from 2026-06-17, the first day of the dialer report.
- `whatsapp_import_months`: month, file name, SHA-256, row counts, latest activity date, import time.

Migration `0006_whatsapp_sales.sql` is additive. Reverse it with
`DROP TABLE whatsapp_queue_daily, whatsapp_sales_daily, whatsapp_import_months;`.

## Labels and limits

- "Total production" is the reports' own figure, not HubSpot annual premium.
- On the page, "Calls" = connected (answered) inbound queue calls and "Close" = queue sold ÷ those calls, both from
  the dialer report. Close is not derived from sales rows. Other boards keep their own labels (HubSpot shows inbound
  call logs and sold/log ratio, which are not answered calls or a close rate). Unmapped dialer seats count in totals but in no agent's row.
- Ranges outside imported months, or past the latest imported activity, are marked incomplete.

## Verification (2026-11-03)

All 29 monthly reports (2024-07 to 2026-11, 38,489 agent-days, 6,790 queue rows) were validated. Imported into an
in-memory database, every one of 739 days matched the Total row Excel computed on that day's sheet for sales,
production (to the cent), connected calls and queue sold. Tests: `tests/whatsapp-sales.test.mjs`.
