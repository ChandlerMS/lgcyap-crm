"use client";
import { useState } from "react";
import RecruitCommunications from "./recruit-communications";
import { sortRecruitRows } from "./recruit-list-view.mjs";
import type { PipelineRecruit } from "./recruit-pipeline";

const PAGE = 20;
const COLUMNS = [["name", "Recruit"], ["stage", "Stage"], ["lastContactedAt", "Last contacted"]] as const;
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const contacted = (value?: string | null) => { const instant = Date.parse(value ?? ""); return Number.isFinite(instant) ? date.format(instant) : "Never"; };
// Every loaded recruit beside Calls, sorted by name like the full Recruits list; filters and the board stay on that page.
export default function RecruitsPanel({ records, partial }: { records: readonly PipelineRecruit[]; partial?: boolean }) {
  const [sort, setSort] = useState<{ field: string; direction: "asc" | "desc" }>({ field: "name", direction: "asc" });
  const [page, setPage] = useState(1);
  const rows = sortRecruitRows(records, sort) as PipelineRecruit[];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)), current = Math.min(page, pages);
  return <section className="today-panel recruits-panel" aria-labelledby="today-recruits-title">
    <div className="follow-up-heading"><h2 id="today-recruits-title">Recruits <span>{rows.length}{partial ? "+" : ""}</span></h2><a className="text-link" href="#recruits">Open full list</a></div>
    <p className="helper">All loaded recruits, regardless of the Today date selection or pipeline search.</p>
    {!rows.length ? <p className="helper">No recruits are loaded.</p> : <>
      <div className="table-wrap"><table className="data-table"><thead><tr>{COLUMNS.map(([field, label]) => <th key={field} aria-sort={sort.field === field ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button className="column-sort" onClick={() => { setSort({ field, direction: sort.field === field && sort.direction === "asc" ? "desc" : "asc" }); setPage(1); }}>{label}{sort.field === field ? sort.direction === "asc" ? " ↑" : " ↓" : ""}</button></th>)}<th><span className="sr-only">Contact tools</span></th></tr></thead>
        <tbody>{rows.slice((current - 1) * PAGE, current * PAGE).map(record => {
          const name = record.name || [record.firstName, record.lastName].filter(Boolean).join(" ") || "Unnamed recruit";
          return <tr key={record.id}><td><a className="text-link" href={`#recruit/${encodeURIComponent(record.id)}`}>{name}</a></td><td>{record.stage || "Not recorded"}</td><td>{contacted(record.lastContactedAt)}</td><td className="communication-cell"><RecruitCommunications recruitName={name} recruitId={record.id} phone={record.phone} hubspotUrl={record.hubspotUrl ?? ""} isDemo={record.isDemo} /></td></tr>;
        })}</tbody></table></div>
      {pages > 1 && <div className="pagination"><span>Showing {(current - 1) * PAGE + 1}–{Math.min(current * PAGE, rows.length)} of {rows.length}</span><div><button className="btn btn-secondary" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button><button className="btn btn-secondary" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button></div></div>}
    </>}
  </section>;
}
