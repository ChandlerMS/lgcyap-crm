# Lead Data

The Lead Data page (`/#lead-data`, directly under Leaderboard) shows Instant Disconnects and Short Duration Calls by agent, with the same date controls as the Leaderboard.

## RingCentral

`/api/cron/lead-data` runs every five minutes, 9 AM–9 PM Eastern, and reads two saved RingCX reports. Their saved filters are kept; only the date range is replaced.

| Page tab | RingCX report | Identifier | Counted |
| --- | --- | --- | --- |
| Instant Disconnects | Instant Hangups | `aar8hEE2iLsP` | Calls with an Interaction Time of 2 seconds or less |
| Short Duration Calls | Short Duration Calls | `aav8r2fboaCP` | Every call in the report |

- Both reports filter on a handle time of 0–9 seconds. That is why Short Duration Calls can include calls with a long Interaction Time.
- Those reports also hold caller numbers, notes and recording links. The sync asks only for each call's day, agent, call ID and Interaction Time, and stores only counts per agent per day.
- Keep the State ANI column request as it is: the Short Duration Calls report shows that column, and GoodData drops calls with no value in a column, about 182 calls so far. Counting the same calls keeps the page matched to the report. Removing the column from the saved report brings those calls back automatically on the next run.
- Saving either report changes its version and rebuilds the history from 2026-01-01. Otherwise each run re-reads the last 7 days plus today.
- A failed or empty read keeps the earlier counts and is recorded in `lead_data_sync`.
- The very first load runs when someone opens the page, at any hour, so the page isn't blank until the next 9 AM run. The cron never reads outside its hours.
- Agent names use the same matching as Standard vs. Preferred. Training and second logins stay separate from agents. Calls with no agent (`N/A`) count toward the totals and the No agent tile, and are not ranked.

## PolicyTek

Not connected. The reports this app reads from PolicyTek (Agent Report and Source Performance) hold leads, quoted, submitted, premium and spend, with no call disconnects, so the tab says it isn't connected rather than showing zeros. Connecting it needs the PolicyTek report that holds these numbers.
