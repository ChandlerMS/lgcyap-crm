import { getAppUser, requireAppUser } from '../app-auth';
import RingCentralPanel from '../ringcentral-panel';
import { RecruitEmailProvider } from '../recruit-email';
import type { AttendanceSelection } from './attendance-count';
import EventAttendanceBoard from './event-attendance-board';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Event Attendance | Legacy Agency Partners' };
export default async function EventAttendancePage({ searchParams }: { searchParams: Promise<{ embedded?: string; kind?: string; day?: string }> }) {
  const query = await searchParams;
  const selection: AttendanceSelection | undefined = (query.kind === 'sign-ins' || query.kind === 'applications') && /^\d{4}-\d{2}-\d{2}$/.test(query.day || '') ? { kind: query.kind, day: query.day! } : undefined;
  if (query.embedded === '1') {
    let user;
    try { user = await getAppUser(); } catch { /* Offer top-level login inside the frame. */ }
    if (!user) return <div className="queue-page"><h1>Event Attendance</h1><p>Sign in again to view hiring event attendance.</p><a className="btn btn-primary" href="/sign-in?return_to=%2F%23event-attendance" target="_top">Sign in</a></div>;
  } else await requireAppUser(selection ? `/event-attendance?kind=${selection.kind}&day=${selection.day}` : '/event-attendance');
  // Emails in its lists open New Email with the offer templates, as on the dashboard.
  return <RecruitEmailProvider recruits={[]} disabled={false}><RingCentralPanel clientId={process.env.RINGCENTRAL_CLIENT_ID ?? ""} isDemo={false}><EventAttendanceBoard selection={selection} /></RingCentralPanel></RecruitEmailProvider>;
}
