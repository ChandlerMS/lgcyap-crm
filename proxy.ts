import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_HOSTS = new Set(['lgcyap.com', 'www.lgcyap.com']);
const WEBSITE_ORIGIN = 'https://lgcyap.vercel.app';
const CRM_ORIGIN = 'https://crm.lgcyap.com';

// The public domains currently share a Vercel project with CRM. Dispatch by exact host,
// without changing CRM's OAuth origin, callback URLs, secrets, or session configuration.
export function proxy(request: NextRequest) {
  if (!PUBLIC_HOSTS.has(request.nextUrl.hostname.toLowerCase())) return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (/^\/(?:sign-in|sign-out|admin|queue-access|leaderboard-access)(?:\/|$)/.test(path) || /^\/api\/auth(?:\/|$)/.test(path)) {
    return NextResponse.redirect(new URL(`${path}${request.nextUrl.search}`, CRM_ORIGIN), 307);
  }
  const destination = new URL(WEBSITE_ORIGIN);
  destination.pathname = path;
  destination.search = request.nextUrl.search;
  const headers = new Headers(request.headers);
  // Domain-wide Queue/Leaderboard sessions must never reach the public website.
  headers.delete('cookie');
  headers.delete('authorization');
  headers.delete('proxy-authorization');
  return NextResponse.rewrite(destination, { request: { headers } });
}
