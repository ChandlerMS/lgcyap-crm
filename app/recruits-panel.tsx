"use client";
import { useState, useId, useRef, type ReactNode } from "react";
import PanelPager from "./panel-pager";
import { pageWindow } from "./panel-pager.mjs";
import RecruitCommunications from "./recruit-communications";
import RecruitQuickActions from "./recruit-quick-actions";
import RecruitStageControls, { type StageFlowChanges } from "./recruit-stage-controls";
import { useRecruitHoverCard } from "./recruit-hover";
import { SectionToggle } from "./dashboard-section";
import { hubspotDateKey } from "./hubspot-workspace-view.mjs";
import { sortRecruitRows } from "./recruit-list-view.mjs";
import type { PipelineRecruit } from "./recruit-pipeline";

import styles from "./hubspot-workspace.module.css";
import RecruitsHubSpotLink from "./recruits-hubspot-link";

const PAGE = 10;
const COLUMNS = [["name", "Recruit"], ["createdAt", "Date added"], ["office", "Office"], ["stage", "Stage"], ["lastContactedAt", "Last contacted"]] as const;
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const contacted = (value?: string | null) => { const instant = Date.parse(value ?? ""); return Number.isFinite(instant) ? date.format(instant) : "Never"; };
// Loaded recruits, ten to a page, with an independent Date added search in Eastern Time.
// canAddActivity shows Note, Task and Follow up on live rows for accounts that can save to HubSpot. Hovering a name shows
// the pipeline's recruit details card; now (the dashboard's clock) times its "Time in stage", else the panel's first render.
export default function RecruitsPanel({ records, partial, canAddActivity = false, nativeLinks = false, showHubSpotLink = true, now, canEdit = false, disabled = false, blockedIds = [], headerAction, onRefresh, refreshing = false, refreshDisabled = false, onStageChange }: { records: readonly PipelineRecruit[]; partial?: boolean; canAddActivity?: boolean; nativeLinks?: boolean; showHubSpotLink?: boolean; now?: number; canEdit?: boolean; disabled?: boolean; blockedIds?: readonly string[]; headerAction?: ReactNode; onRefresh?: () => void; refreshing?: boolean; refreshDisabled?: boolean; onStageChange?: (recruit: PipelineRecruit, stageId: string, flowChanges?: StageFlowChanges) => void }) {
  const [sort, setSort] = useState<{ field: string; direction: "asc" | "desc" }>({ field: "name", direction: "asc" });
  const [page, setPage] = useState(1);
  const [addedOn, setAddedOn] = useState("");
  const [filters, setFilters] = useState({ office: "", stage: "", name: "" });
  const dateInputId = useId();
  const dateForm = useRef<HTMLFormElement>(null);
  const [openedAt] = useState(() => Date.now());
  const hover = useRecruitHoverCard({ now: now ?? openedAt, canAdd: canAddActivity });
  const offices = [...new Set(records.map(record => record.office?.trim() || "Not recorded"))].sort((a, b) => a.localeCompare(b));
  const stages = [...new Set(records.map(record => record.stage?.trim() || "Not recorded"))].sort((a, b) => a.localeCompare(b));
  const filtered = Boolean(addedOn || filters.office || filters.stage || filters.name);
  const rows = sortRecruitRows(records.filter(record => (!addedOn || hubspotDateKey(record.createdAt) === addedOn)
    && (!filters.office || (record.office?.trim() || "Not recorded") === filters.office)
    && (!filters.stage || (record.stage?.trim() || "Not recorded") === filters.stage)
    && (!filters.name || (record.name || [record.firstName, record.lastName].filter(Boolean).join(" ")).toLocaleLowerCase("en-US").includes(filters.name.toLocaleLowerCase("en-US")))), sort) as PipelineRecruit[];
  const view = pageWindow(rows.length, page, PAGE);
  return <section className={`today-panel recruits-panel ${styles.compact}`} aria-labelledby="today-recruits-title">
    <div className={styles.heading} data-section-heading><div className="section-title-controls"><h2 id="today-recruits-title"><a className="panel-title-link" href="#recruits">Recruits</a> <span className={styles.headingCount}>{rows.length}{partial ? "+" : ""}</span></h2><div className="panel-heading-actions">{headerAction}<SectionToggle /></div></div><div className={styles.headingActions}>{showHubSpotLink && <RecruitsHubSpotLink />}{onRefresh && <button type="button" className="btn btn-secondary" disabled={refreshing || refreshDisabled} onClick={onRefresh}>{refreshing ? "Loading…" : "Refresh"}</button>}</div></div>
    <form ref={dateForm} className="recruits-filter-form" onSubmit={event => {
      event.preventDefault(); const input = new window.FormData(event.currentTarget);
      setAddedOn(String(input.get("addedOn") ?? ""));
      setFilters({ office: String(input.get("office") ?? ""), stage: String(input.get("stage") ?? ""), name: String(input.get("name") ?? "").trim() }); setPage(1);
    }}>
      <label htmlFor={dateInputId}>Date added (Eastern Time)<input id={dateInputId} name="addedOn" type="date" /></label>
      <label>Office<select name="office"><option value="">All offices</option>{offices.map(office => <option key={office} value={office}>{office}</option>)}</select></label>
      <label>Stage<select name="stage"><option value="">All stages</option>{stages.map(stage => <option key={stage} value={stage}>{stage}</option>)}</select></label>
      <label>Name<input name="name" type="search" placeholder="Search recruit name" maxLength={200} /></label>
      <label>Sort by<select name="sort" value={`${sort.field}:${sort.direction}`} onChange={event => { const [field, direction] = event.target.value.split(":"); setSort({ field, direction: direction === "desc" ? "desc" : "asc" }); setPage(1); }}>
        <option value="name:asc">Name · A–Z</option><option value="name:desc">Name · Z–A</option><option value="office:asc">Office · A–Z</option><option value="office:desc">Office · Z–A</option><option value="stage:asc">Stage · A–Z</option><option value="stage:desc">Stage · Z–A</option><option value="createdAt:desc">Date added · Newest</option><option value="createdAt:asc">Date added · Oldest</option><option value="lastContactedAt:desc">Last contacted · Newest</option><option value="lastContactedAt:asc">Last contacted · Oldest</option>
      </select></label>
      <div className="recruits-filter-actions"><button type="submit" className="btn btn-primary">Search</button><button type="button" className="btn btn-secondary" onClick={() => { const field = dateForm.current?.elements.namedItem("addedOn") as HTMLInputElement | null; if (field) field.value = ""; setAddedOn(""); setPage(1); }}>Clear date</button><button type="button" className="btn btn-secondary" onClick={() => { dateForm.current?.reset(); setAddedOn(""); setFilters({ office: "", stage: "", name: "" }); setSort({ field: "name", direction: "asc" }); setPage(1); }}>Clear filters</button></div>
    </form>
    <p className="helper" role="status">{filtered ? `${rows.length} matching recruits of ${records.length} loaded recruits. Dates use Eastern Time.` : `${records.length} loaded recruits, regardless of the Today date selection or pipeline search.`}{partial && " Only loaded records are searched; more recruits may be available in HubSpot."}</p>
    {!rows.length ? <p className="helper">{filters.office || filters.stage || filters.name ? "No loaded recruits match these filters." : addedOn ? "No loaded recruits were added on this date." : "No recruits are loaded."}</p> : <>
      <div className="table-wrap"><table className="data-table"><thead><tr>{COLUMNS.map(([field, label]) => <th key={field} aria-sort={sort.field === field ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button className="column-sort" onClick={() => { setSort({ field, direction: sort.field === field && sort.direction === "asc" ? "desc" : "asc" }); setPage(1); }}>{label}{sort.field === field ? sort.direction === "asc" ? " ↑" : " ↓" : ""}</button></th>)}<th><span className="sr-only">Contact tools, notes and tasks</span></th></tr></thead>
        <tbody>{rows.slice(view.start, view.end).map(record => {
          const name = record.name || [record.firstName, record.lastName].filter(Boolean).join(" ") || "Unnamed recruit";
          return <tr key={record.id}><td><a className="text-link" href={nativeLinks && !record.isDemo ? record.hubspotUrl : `#recruit/${encodeURIComponent(record.id)}`} target={nativeLinks && !record.isDemo ? "_blank" : undefined} rel={nativeLinks && !record.isDemo ? "noopener noreferrer" : undefined} {...hover.bind(record)}>{name}</a></td><td>{record.createdAt && Number.isFinite(Date.parse(record.createdAt)) ? date.format(Date.parse(record.createdAt)) : "Not recorded"}</td><td>{record.office || "Not recorded"}</td><td><RecruitStageControls recruit={{ ...record, name, stageId: record.stageId ?? "", updatedAt: record.updatedAt ?? null, recruitingPath: record.recruitingPath ?? undefined, licenseRoute: record.licenseRoute ?? undefined }} mode="select" canEdit={canEdit && Boolean(onStageChange)} disabled={disabled || blockedIds.includes(record.id)} onChange={(stageId, flowChanges) => onStageChange?.(record, stageId, flowChanges)} /></td><td>{contacted(record.lastContactedAt)}</td><td className="communication-cell"><div className="recruit-row-tools"><RecruitCommunications recruitName={name} recruitId={record.id} phone={record.phone} hubspotUrl={record.hubspotUrl ?? ""} isDemo={record.isDemo} />{canAddActivity && !record.isDemo && <RecruitQuickActions recruitId={record.id} recruitName={name} />}</div></td></tr>;
        })}</tbody></table></div>
      <PanelPager count={rows.length} page={view.page} size={PAGE} label="Recruits" onPage={setPage} />
    </>}
    {hover.card}
  </section>;
}
