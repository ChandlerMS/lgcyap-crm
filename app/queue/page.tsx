import type { Metadata } from "next";
import { getAppUser, requireAppUser } from "../app-auth";
import QueueBoard from "./queue-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shopper · Legacy" };

export default async function Queue({ searchParams }: { searchParams: Promise<{ embedded?: string }> }) {
  const embedded = (await searchParams).embedded === "1";
  if (embedded) {
    let user;
    try { user = await getAppUser(); } catch { /* Show a usable sign-in action inside the frame. */ }
    if (!user) return <div className="queue-page"><h1>Shopper</h1><p>Your session is unavailable. Sign in again to open the queue.</p><a className="btn btn-primary" href="/sign-in?return_to=%2F%23queue" target="_top">Sign in</a></div>;
  } else await requireAppUser("/queue");
  return <QueueBoard embedded={embedded} />;
}
