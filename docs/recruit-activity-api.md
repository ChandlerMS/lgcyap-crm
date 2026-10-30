# Recruit activity read contract

`POST /api/recruits/{ticketId}/activity` requires the existing Google approved-user session and same-origin JSON request. No writes are performed.

Body: `{ "kind": "notes|calls|emails|tasks|meetings", "source": "ticket|contact", "after": null }`.

The server verifies membership in the configured Recruiting pipeline. Contact reads resolve the ticket's unique contact association server-side. Unlinked or ambiguous contacts produce an explanatory notice, never a name/phone match.

Response: `{ records, next, notice }`. Each request reads up to 50 associated IDs and batch-reads only those activities. Pass `next` as `after` to continue; null ends that source. Ticket and contact pages are independently resumable, and the client deduplicates by activity ID. Sorting applies to loaded records. Errors retain previously loaded rows and never claim complete history.

Records contain plain-text title/body/summary, timestamp, status, direction, HubSpot record link, and recording/transcript availability indicators. Provider recording URLs and credentials are never sent to the client. Recordings and transcripts currently open the authenticated HubSpot activity; inline RingCentral media/text requires its separate connection. Call notes and AI summaries are not transcripts. Demo records make no activity requests.

Sources: HubSpot CRM activity object and association APIs; verified portal properties `hs_call_body`, `hs_call_recording_url`, `recording_url`, `hs_call_has_transcript`, `hs_call_summary`.
