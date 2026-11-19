# Automatic recruiting follow-ups

Production runs `/api/cron/no-contact-tasks` each minute with the existing cron bearer secret. A persisted cursor scans the recruiting pipeline in bounded batches, across every stage, including outcome stages. Backlogs can require multiple runs.

A recruit becomes overdue strictly more than 15 days after the latest ticket or linked-contact contact timestamp. Creation time is the fallback when contact has never been recorded. Unavailable or ambiguous linked-contact data is skipped rather than treated as inactivity.

The job creates a high-priority, unassigned HubSpot task in the existing **Follow up** queue, associated with the recruit and linked contact. Durable claims prevent duplicates for the same inactivity period. New contact completes only this automation's old tasks. A later 15-day gap can produce another task. Definitive rejected writes retry after backoff; ambiguous writes are reconciled by a unique body marker and never blindly repeated.

CRM Tasks lists include these shared tasks for all authorized CRM viewers, alongside each viewer's own tasks, and refresh each minute. This includes authorized users with Service Hub seats. Sharing does not grant CRM login access or change HubSpot seats, roles, or native queue permissions. Native HubSpot visibility remains governed by the account's existing task and queue permissions; seat assignment alone does not grant those permissions.

`RECRUITING_NO_CONTACT_TASKS_ENABLED=false` disables the job. Existing production and recruiting-write gates also apply. The route reports only aggregate processed/created/attention counts in logs; attention indicates records requiring a later retry or reconciliation. The task ledger and scan cursor are initialized using bundled SQL.
