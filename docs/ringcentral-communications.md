# RingCentral communications

The authenticated CRM embeds RingCentral Embeddable 3.0.0, using the private Legacy CRM Communications app and individual RingCentral sign-in (OAuth authorization code + PKCE). `RINGCENTRAL_CLIENT_ID` is a public identifier set in Vercel production. No client secret, JWT, or shared administrator token is used.

Call and Text buttons select the recruit and open the panel. The employee signs in, then explicitly chooses Prepare call or Open text conversation. Calls always use `toCall: false`; texts only open a conversation. The employee presses Dial or Send in RingCentral. Demo contacts cannot use either action. Unformatted 10-digit numbers assume US +1; international numbers require a country prefix.

One iframe persists across hash navigation and minimization. Only the exact official origin and the specific iframe window can update status. No call/message event is accepted as evidence for a HubSpot write. The app does not read RingCentral credentials or record message payloads. Browser microphone permission is requested by the provider when needed.

Approved app scopes: Call Control, SMS, VoIP Calling, WebSocket Subscriptions, Read Accounts, Read Contacts, Read Presence, Read Messages, Read Call Log, Read Call Recording. This is RingEX calling; it does not change RingCX campaigns, routing, or agent availability. Employee entitlement and SMS sender eligibility remain provider-enforced.

## Current limitations

- Embedding the phone does not automatically establish HubSpot call/SMS logging. This UI labels that limitation; existing HubSpot activity history is separate.
- Recruit history reads HubSpot notes, calls, tasks, meetings, and permitted email history. Recordings/transcript indicators link to authenticated HubSpot records. No RingCentral media or transcripts are copied server-side.
- Transcripts require provider availability and suitable access. Call summaries are not labeled as transcripts.
- No calls or texts are sent during verification.

## Official contracts

- https://ringcentral.github.io/ringcentral-embeddable/docs/app-registration/
- https://ringcentral.github.io/ringcentral-embeddable/docs/config/
- https://ringcentral.github.io/ringcentral-embeddable/docs/integration/api/
- https://ringcentral.github.io/ringcentral-embeddable/docs/integration/events/
