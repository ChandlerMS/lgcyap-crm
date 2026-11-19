"use client";
import { useState } from "react";
import PanelPager from "./panel-pager";
import { pageWindow } from "./panel-pager.mjs";
import RecruitCommunications from "./recruit-communications";
import RecruitQuickActions from "./recruit-quick-actions";
import { followUpRecruits } from "./recruit-follow-up.mjs";
import type { PipelineRecruit } from "./recruit-pipeline";

type Row = PipelineRecruit & { neverContacted: boolean; followUpSince: number; daysWaiting: number };
type Sort = { field: "followUpSince" | "name" | "stage"; direction: "asc" | "desc" };
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const COLUMNS: [Sort["field"], string][] = [["name", "Recruit"], ["stage", "Stage"], ["followUpSince", "Waiting"]];
const nameOf = (row: PipelineRecruit) => row.name || [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unnamed recruit";

// The full Follow up list: recruits with no contact for more than 15 days, longest waiting first, ten to a page.
export default function FollowUpPage({ records, now, partial, query = "", canAddActivity = false }: { records: readonly PipelineRecruit[]; now: number; partial?: boolean; query?: string; canAddActivity?: boolean }) {
  const [sort, setSort] = useState<Sort>({ field: "followUpSince", direction: "asc" });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const search = query.trim().toLowerCase();
  const rows = (followUpRecruits(records, now) as Row[])
    .filter(row => !search || [nameOf(row), row.stage, row.office].some(value => String(value ?? "").toLowerCase().includes(search)))
    .sort((a, b) => {
      const comparison = sort.field === "followUpSince" ? a.followUpSince - b.followUpSince : (sort.field === "name" ? nameOf(a) : String(a.stage ?? "")).localeCompare(sort.field === "name" ? nameOf(b) : String(b.stage ?? ""));
      return (sort.direction === "asc" ? comparison : -comparison) || a.id.localeCompare(b.id);
    });
  const view = pageWindow(rows.length, page, size);
  return <section className="follow-up-page" aria-labelledby="follow-up-page-title">
    <div className="page-head"><div><h1 id="follow-up-page-title" className="page-title" tabIndex={-1}>Follow up <span className="title-count">{rows.length}{partial ? "+" : ""}</span></h1><p className="subheading">Recruits with no contact for more than 15 days, longest waiting first. Never-contacted recruits count from when they were added.</p></div></div>
    {partial && <p className="partial-notice" role="status">More recruits may be missing while the pipeline is partly loaded.</p>}
    {!rows.length ? <p className="helper">{search ? `No one waiting matches “${query.trim()}”.` : "No one is waiting more than 15 days."}</p> : <>
      <div className="table-wrap"><table className="data-table"><thead><tr>{COLUMNS.map(([field, label]) => <th key={field} aria-sort={sort.field === field ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button className="column-sort" onClick={() => { setSort(value => ({ field, direction: value.field === field && value.direction === "asc" ? "desc" : "asc" })); setPage(1); }}>{label}{sort.field === field ? sort.direction === "asc" ? " ↑" : " ↓" : ""}</button></th>)}<th scope="col">Office</th><th><span className="sr-only">Contact tools, notes and tasks</span></th></tr></thead>
        <tbody>{rows.slice(view.start, view.end).map(row => {
          const name = nameOf(row);
          return <tr key={row.id}>
            <td><a className="text-link" href={`#recruit/${encodeURIComponent(row.id)}`}>{name}</a></td>
            <td>{row.stage || "Not recorded"}</td>
            <td><strong className="follow-up-days">{row.daysWaiting} days</strong><span className="muted"> · {row.neverContacted ? `added ${DATE.format(row.followUpSince)}, never contacted` : `last contacted ${DATE.format(row.followUpSince)}`}</span></td>
            <td>{row.office || "Not recorded"}</td>
            <td className="communication-cell"><div className="recruit-row-tools"><RecruitCommunications recruitName={name} recruitId={row.id} phone={row.phone} hubspotUrl={row.hubspotUrl ?? ""} isDemo={row.isDemo} />{canAddActivity && !row.isDemo && <RecruitQuickActions recruitId={row.id} recruitName={name} />}</div></td>
          </tr>;
        })}</tbody></table></div>
      <PanelPager count={rows.length} page={view.page} size={size} label="Follow up" onPage={setPage} sizes={[10, 25, 50]} onSize={setSize} />
    </>}
  </section>;
}
