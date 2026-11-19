"use client";
import type { ReactNode } from "react";
import { followUpRecruits } from "./recruit-follow-up.mjs";
import type { PipelineRecruit } from "./recruit-pipeline";
import SummaryChips, { type SummaryChip } from "./summary-chips";

type Row = PipelineRecruit & { daysWaiting: number; neverContacted: boolean };
// Follow Up on the Recruits page: longest-waiting names first, each chip opening that recruit. lead is the gold Add Follow-Up plus.
export default function RecruitFollowUpChips({ records, now, partial, lead, previewActions }: { records: readonly PipelineRecruit[]; now: number; partial?: boolean; lead?: ReactNode; previewActions?: ReactNode }) {
  const chips: SummaryChip[] = (followUpRecruits(records, now) as Row[]).map(row => ({
    id: row.id, href: `#recruit/${encodeURIComponent(row.id)}`,
    name: row.name || [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unnamed recruit",
    badge: `${row.daysWaiting}d`, detail: `${row.daysWaiting} days waiting`,
    previewDetail: `${row.daysWaiting} days ${row.neverContacted ? "since added, never contacted" : "since last contact"}${row.stage ? ` · ${row.stage}` : ""}`,
  }));
  return <SummaryChips id="follow-up-chips-title" title="Follow up" href="#follow-up" lead={lead} previewActions={previewActions} count={`${chips.length}${partial ? "+" : ""}`} note="15+ days without contact" chips={chips}
    empty="No one is waiting more than 15 days." more={{ label: "waiting" }} />;
}
