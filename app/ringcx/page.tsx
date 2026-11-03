import { requireAppUser } from '../app-auth';
import RingCxDashboard from './ringcx-dashboard';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'RingCX | Legacy Agency Partners' };
export default async function RingCxPage() {
  await requireAppUser('/ringcx');
  return <RingCxDashboard />;
}
