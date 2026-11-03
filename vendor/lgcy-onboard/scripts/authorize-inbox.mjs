// The inbox approval: signed in as INDEED_INBOX (recruitinglegacyam@gmail.com), it lets LGCY Onboard read Indeed's
// notices. Read-only: nothing in that inbox is changed.
//   npm run google:inbox              -> .env.local
//   npm run google:inbox -- --put     -> Vercel environment variable
import { approve } from './google-approval.mjs';

await approve({
  secret: 'GOOGLE_INBOX_REFRESH_TOKEN',
  account: 'recruitinglegacyam@gmail.com',
  what: 'reading Indeed notices in the recruiting inbox',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
});
