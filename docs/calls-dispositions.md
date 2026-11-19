# Calls dispositions

Calls has four saved routes: `#calls/shopper`, `#calls/shopper-dispositions`, `#calls/standard` and `#calls/standard-dispositions`.

Shopper Dispositions opens PolicyTek `/leads` using the existing Shopper iframe dimensions. Standard vs Preferred Dispositions reads the owner's uploaded Call History All Time workbook. The snapshot contains 80,000 rows, May 19–November 18, 2026, with the exported `Final IN (Yes)` filter. It is not an automatic RingCX feed and does not assert that the export covers dates outside those rows.

All 15 exported columns remain available. Filters include inclusive dates, Agent, State, Disposition, Call Result, searches within each text column, a global search, and minimum/maximum seconds for all five durations. Filtering precedes pagination and summary counts. CSV exports include every matching row and neutralize spreadsheet formula prefixes. Recording and summary links only open HTTPS URLs.

The repository is public. `server-data/svp-dispositions.enc` is AES-256-GCM authenticated ciphertext containing compressed private data. Its 32-byte base64 key is the sensitive production environment variable `SVP_DISPOSITIONS_KEY`. Neither the workbook, plaintext JSON nor key may be committed or put under public/. Preview builds do not receive the production key. `/api/svp-dispositions` checks the existing CRM user, editor authorization and same-origin request before opening the file. Responses are private/no-store. Only paginated rows leave the server except for an explicitly requested streamed CSV export.

To replace a snapshot, put a newly generated key file and intermediate JSON under ignored `work/`, run `python scripts/prepare-svp-dispositions.py <workbook.xlsx> work/svp-calls.json`, then `node scripts/seal-svp-dispositions.mjs work/svp-calls.json work/svp-dispositions.key`. The parser expands only explicit merged ranges and rejects unexpected columns or malformed dates. Configure the matching key in production before deploying through main. Keep a recovery copy of the key in approved secret storage; sensitive Vercel keys cannot be read back. Never log private rows or key values.

Verification: 684 Node tests and two Python merge-expansion tests pass, along with TypeScript, the production build, focused ESLint and encrypted-asset function tracing. Independent code review found no actionable issues. Repository-wide ESLint still reports five existing errors in recruit-path-page.tsx, workspace-search.tsx and workspace-titlebar.tsx, plus one existing unused-import warning in event-attendance.test.mjs.
