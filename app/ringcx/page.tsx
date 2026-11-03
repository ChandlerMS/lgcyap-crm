import { getAppUser, requireAppUser } from '../app-auth';
import RingCxDashboard from './ringcx-dashboard';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'RingCX | Legacy Agency Partners' };
export default async function RingCxPage({ searchParams }: { searchParams: Promise<{ embedded?: string }> }) {
  if ((await searchParams).embedded === '1') {
    let user;
    try { user = await getAppUser(); } catch { /* Offer top-level login inside the frame. */ }
    if (!user) return <div className="queue-page"><h1>RingCX</h1><p>Sign in again to view the live dashboard.</p><a className="btn btn-primary" href="/sign-in?return_to=%2F%23ringcx" target="_top">Sign in</a></div>;
  } else await requireAppUser('/ringcx');
  return <RingCxDashboard />;
}
