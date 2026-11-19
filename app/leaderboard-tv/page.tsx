import type { Metadata } from 'next';
import { requireAppUser } from '../app-auth';
import LeaderboardTv from './leaderboard-tv';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leaderboard · Legacy Agency Partners' };

// leaderboard.lgcyap.com/ shows this page. Signing in goes through the CRM (see lib/leaderboard-host.mjs).
export default async function LeaderboardTvPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAppUser('/leaderboard-tv');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === 'string') params.set(key, value);
  return <LeaderboardTv search={params.toString()} />;
}
