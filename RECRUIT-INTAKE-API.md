# Combined recruit intake

`POST /api/recruit-intake` handles one reviewed row. The browser submits up to
500 rows sequentially, preserving each row's request ID and outcome. It never
uploads the spreadsheet file to this endpoint.

```json
{"requestId":"UUID","firstName":"Preview","lastName":"Only","phone":"+12025550146","email":"preview@example.invalid","recruitingPath":"genpop"}
```

Only these keys are accepted; JSON is bounded to 4,096 bytes. First/last names
are trimmed/NFC-normalized, control-free and up to 100 Unicode characters each,
with combined length bounded for the existing Ticket subject. Phone uses the
existing US/international canonicalization. Email is optional/blank or a validated
lowercase address up to 254 characters. `recruitingPath` is required on every row:
exactly `genpop` or `mass_recruiting`, without a default. CSV/XLSX accepts Path or
Recruiting Path headers; absent choices remain in the preview for manual selection.
The server validates every row independently
of the file preview. No license status, Contact lifecycle, owner, marketing
subscription or unrelated field is invented.

Access requires the current verified Google session and exact approved/editor
email policy, same origin, genuine Vercel Production, existing write flag, new
`RECRUITING_INTAKE_ENABLED=true`, PostgreSQL ledger, HMAC key and actual server
credential for portal `50894788`, app `59264745`, with Contacts and Tickets read/write.
The unlabeled native Ticket-to-Contact association type is read from HubSpot.
The old contact-only flag remains false; Preview and the backup remain read-only.

The server searches normalized phone/mobilephone and supplied email. Reuse
requires one Contact with matching names and phone; supplied email must match.
Multiple/conflicting matches or incomplete identity/search responses stop before
creation. Existing properties are never overwritten. Existing associated tickets
in the Recruiting pipeline return `already_exists` without resetting their stage
or changing/classifying their stored path.
Search matching is bounded/best effort and is not a global uniqueness guarantee
against other integrations or HubSpot indexing delay.

A new Contact is confirmed by GET, checkpointed, and used in a Ticket create with
the native association. The Ticket is created with `hs_pipeline=924992938`,
`hs_pipeline_stage=1473318768` (Hiring Event) for Referrals, or `1473318769`
(Application) for Recruiters, plus `recruiting_path`, `recruit_name` and
`subject`. It does not invent a licensing branch. Its path, entry stage, properties
and Contact association are confirmed by GET before reporting success.

Success is HTTP 201 (`created`) or 200 (`already_exists`/replayed), with request ID
and fixed-portal Contact/Ticket ID links. Errors contain safe codes/messages and
known receipt IDs only; they do not echo submitted field values.

| Outcome | Behavior |
| --- | --- |
| Confirmed pair | Store metadata/IDs; repeat requests do not repeat creates. |
| Identity conflict | Review in HubSpot; no overwrite or automatic association. |
| Contact confirmed, Ticket definitely not created | Preserve Contact; `canResume=true` permits a deliberate same-user, same-UUID, unchanged-payload resume. |
| Possible Contact/Ticket creation or failed confirmation/checkpoint | Retain identity claims and mark uncertain; no automatic retry or new-UUID bypass. |
| Definite pre-create failure | No confirmed new pair; fix/review the row before a new deliberate request. |
| Pre-path request claim | `INTAKE_RECONCILIATION_REQUIRED` (409), no provider calls or automatic resume/classification; review the original records first. |

The database stores purpose-separated keyed phone/email/payload hashes, request
UUID/user ID, state, timestamps and CRM IDs. Separate partial unique indexes
arbitrate both identities atomically across users/functions. No submitted names,
phones or emails are stored there. Expired pending work becomes uncertain rather
than releasing a possible create. A key fingerprint fails closed after an
unexpected secret rotation. No rollback deletes a Contact after partial setup.
Payload hashes use version 2 and bind the selected path. Phone/email identity
hashes and the singleton key fingerprint retain their version-1 domains; changing
the payload contract does not release duplicate claims. A reused UUID with a
different path is rejected.

The local form retains receipts until cleared; clearing them never releases
server identity claims. Unconfirmed results require HubSpot reconciliation.
Existing HubSpot workflows may run on record creation.

Migration `0003_recruit_intake.sql` is additive. The rollout can invoke
`node scripts/migrate-intake.mjs --apply` only inside Vercel Production; it uses
the existing server connection, a transaction and catalog verification, logging
schema metadata only. Restore the normal project build command after the one-off
migration build. Provider creates are covered by synthetic/mocked tests; no real
test Contact/Ticket should be created without a user-chosen test record workflow.
