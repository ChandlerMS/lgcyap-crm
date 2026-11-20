"use client";
import type { ReactNode } from "react";
import RecruitCommunications from "./recruit-communications";
import RecruitQuickActions from "./recruit-quick-actions";
import { followUpRecruits } from "./recruit-follow-up.mjs";
import type { PipelineRecruit } from "./recruit-pipeline";
import SummaryChips, { type SummaryChip } from "./summary-chips";

type Row = PipelineRecruit & { daysWaiting: number; neverContacted: boolean; followUpSince?: number };
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const dateText = (value?: number | string | null) => { const time = typeof value === "number" ? value : Date.parse(value ?? ""); return Number.isFinite(time) ? DATE.format(time) : "Not recorded"; };

// Follow Up on the dashboard: longest-waiting names first, each chip opening that recruit. lead is the gold Add Follow-Up
// plus. Its hover list shows every waiting recruit with their stage, office, contact details and recruiter, plus Call,
// Text and Email, and (for accounts that can save to HubSpot) Note, Task, Follow-Up and Meeting.
export default function RecruitFollowUpChips({ records, now, partial, lead, previewActions, canAddActivity = false }: { records: readonly PipelineRecruit[]; now: number; partial?: boolean; lead?: ReactNode; previewActions?: ReactNode; canAddActivity?: boolean }) {
  const chips: SummaryChip[] = (followUpRecruits(records, now) as Row[]).map(row => {
    const name = row.name || [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unnamed recruit";
    return {
      id: row.id, href: `#recruit/${encodeURIComponent(row.id)}`, name,
      badge: `${row.daysWaiting}d`, detail: `${row.daysWaiting} days waiting`,
      previewDetail: `${row.daysWaiting} days ${row.neverContacted ? "since added, never contacted" : "since last contact"}${row.stage ? ` · ${row.stage}` : ""}`,
      facts: [
        ["Waiting", `${row.daysWaiting} days${row.neverContacted ? ", never contacted" : ""}`],
        [row.neverContacted ? "Added" : "Last contacted", dateText(row.neverContacted ? row.createdAt : row.lastContactedAt)],
        ["Stage", row.stage || "Not recorded"], ["Office", row.office || "Not recorded"],
        ["Phone", row.phone || "Not recorded"], ["Email", row.email || "Not recorded"],
        ...(row.recruiter ? [["Recruiter", row.recruiter] as const] : []),
      ],
      actions: <div className="recruit-row-tools"><RecruitCommunications recruitName={name} recruitId={row.id} phone={row.phone} hubspotUrl={row.hubspotUrl ?? ""} isDemo={row.isDemo} />{canAddActivity && !row.isDemo && <RecruitQuickActions recruitId={row.id} recruitName={name} />}</div>,
    };
  });
  return <SummaryChips id="follow-up-chips-title" title="Follow up" href="#follow-up" lead={lead} previewActions={previewActions} count={`${chips.length}${partial ? "+" : ""}`} note="15+ days without contact" chips={chips}
    empty="No one is waiting more than 15 days." more={{ label: "waiting" }} />;
}
