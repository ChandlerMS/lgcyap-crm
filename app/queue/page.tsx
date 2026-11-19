import type { Metadata } from "next";
import { getAppUser, requireAppUser } from "../app-auth";
import QueueBoard from "./queue-board";
import RingCxDashboard from "../ringcx/ringcx-dashboard";
import UnifiedQueue from "./unified-queue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Queue · Legacy Agency Partners" };

// Saved ?source= links retain individual queues; the CRM iframe and Queue site show both together.
const SOURCES = { shopper: { label: "Shopper", hash: "queue" }, svp: { label: "Standard vs Preferred", hash: "ringcx" } } as const;

export default async function Queue({ searchParams }: { searchParams: Promise<{ embedded?: string; source?: string }> }) {
  const params = await searchParams;
  const embedded = params.embedded === "1";
  const source = params.source === "shopper" || params.source === "svp" ? params.source : null;
  if (embedded) {
    let user;
    try { user = await getAppUser(); } catch { /* Show a usable sign-in action inside the frame. */ }
    if (!user) return <div className="queue-page"><h1>{source ? SOURCES[source].label : "Queue"}</h1><p>Your session is unavailable. Sign in again to open the queue.</p><a className="btn btn-primary" href={`/sign-in?return_to=%2F%23${source ? SOURCES[source].hash : "queue"}`} target="_top">Sign in</a></div>;
  } else await requireAppUser("/queue");
  if (source === "shopper") return <QueueBoard embedded={embedded} />;
  if (source === "svp") return <RingCxDashboard />;
  return <UnifiedQueue embedded={embedded} />;
}
