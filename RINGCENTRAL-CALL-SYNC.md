# RingCentral call history

## Integration contract

RingCentral's native **Activity Sync** is the sole call writer. The embedded
RingEX phone does not create a second HubSpot call. This prevents duplicate
engagements and competing updates to call notes or recording metadata.

The existing authenticated `POST /api/recruits/:id/activity` is read-only. It
verifies the recruiting pipeline, then reads the ticket's activity and its
single verified contact's activity. Multiple contact links are explicitly
withheld rather than guessed. Association pages remain resumable at 50 items.
The browser merges duplicate activity IDs across the two sources.

Calls include duration, direction, status, native source, call notes, and a
summary (`hs_call_summary`, then `hs_ai_summary`, then `hs_ai_summary_short`).
Recording presence uses `hs_call_recording_url` or `recording_url`; transcript
presence requires `hs_call_has_transcript`. Notes or summaries never become a
fabricated transcript. Media opens the official HubSpot call-review page under
the employee's existing permissions. Provider recording URLs and credentials
are never returned to the browser. Inline audio/transcript text is not offered.

History checks every minute while visible, with no overlapping reads. Loading
additional pages pauses automatic refresh so it cannot discard the user's
position. Manual refresh returns to the initial pages. Failed refreshes preserve
already displayed records and show the error; the last-checked timestamp only
advances after both sources succeed. These are loaded-page results, not an
assertion that all calls or media have been synchronized.

## Texting pause

Text buttons remain disabled. The bridge rejects text commands and the panel
rejects text intents. `disableReadText=1` also removes the embedded SMS feature.
No registration, messaging grant, or outbound-message operation is performed.

## Live verification, November 2, 2026

- Portal 50894788: native Activity Sync is on for everyone/all call types.
- Existing unknown-number and multiple-match policies were inspected, unchanged.
- The three authorized October 30 test calls exist as native `RingEX by
  RingCentral` engagements, with their expected users and durations. No duplicate
  writer was added. They contain no recordings or transcripts.
- RingCentral automatic recording was off; on-demand recording was on. Any
  future automatic recording requires a separately approved user scope.
- The inspected recruit profile successfully reads both ticket and linked-contact
  history using the deployed app's existing HubSpot credentials.
- Transcription entitlement and a recorded-call-to-transcript round trip still
  require provider verification. A working call log does not prove either.

## Provider references

- [Native HubSpot logging and recording behavior](https://ringcentral.github.io/ringcentral-integration-docs/hubspot/questions/)
- [Embedded-phone SMS disable option](https://ringcentral.github.io/ringcentral-embeddable/docs/config/)
- [HubSpot third-party transcript API](https://developers.hubspot.com/docs/api-reference/latest/crm/extensions/calling-extensions/third-party-transcripts)

The transcript API requires a transcript ID and appropriate OAuth grants. This
application does not assume that a call ID is a transcript ID or scrape private
HubSpot endpoints to obtain transcript text.
