import type { Db } from './db';

// Settings, from Vercel's Environment Variables (or .env.local when running locally). The defaults are Legacy's own
// setup, so only the secrets have to be set.
declare global {
  interface Env {
    DB: Db;
    OWNER_EMAILS: string;
    MAIL_FROM: string;
    MAIL_FROM_NAME: string;
    TEAM_CALENDARS: string;
    INDEED_INBOX: string;
    DEV_LOGIN_CODES: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GOOGLE_TEAM_REFRESH_TOKEN: string;
    GOOGLE_INBOX_REFRESH_TOKEN: string;
    CRON_SECRET: string;
  }
}

// Work that may finish after the response is sent (Vercel's waitUntil).
export interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

export function envFrom(v: Record<string, string | undefined>, DB: Db): Env {
  return {
    DB,
    OWNER_EMAILS: v.OWNER_EMAILS || '',
    MAIL_FROM: v.MAIL_FROM || 'carlos@lgcyap.com',
    MAIL_FROM_NAME: v.MAIL_FROM_NAME || 'Legacy Agency Partners',
    TEAM_CALENDARS: v.TEAM_CALENDARS || 'carlos@lgcyap.com,ed@lgcyap.com',
    INDEED_INBOX: v.INDEED_INBOX || 'recruitinglegacyam@gmail.com',
    // Printing sign-in codes to the log is for local development only, never on a Vercel deployment.
    DEV_LOGIN_CODES: v.VERCEL ? '0' : v.DEV_LOGIN_CODES || '0',
    GOOGLE_CLIENT_ID: v.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: v.GOOGLE_CLIENT_SECRET || '',
    GOOGLE_TEAM_REFRESH_TOKEN: v.GOOGLE_TEAM_REFRESH_TOKEN || '',
    GOOGLE_INBOX_REFRESH_TOKEN: v.GOOGLE_INBOX_REFRESH_TOKEN || '',
    CRON_SECRET: v.CRON_SECRET || '',
  };
}
