import Link from "next/link";
import { requireAppUser } from '../app-auth';
import { adminAllowed } from '@/lib/admin-policy.mjs';
import AdminDashboard from './admin-dashboard';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin | Legacy Agency Partners' };
export default async function AdminPage() {
  const user = await requireAppUser('/admin');
  if (!adminAllowed(user)) return <main className="queue-page"><h1>Access denied</h1><p>Only Chandler and Sarah can manage access.</p><Link href="/">Return to CRM</Link></main>;
  return <AdminDashboard />;
}
