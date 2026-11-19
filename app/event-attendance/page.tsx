import { getAppUser, requireAppUser } from '../app-auth';
import { RecruitEmailProvider } from '../recruit-email';
import EventAttendanceBoard from './event-attendance-board';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Event Attendance | Legacy Agency Partners' };
export default async function EventAttendancePage({ searchParams }: { searchParams: Promise<{ embedded?: string }> }) {
  if ((await searchParams).embedded === '1') {
    let user;
    try { user = await getAppUser(); } catch { /* Offer top-level login inside the frame. */ }
    if (!user) return <div className="queue-page"><h1>Event Attendance</h1><p>Sign in again to view hiring event attendance.</p><a className="btn btn-primary" href="/sign-in?return_to=%2F%23event-attendance" target="_top">Sign in</a></div>;
  } else await requireAppUser('/event-attendance');
  // Emails in its lists open New Email with the offer templates, as on the dashboard.
  return <RecruitEmailProvider recruits={[]} disabled={false}><EventAttendanceBoard /></RecruitEmailProvider>;
}
