"use client";
import { useState } from "react";
import RecruitCommunications from "./recruit-communications";
import { followUpRecruits } from "./recruit-follow-up.mjs";
import type { PipelineRecruit } from "./recruit-pipeline";

type Row = PipelineRecruit & { neverContacted: boolean; followUpSince: number; daysWaiting: number };
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
export default function RecruitFollowUp({ records, now, partial }: { records: readonly PipelineRecruit[]; now: number; partial?: boolean }) {
  const [sort, setSort] = useState({ field: "followUpSince", direction: "asc" });
  const [page, setPage] = useState(1);
  const rows = followUpRecruits(records, now) as Row[];
  rows.sort((a, b) => {
    const comparison = sort.field === "followUpSince" ? a.followUpSince - b.followUpSince
      : String(a[sort.field as "name" | "stage"] ?? "").localeCompare(String(b[sort.field as "name" | "stage"] ?? ""));
    return (sort.direction === "asc" ? comparison : -comparison) || a.id.localeCompare(b.id);
  });
  const pages = Math.max(1, Math.ceil(rows.length / 20)), current = Math.min(page, pages);
  return <section className="follow-up-section" aria-labelledby="follow-up-title">
    <div className="follow-up-heading"><h2 id="follow-up-title">Follow Up <span>{rows.length}{partial ? "+" : ""}</span></h2><span className="muted">Over 15 days without contact</span></div>
    <p className="helper">Across all loaded recruits, regardless of the Today date selection or pipeline search. Never-contacted recruits appear after 15 days from creation. {partial ? "More records may be missing while the pipeline is partially loaded." : ""}</p>
    {!rows.length ? <p className="helper">No recruits with a recorded contact or creation date are overdue for follow-up.</p> : <>
      <div className="table-wrap"><table className="data-table"><thead><tr>{[["name", "Recruit"], ["stage", "Stage"], ["followUpSince", "Last contacted / waiting since"]].map(([field, label]) => <th key={field} aria-sort={sort.field === field ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button className="column-sort" onClick={() => { setSort({ field, direction: sort.field === field && sort.direction === "asc" ? "desc" : "asc" }); setPage(1); }}>{label}{sort.field === field ? sort.direction === "asc" ? " ↑" : " ↓" : ""}</button></th>)}<th><span className="sr-only">Contact tools</span></th></tr></thead><tbody>{rows.slice((current - 1) * 20, current * 20).map(record => <tr key={record.id}><td><a className="text-link" href={`#recruit/${encodeURIComponent(record.id)}`}>{record.name || [record.firstName, record.lastName].filter(Boolean).join(" ") || "Unnamed recruit"}</a></td><td>{record.stage || "Not recorded"}</td><td>{record.neverContacted ? "Never contacted · Created " : ""}{date.format(record.followUpSince)}<small className="follow-up-age">{record.daysWaiting}+ days waiting</small></td><td className="communication-cell"><RecruitCommunications recruitName={record.name || "Recruit"} recruitId={record.id} hubspotUrl={record.hubspotUrl ?? ""} isDemo={record.isDemo} /></td></tr>)}</tbody></table></div>
      {pages > 1 && <div className="pagination"><span>Page {current} of {pages}</span><div><button className="btn btn-secondary" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous follow-ups</button><button className="btn btn-secondary" disabled={current === pages} onClick={() => setPage(current + 1)}>Next follow-ups</button></div></div>}
    </>}
  </section>;
}
