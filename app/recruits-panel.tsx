"use client";
import { useState } from "react";
import PanelPager from "./panel-pager";
import { pageWindow } from "./panel-pager.mjs";
import RecruitCommunications from "./recruit-communications";
import RecruitQuickActions from "./recruit-quick-actions";
import { useRecruitHoverCard } from "./recruit-hover";
import { SectionToggle } from "./dashboard-section";
import { sortRecruitRows } from "./recruit-list-view.mjs";
import type { PipelineRecruit } from "./recruit-pipeline";

const PAGE = 10;
const COLUMNS = [["name", "Recruit"], ["stage", "Stage"], ["lastContactedAt", "Last contacted"]] as const;
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const contacted = (value?: string | null) => { const instant = Date.parse(value ?? ""); return Number.isFinite(instant) ? date.format(instant) : "Never"; };
// Every loaded recruit, ten to a page and sorted by name like the full Recruits list; filters and the board stay on that page.
// canAddActivity shows Note, Task and Follow up on live rows for accounts that can save to HubSpot. Hovering a name shows
// the pipeline's recruit details card; now (the dashboard's clock) times its "Time in stage", else the panel's first render.
export default function RecruitsPanel({ records, partial, canAddActivity = false, nativeLinks = false, now }: { records: readonly PipelineRecruit[]; partial?: boolean; canAddActivity?: boolean; nativeLinks?: boolean; now?: number }) {
  const [sort, setSort] = useState<{ field: string; direction: "asc" | "desc" }>({ field: "name", direction: "asc" });
  const [page, setPage] = useState(1);
  const [openedAt] = useState(() => Date.now());
  const hover = useRecruitHoverCard({ now: now ?? openedAt, canAdd: canAddActivity });
  const rows = sortRecruitRows(records, sort) as PipelineRecruit[];
  const view = pageWindow(rows.length, page, PAGE);
  return <section className="today-panel recruits-panel" aria-labelledby="today-recruits-title">
    <div className="follow-up-heading"><h2 id="today-recruits-title"><a className="panel-title-link" href="#recruits">Recruits</a> <span>{rows.length}{partial ? "+" : ""}</span></h2><div className="panel-heading-actions"><SectionToggle /></div></div>
    <p className="helper">All loaded recruits, regardless of the Today date selection or pipeline search.</p>
    {!rows.length ? <p className="helper">No recruits are loaded.</p> : <>
      <div className="table-wrap"><table className="data-table"><thead><tr>{COLUMNS.map(([field, label]) => <th key={field} aria-sort={sort.field === field ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button className="column-sort" onClick={() => { setSort({ field, direction: sort.field === field && sort.direction === "asc" ? "desc" : "asc" }); setPage(1); }}>{label}{sort.field === field ? sort.direction === "asc" ? " ↑" : " ↓" : ""}</button></th>)}<th><span className="sr-only">Contact tools, notes and tasks</span></th></tr></thead>
        <tbody>{rows.slice(view.start, view.end).map(record => {
          const name = record.name || [record.firstName, record.lastName].filter(Boolean).join(" ") || "Unnamed recruit";
          return <tr key={record.id}><td><a className="text-link" href={nativeLinks && !record.isDemo ? record.hubspotUrl : `#recruit/${encodeURIComponent(record.id)}`} target={nativeLinks && !record.isDemo ? "_blank" : undefined} rel={nativeLinks && !record.isDemo ? "noopener noreferrer" : undefined} {...hover.bind(record)}>{name}</a></td><td>{record.stage || "Not recorded"}</td><td>{contacted(record.lastContactedAt)}</td><td className="communication-cell"><div className="recruit-row-tools"><RecruitCommunications recruitName={name} recruitId={record.id} phone={record.phone} hubspotUrl={record.hubspotUrl ?? ""} isDemo={record.isDemo} />{canAddActivity && !record.isDemo && <RecruitQuickActions recruitId={record.id} recruitName={name} />}</div></td></tr>;
        })}</tbody></table></div>
      <PanelPager count={rows.length} page={view.page} size={PAGE} label="Recruits" onPage={setPage} />
    </>}
    {hover.card}
  </section>;
}
