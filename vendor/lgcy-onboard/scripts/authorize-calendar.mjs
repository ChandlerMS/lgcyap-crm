// The team approval: signed in as MAIL_FROM (carlos@lgcyap.com), it sends LGCY Onboard's emails and reads/writes the
// TEAM_CALENDARS. Other team calendars (ed@lgcyap.com) must be shared with that account with "Make changes to events".
//   npm run google:team               -> .env.local
//   npm run google:team -- --put      -> Vercel environment variable
import { approve } from './google-approval.mjs';

await approve({
  secret: 'GOOGLE_TEAM_REFRESH_TOKEN',
  account: 'carlos@lgcyap.com',
  what: 'sending email and the team Google Calendars',
  scopes: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar.events'],
});
