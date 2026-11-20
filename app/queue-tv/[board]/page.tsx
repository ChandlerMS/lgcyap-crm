import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAppUser } from '../../app-auth';
import UnifiedQueue from '../../queue/unified-queue';
import { QUEUE_TV_BOARDS } from '../../queue/tv-model.mjs';

export const dynamic = 'force-dynamic';
type Params = Promise<{ board: string }>;
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const board = (await params).board;
  return { title: Object.hasOwn(QUEUE_TV_BOARDS, board) ? `${QUEUE_TV_BOARDS[board as keyof typeof QUEUE_TV_BOARDS]} Queue TV · Legacy` : 'Queue TV · Legacy' };
}
export default async function QueueTvPage({ params }: { params: Params }) {
  const board = (await params).board;
  if (board !== 'shopper' && board !== 'standard') notFound();
  await requireAppUser(`/queue-tv/${board}`);
  return <UnifiedQueue initialView={board} tv />;
}
