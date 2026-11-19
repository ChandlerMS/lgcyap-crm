"use client";
import { useState, type ReactNode } from "react";
import PanelPager from "./panel-pager";
import { pageWindow } from "./panel-pager.mjs";
import RecruitCommunications from "./recruit-communications";
import RecruitQuickActions from "./recruit-quick-actions";
import RecruitStageControls, { type StageFlowChanges } from "./recruit-stage-controls";
import { useRecruitHoverCard } from "./recruit-hover";
import { SectionToggle } from "./dashboard-section";
import { sortRecruitRows } from "./recruit-list-view.mjs";
import type { PipelineRecruit } from "./recruit-pipeline";

import styles from "./hubspot-workspace.module.css";
import RecruitsHubSpotLink from "./recruits-hubspot-link";

const PAGE = 10;
const COLUMNS = [["name", "Recruit"], ["createdAt", "Date added"], ["office", "Office"], ["stage", "Stage"], ["lastContactedAt", "Last contacted"]] as const;
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const contacted = (value?: string | null) => { const instant = Date.parse(value ?? ""); return Number.isFinite(instant) ? date.format(instant) : "Never"; };
// Every loaded recruit, ten to a page and sorted by name like the full Recruits list; filters and the board stay on that page.
// canAddActivity shows Note, Task and Follow up on live rows for accounts that can save to HubSpot. Hovering a name shows
// the pipeline's recruit details card; now (the dashboard's clock) times its "Time in stage", else the panel's first render.
export default function RecruitsPanel({ records, partial, canAddActivity = false, nativeLinks = false, showHubSpotLink = true, now, canEdit = false, disabled = false, blockedIds = [], headerAction, onRefresh, refreshing = false, refreshDisabled = false, onStageChange }: { records: readonly PipelineRecruit[]; partial?: boolean; canAddActivity?: boolean; nativeLinks?: boolean; showHubSpotLink?: boolean; now?: number; canEdit?: boolean; disabled?: boolean; blockedIds?: readonly string[]; headerAction?: ReactNode; onRefresh?: () => void; refreshing?: boolean; refreshDisabled?: boolean; onStageChange?: (recruit: PipelineRecruit, stageId: string, flowChanges?: StageFlowChanges) => void }) {
  const [sort, setSort] = useState<{ field: string; direction: "asc" | "desc" }>({ field: "name", direction: "asc" });
  const [page, setPage] = useState(1);
  const [openedAt] = useState(() => Date.now());
  const hover = useRecruitHoverCard({ now: now ?? openedAt, canAdd: canAddActivity });
  const rows = sortRecruitRows(records, sort) as PipelineRecruit[];
  const view = pageWindow(rows.length, page, PAGE);
  return <section className={`today-panel recruits-panel ${styles.compact}`} aria-labelledby="today-recruits-title">
    <div className={styles.heading} data-section-heading><div className="section-title-controls"><h2 id="today-recruits-title"><a className="panel-title-link" href="#recruits">Recruits</a> <span className={styles.headingCount}>{rows.length}{partial ? "+" : ""}</span></h2><div className="panel-heading-actions">{headerAction}<SectionToggle /></div></div><div className={styles.headingActions}>{showHubSpotLink && <RecruitsHubSpotLink />}{onRefresh && <button type="button" className="btn btn-secondary" disabled={refreshing || refreshDisabled} onClick={onRefresh}>{refreshing ? "Loading…" : "Refresh"}</button>}</div></div>
    <p className="helper">All loaded recruits, regardless of the Today date selection or pipeline search.</p>
    {!rows.length ? <p className="helper">No recruits are loaded.</p> : <>
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
