# Private HubSpot incoming Email

Request: connect the Email page and dashboard Email section to received HubSpot email for chandler@lgcyap.com. The user explicitly selected **Only Chandler** for visibility.

Current evidence: HubSpot portal 50894788 belongs to Chandler. Channel metadata returned email addresses for Inbox, Help Desk and HubSpot Sales, but no Chandler mailbox. RecruitEmailPanel currently lists recruit recipients, not received emails.

Implement one owner-only received-mail source backed by HubSpot Conversations. Discover channel accounts by verified deliveryIdentifier email, never a guessed ID or display name. Read active and archived threads/messages with existing signed resumable pagination. Both full Email page and dashboard section use this source, automatically refreshing while visible. Keep recruit compose/recipient functionality. A missing/unauthorized Chandler channel must show connection-needed rather than another inbox or a misleading empty mailbox.

Preserve privacy across the generic Inbox, search, previews and reply endpoints: use a request-local transport guard that removes Chandler's channel/inbox threads from other users and denies direct message/reply requests before reading message bodies. Do not rely on hiding a UI section or HubSpot portal-wide API token to enforce employee access.

HubSpot-side setup is a dedicated inbox restricted to Chandler, with chandler@lgcyap.com authorized as its email channel. HubSpot's team-email connection receives future incoming emails; it does not import messages received before connection. HubSpot does not permit an address simultaneously as personal and team email. Do not disconnect an existing personal connection or alter sharing automatically. Those provider settings/Google authorization require owner interaction.

Approaches considered: CRM logged email objects cannot supply every incoming message. Direct Gmail would provide mailbox history but would change the requested HubSpot source. Use the dedicated HubSpot email channel for this request and state its actual connection status and historical limitation clearly.

Sources: https://knowledge.hubspot.com/inbox/connect-channels-to-the-conversations-inbox and https://knowledge.hubspot.com/connected-email/connect-your-inbox-to-hubspot
