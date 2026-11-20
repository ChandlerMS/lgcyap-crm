# Chandler-only received email

The Email page, dashboard Email section and Email hover preview now include the same received-mail view from HubSpot. Recruit recipients and compose actions remain available. Only chandler@lgcyap.com can call the private Email API; other users never receive its mailbox contents. The view checks for new mail every minute while visible and retains loaded mail and older pagination progress during failed or incomplete background reads.

## Required owner setup — not yet activated

The inspected HubSpot account (50894788) has support email channels, but **no channel for chandler@lgcyap.com**. The app cannot receive Chandler's entire mailbox from those support channels.

1. In HubSpot, create a **dedicated Conversations Inbox**, restrict its access to Chandler, and ensure automatic ticket creation/copying is disabled. Do not use Help Desk: its incoming emails create tickets visible through other CRM features.
2. Connect chandler@lgcyap.com as that inbox's Google email channel and complete Google consent. Do not disconnect an existing personal email connection without checking its effect on the owner's HubSpot workflows. HubSpot does not allow the same address simultaneously as personal and team email.
3. After verifying the private inbox permissions and absence of automatic ticket copies, set the server-only production `HUBSPOT_CHANDLER_INBOX_ID` to its exact numeric inbox ID and redeploy through main. Runtime verifies that the matching authorized email account belongs to this pinned inbox and its type is INBOX, not HELP_DESK. A bare matching address is not enough to mark the private feed operational.

HubSpot begins receiving new messages after channel connection. It does not import emails received before that connection; a Gmail-history import would be separate work. Spam/provider filtering can also affect what HubSpot receives. No mailbox connection or sharing setting was changed by the code deployment.

## Privacy enforcement

Generic Inbox, Inbox previews, workspace search and reply routes use a request-local transport guard. It removes Chandler's channel/inbox threads for other users and checks active or archived thread metadata before reading or replying to messages by ID. Unknown thread/email identities fail closed. Public comments and status events are preserved in verified public threads, while mixed private email messages are excluded. Archived/disconnected channel accounts remain part of the policy.

Recruit activity also filters copies logged as CRM email engagements: Chandler's received addresses and unverified recipients are not returned to other users. Other explicitly addressed recruiting correspondence and non-email activity remain shared as before. The server does not return raw email headers to the browser.

Received-mail pagination uses the documented HubSpot v3 ID order and a single inbox ID, with separate active/archived phases and signed, owner/mailbox-bound continuations. It identifies received threads by their incoming-message timestamp and previews incoming email rather than later comments or outbound replies. Reads do not send messages or mark them as read.

Official provider references:
- https://knowledge.hubspot.com/inbox/connect-channels-to-the-conversations-inbox
- https://knowledge.hubspot.com/connected-email/connect-your-inbox-to-hubspot
- https://developers.hubspot.com/docs/api-reference/conversations-conversations-v3/guide

## Email layout and connection checks

The dashboard Email section and standalone Email page separate Received email from Recruit recipients. One New Email action opens the existing HubSpot recipient/template handoff. Refresh checks the connection and refreshes received mail plus the recruit dataset. The Email summary links to the Email workspace and does not embed a second full mailbox inside a hover preview. Nested received-mail views hide redundant New message and collapse controls.

Owner-only `GET /api/email?connection=1` reports the authenticated web-app email, whether that exact email matches one active HubSpot owner/user, and a separately verified received-mail channel state. It verifies the production portal/private-app identity before reading metadata. Connected is reported only for one active authorized channel in the explicitly configured Conversations Inbox. Unknown provider access is reported as unavailable, not disconnected or successfully connected. This does not inspect or establish a HubSpot personal sending-mailbox connection. No mailbox contents are read by the connection check.
