"use client";

import { RECRUITING_PERIODS, resolveRecruitingPeriod, recruitingPeriodStats } from "./recruiting-period.mjs";
import styles from "./recruiting-period-controls.module.css";

export type PeriodSelection = { preset: string; startDate?: string; endDate?: string };
type PeriodRecord = { id: string; stageId?: string; stageKey?: string; createdAt?: string | null; enteredStageAt?: string | null; lastContactedAt?: string | null };
type PeriodStage = { id: string; key?: string; stageId?: string; label: string };
type Props = {
  records: readonly PeriodRecord[];
  stages: readonly PeriodStage[];
  selection: PeriodSelection;
  onSelectionChange: (selection: PeriodSelection) => void;
  basis?: "createdAt" | "enteredStageAt";
  now?: Date | string;
  partial?: boolean;
};

export default function RecruitingPeriodControls({ records, stages, selection, onSelectionChange, basis = "createdAt", now, partial = false }: Props) {
  const period = resolveRecruitingPeriod(selection, now);
  const stats = recruitingPeriodStats(records, stages, period, basis);
  const usesCreated = basis === "createdAt";
  return <section className={styles.section} aria-labelledby="today-period-title">
    <div className={styles.heading}>
      <h1 id="today-period-title" className={styles.title} tabIndex={-1}>
        <label className="sr-only" htmlFor="recruiting-reporting-period">Reporting period</label>
        <select id="recruiting-reporting-period" value={selection.preset} onChange={event => onSelectionChange({ ...selection, preset: event.target.value })} aria-describedby="recruiting-period-description">
          {RECRUITING_PERIODS.map(period => <option key={period.value} value={period.value}>{period.label}</option>)}
        </select>
      </h1>
      <dl className={styles.stats} aria-label="Recruiting totals for the selected period">
        <div><dt>Total recruits</dt><dd>{stats.total}</dd></div>
        <div><dt>Recruits contacted</dt><dd>{stats.contactedCount}</dd></div>
        <div><dt>Percentage contacted</dt><dd>{stats.contactedPercentage}%</dd></div>
      </dl>
      {(selection.preset === "date" || selection.preset === "range") && <div className={styles.dates}>
        <label>{selection.preset === "date" ? "Date" : "Start date"}<input type="date" min="0001-01-01" max="9999-12-31" required value={selection.startDate ?? ""} onChange={event => onSelectionChange({ ...selection, startDate: event.target.value })} aria-invalid={!period.valid} /></label>
        {selection.preset === "range" && <label>End date<input type="date" min={selection.startDate || "0001-01-01"} max="9999-12-31" required value={selection.endDate ?? ""} onChange={event => onSelectionChange({ ...selection, endDate: event.target.value })} aria-invalid={!period.valid} /></label>}
      </div>}
    </div>
    <p id="recruiting-period-description" className={styles.description}>{period.valid ? `${period.description} · Eastern time${selection.preset === "weekly" ? " · Monday–Sunday" : ""}` : "Select a valid reporting date or range."}</p>
    {!period.valid && <p className={styles.error} role="alert">{period.error}</p>}
    <p className={styles.context}>{usesCreated ? "Recruits created in the selected period." : "Recruits who entered their current stage in the selected period."} Contacted means at least one contact activity is recorded.</p>
    {(partial || stats.unknownStageCount > 0 || stats.missingDateCount > 0) && <p className={styles.note}>
      {partial ? "Totals include loaded records only. " : ""}
      {stats.unknownStageCount > 0 ? `${stats.unknownStageCount} selected recruit${stats.unknownStageCount === 1 ? " has" : "s have"} an unrecognized stage. ` : ""}
      {stats.missingDateCount > 0 ? `${stats.missingDateCount} recruit${stats.missingDateCount === 1 ? " is" : "s are"} excluded because ${usesCreated ? "created date" : "stage-entry date"} is not recorded.` : ""}
    </p>}
  </section>;
}
