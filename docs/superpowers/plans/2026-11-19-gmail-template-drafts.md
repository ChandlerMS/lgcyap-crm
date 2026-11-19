# Implementation and API contract

1. OAuth/connection subsystem: db/gmail.mjs, migrations/0017_gmail_drafts.sql; lib/gmail-oauth.mjs + lib/gmail-connection.mjs; app/api/gmail/route.ts; dispatch Gmail callback before existing Sheets/export/sign-in callbacks. Add focused identity/PKCE/callback/encryption/authorization tests.
2. Composer backend: lib/gmail-compose.mjs and app/api/recruit-email/route.ts. Preserve verifiedRecipient/renderOffer/emailMime utilities. No send endpoint or HubSpot mail log.
3. Frontend: replace handoff in app/recruit-email.tsx, replace HubSpot connection panel in app/private-email-panel.tsx, update app/recruit-email-panel.tsx labels/links. Preserve summary chips, combobox, explicit New Email and established layout. Add compose interaction tests and update affected tests.
4. Privacy/docs, independent code review, relevant and full checks, production build; fetch current main, integrate and push through Git deployment. Verify production SHA and activation status without sending actual mail.

## Connection API contract

GET /api/gmail returns {available:boolean,email:string,connected:boolean,inboxUrl:string,draftsUrl:string,error?:string} to authenticated authorized employees. Status verifies own connection; never return credentials. POST same endpoint with {action:'connect'} returns {url} + state cookie, or {action:'disconnect'} removes this user's local Gmail grant. Same-origin production only for mutations. Callback returns /?gmail=connected|error#email and clears Gmail cookie.

lib/gmail-connection.mjs exports getGmailAccess({user,env,db,fetchImpl?}) -> {accessToken,email}, handleGmailConnection(request,{getUser,env?,getDb?}), handleGmailCallback(request,{getUser,env?,getDb?}). db/gmail.mjs exports getGmailDb(). lib/gmail-oauth.mjs exports GMAIL_STATE_PREFIX. Keep credentials bound to user.userId and user.email. Tables: gmail_connection(user_id PK,email,google_sub,refresh_token,scope,connected_at), gmail_draft_requests(user_id,request_id,payload_hash,status,draft_id,message_id,thread_id,created_at,updated_at; PK user_id+request_id). Draft status pending/created/uncertain/failed. No message bodies stored.

## Compose API contract

POST /api/recruit-email actions:
- status -> {sender,available,templates:[{id,name,route,subject,fields:[]}]} (separate Gmail status uses /api/gmail).
- prepare + recruitId -> {recipient:{name,email,firstName,route,...},templates:eligible metadata}
- preview + recruitId,templateId,subject,body,fields -> {recipient,subject,html,previewToken}
- draft + same input,previewToken,requestId -> {created:true,draftId,gmailUrl,draftsUrl,notice}; provider ambiguity -> {error:string,code:'DRAFT_UNCERTAIN',uncertain:true}. No send action.
Unknown fields rejected. Production editor access and same-origin JSON required. Refresh recipient/render content before draft to validate signed preview. Normal error response {error:string,code?:string,uncertain?:boolean}.

Front-end: open compose, choose recruit, select template, fill dates/optional note or custom message, Preview, then Create draft and open Gmail. Safely handle popup blocking with explicit Gmail link after creation. Do not auto-retry draft creation. Display Google draft permission includes sending, while the app only creates drafts and the user sends in Gmail.

## Implementation verification

Implemented the connection and draft flow, replaced the Email workspace's HubSpot mailbox panel with account-specific Gmail links, and retired the former `/api/email` endpoint. The separate HubSpot Inbox and its privacy guard remain in place. The runtime Gmail schema is inline SQL; the build verifies both Gmail tables are present in the deployed function bundle.

Independent review found no actionable issues. Local verification after integrating main through `00c90ee`: 861 tests passed, TypeScript and focused ESLint passed, and the production build (including auth/Gmail bundle checks) passed. Checks used synthetic data and mocked Google services; no real drafts or messages were created. The production Google OAuth client and offer template configuration already exist. Each employee still needs to select Connect Gmail and grant consent; Gmail API must be enabled in the client's Google Cloud project. Successful live consent and Gmail API access have not been verified from this workspace.
