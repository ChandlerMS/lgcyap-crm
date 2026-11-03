import type { Metadata } from "next";
import { requireAppUser } from "../app-auth";
import QueueBoard from "./queue-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Queue · Legacy" };

export default async function Queue() {
  await requireAppUser("/queue");
  return <QueueBoard />;
}
