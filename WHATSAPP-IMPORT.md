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

- The report owner confirmed that "Total Production" is annual premium. The WhatsApp Sales view displays it as "Annual premium" and "Number of Sales" as "Policies sold"; imported values are unchanged.
- On the page, "Calls" = connected (answered) inbound queue calls and "Close" = queue sold ÷ those calls, both from
  the dialer report. Close is not derived from sales rows. Other boards keep their own labels (HubSpot shows inbound
  call logs and sold/log ratio, which are not answered calls or a close rate). Unmapped dialer seats count in totals but in no agent's row.
- Ranges outside imported months, or past the latest imported activity, are marked incomplete.

## Verification (2026-11-03)

All 29 monthly reports (2024-07 to 2026-11, 38,489 agent-days, 6,790 queue rows) were validated. Imported into an
in-memory database, every one of 739 days matched the Total row Excel computed on that day's sheet for sales,
production (to the cent), connected calls and queue sold. Tests: `tests/whatsapp-sales.test.mjs`.

## Leaderboard navigation

WhatsApp Sales has its own top-level tab beside Leaderboard and Call Analytics.
Its All view reads the combined imported reports. Standard vs Preferred is a
separate dataset read from the Standard vs Preferred WhatsApp group chat (below);
it never uses HubSpot or All figures, and until that chat is imported it shows an
explicit unavailable state with empty rows. Daily, Weekly, Monthly and Custom
periods and the policies-sold/annual-premium ranking controls remain available
for both views.

## Standard vs Preferred chat import

In WhatsApp, export the Standard vs Preferred group without media, unzip it, and pass the `.txt` file:

```bash
npm run whatsapp-svp:import -- "C:/Users/Chand/Downloads/Standard vs Preferred/chat.txt"
npm run whatsapp-svp:import -- "C:/Users/Chand/Downloads/Standard vs Preferred/chat.txt" --apply
```

Without `--apply` the export is only parsed and summarized (message, sale, day and poster counts, never names or
amounts). With `--apply` it asks for the connection string if `DATABASE_URL` is not set, then, in one transaction,
replaces every day from the export's first message through its last. Days outside the export are kept, so an export
from a phone with shorter history cannot erase earlier days. If the export starts after the imported posts begin, its
first day may start mid-day, so the stored rows for that day are kept and replacement starts the next day; such an
export is refused if it starts on or after the last imported day, because neither copy of that day would be whole. An
export that ends before the posts already imported is refused too. A refused export changes nothing. Re-run with each
newer export; its last day replaces the partial day the previous export ended on.

`lib/whatsapp-chat-sales.mjs` reads sale posts with the rules that rebuilt the LAP Daily Agent Reports from the main
sales chat: one sale per amount line (His and Hers count separately); Total, Both and `=` lines are dropped when the
message has other amounts; day, week and `$40k`-style figures, amounts in prose, dates and phone numbers are ignored;
amounts without `$` count with cents or next to His/Hers, a carrier or an emoji; obvious typos such as `$1.884.72`,
`$2.015.4`, `$3002,76` and `525$` are read as amounts; the poster is credited; and the same post again (all of its
sale lines) from the same poster within 30 minutes counts once, while a new post that shares only some lines counts in full. Days follow the chat's own clock (the exporting phone's time zone). Posters are grouped
by their WhatsApp name, case-insensitively, so a poster saved only as a phone number appears as that number.

Storage: `migrations/0020_whatsapp_svp_sales.sql` (`whatsapp_svp_sales_daily` and the one-row `whatsapp_svp_import`
coverage), additive and reversible with `DROP TABLE whatsapp_svp_sales_daily, whatsapp_svp_import;`. The view shows
each post's amount as annual premium and each amount line as one policy sold. The chat has no dialer calls, so Calls
and Close are blank. Ranges that start before the imported chat or reach the export's last day are marked incomplete,
and the notice gives the export's last message time. Tests: `tests/whatsapp-svp-sales.test.mjs`.
