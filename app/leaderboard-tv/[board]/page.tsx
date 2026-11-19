import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAppUser } from '../../app-auth';
import LeaderboardTv from '../leaderboard-tv';
import { TV_BOARD_PAGES, tvBoardLabel, tvSearch } from '../tv-model.mjs';

export const dynamic = 'force-dynamic';

type Params = Promise<{ board: string }>;
const boardFor = (page: string) => Object.hasOwn(TV_BOARD_PAGES, page) ? TV_BOARD_PAGES[page as keyof typeof TV_BOARD_PAGES] : null;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const board = boardFor((await params).board);
  return { title: board ? `${tvBoardLabel(board)} · Leaderboard · Legacy Agency Partners` : 'Leaderboard · Legacy Agency Partners' };
}

// leaderboard.lgcyap.com/standard and /shopper: one board per screen, no rotation between boards.
export default async function LeaderboardBoardPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = (await params).board;
  const board = boardFor(page);
  if (!board) notFound();
  const search = tvSearch(await searchParams);
  await requireAppUser(`/leaderboard-tv/${page}${search ? `?${search}` : ''}`);
  return <LeaderboardTv search={search} board={board} />;
}
