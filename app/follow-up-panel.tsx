"use client";
import { useState } from "react";
import PanelPager from "./panel-pager";
import { pageWindow } from "./panel-pager.mjs";
import RecruitCommunications from "./recruit-communications";
import RecruitQuickActions, { type ActivityRecruit } from "./recruit-quick-actions";
import { SectionToggle } from "./dashboard-section";
import { followUpRecruits } from "./recruit-follow-up.mjs";
import type { PipelineRecruit } from "./recruit-pipeline";

type Row = PipelineRecruit & { neverContacted: boolean; followUpSince: number; daysWaiting: number };
const PAGE = 5;
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const nameOf = (row: PipelineRecruit) => row.name || [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unnamed recruit";

// Follow up on the dashboard: recruits with no contact for 15+ days, longest waiting first, five to a page. Each row
// shows the recruit and how long they have waited, and opens its details while the pointer is over it.
// canAddActivity adds Add Follow-Up (choosing from recruits) and each row's own note, task and follow-up buttons.
export default function FollowUpPanel({ records, now, partial, canAddActivity = false, recruits = [] }: { records: readonly PipelineRecruit[]; now: number; partial?: boolean; canAddActivity?: boolean; recruits?: readonly ActivityRecruit[] }) {
  const [page, setPage] = useState(1);
  const rows = followUpRecruits(records, now) as Row[];
  const view = pageWindow(rows.length, page, PAGE);
  return <section className="today-panel follow-up-panel" aria-labelledby="today-follow-up-title">
    <div className="follow-up-heading"><h2 id="today-follow-up-title"><a className="panel-title-link" href="#follow-up">Follow up</a> <span>{rows.length}{partial ? "+" : ""}</span></h2>
      <div className="panel-heading-actions">{canAddActivity && <RecruitQuickActions kinds={["follow-up"]} recruits={recruits} trigger="button" />}<SectionToggle /></div></div>
    <p className="helper">No contact for more than 15 days, longest waiting first. Point at a row for details.</p>
    {!rows.length ? <p className="helper">No one is waiting more than 15 days.</p> : <>
      <div className="table-wrap"><table className="data-table hover-rows"><thead><tr><th scope="col">Recruit</th><th scope="col">Waiting</th></tr></thead>
        {rows.slice(view.start, view.end).map(row => {
          const name = nameOf(row);
          return <tbody key={row.id} className="hover-row">
            <tr><td><a className="text-link" href={`#recruit/${encodeURIComponent(row.id)}`}>{name}</a></td><td><strong className="follow-up-days">{row.daysWaiting} days</strong></td></tr>
            <tr className="hover-row-details"><td colSpan={2}><div className="hover-row-reveal"><div>
              <dl className="hover-row-facts">
                <div><dt>Stage</dt><dd>{row.stage || "Not recorded"}</dd></div>
                <div><dt>Office</dt><dd>{row.office || "Not recorded"}</dd></div>
                <div><dt>{row.neverContacted ? "Added" : "Last contacted"}</dt><dd>{DATE.format(row.followUpSince)}{row.neverContacted ? ", never contacted" : ""}</dd></div>
                {row.recruiter && <div><dt>Recruiter</dt><dd>{row.recruiter}</dd></div>}
              </dl>
              <div className="recruit-row-tools"><RecruitCommunications recruitName={name} recruitId={row.id} phone={row.phone} hubspotUrl={row.hubspotUrl ?? ""} isDemo={row.isDemo} />{canAddActivity && !row.isDemo && <RecruitQuickActions recruitId={row.id} recruitName={name} />}</div>
            </div></div></td></tr>
          </tbody>;
        })}</table></div>
      <PanelPager count={rows.length} page={view.page} size={PAGE} label="Follow up" onPage={setPage} numbers />
    </>}
  </section>;
}
