import type { Metadata } from 'next';
import { requireAppUser } from '../app-auth';
import LeaderboardTv from './leaderboard-tv';
import { tvSearch } from './tv-model.mjs';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leaderboard · Legacy Agency Partners' };

// leaderboard.lgcyap.com/ shows this page. Signing in goes through the CRM (see lib/leaderboard-host.mjs),
// and the display options in the link come back with the TV after sign-in.
export default async function LeaderboardTvPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = tvSearch(await searchParams);
  await requireAppUser(`/leaderboard-tv${search ? `?${search}` : ''}`);
  return <LeaderboardTv search={search} />;
}
