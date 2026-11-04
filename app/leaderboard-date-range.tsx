"use client";

import { useState } from "react";
import { LEADERBOARD_PERIODS } from "./leaderboard-data.mjs";
import MonthWheel from "./leaderboard-month-wheel";
import { leaderboardPeriod, leaderboardCustomPeriod, leaderboardQuickRange, leaderboardMonthOptions, leaderboardMonthWeeks, leaderboardMonthRange } from "../lib/leaderboard-period.mjs";
import styles from "./leaderboard.module.css";

export type LeaderboardPeriodId = "day" | "week" | "month" | "custom";
type CustomView = "yesterday" | "lastweek" | "lastmonth" | "choose" | "range";
const CUSTOM_VIEWS: { id: CustomView; label: string }[] = [{ id: "yesterday", label: "Yesterday" }, { id: "lastweek", label: "Last week" }, { id: "lastmonth", label: "Last month" }, { id: "choose", label: "Choose" }, { id: "range", label: "Range" }];

/** The Daily, Weekly, Monthly and Custom date range shared by the Leaderboard and Lead Data pages. */
export function useLeaderboardDates() {
  const [period, setPeriod] = useState<LeaderboardPeriodId>("day");
  const [range, setRange] = useState({ from: "", to: "" });
  const [draftRange, setDraftRange] = useState({ from: "", to: "" });
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [pickerNow, setPickerNow] = useState(0);
  const [monthKey, setMonthKey] = useState("");
  const [customView, setCustomView] = useState<CustomView>("range");
  const selectPeriod = (value: LeaderboardPeriodId, instant: number) => {
    if (value === "custom") { setPickerNow(instant); if (!monthKey) setMonthKey(leaderboardPeriod("day", instant).startDate.slice(0, 7)); }
    if (value === "custom" && !range.from) { const today = leaderboardPeriod("day", instant).startDate; const initial = { from: today, to: today }; setRange(initial); setDraftRange(initial); }
    setRangeError(null); setPeriod(value);
  };
  const applyRange = (value: { from: string; to: string }) => {
    const selected = { from: value.from, to: value.to || value.from };
    try { leaderboardCustomPeriod(selected.from, selected.to); } catch { setRangeError("Choose valid dates in order, up to 366 days."); return; }
    setRange(selected); setDraftRange(selected); setRangeError(null); setPeriod("custom");
    // Keep the month wheel on the month being shown when a range sits inside one offered month.
    const month = selected.from.slice(0, 7);
    if (month === selected.to.slice(0, 7) && leaderboardMonthOptions(pickerNow).some(option => option.key === month)) setMonthKey(month);
  };
  // Quick ranges load at once; Choose and Range only reveal their controls.
  const selectCustomView = (value: CustomView) => {
    setCustomView(value); setRangeError(null);
    if (value !== "choose" && value !== "range") applyRange(leaderboardQuickRange(value));
  };
  const selectMonth = (key: string) => {
    const whole = leaderboardMonthRange(key, pickerNow);
    if (whole && (whole.from !== range.from || whole.to !== range.to)) applyRange(whole);
  };
  const periodLabel = period === "day" ? "Today" : period === "week" ? "This week" : period === "month" ? "This month" : `${range.from} – ${range.to}`;
  return { period, range, draftRange, setDraftRange, rangeError, pickerNow, monthKey, customView, selectPeriod, applyRange, selectCustomView, selectMonth, periodLabel };
}

type Dates = ReturnType<typeof useLeaderboardDates>;

export function LeaderboardPeriodTabs({ dates, label }: { dates: Dates; label: string }) {
  return <div className={styles.segment} role="group" aria-label={label}>{LEADERBOARD_PERIODS.map(value => <button key={value.id} type="button" aria-pressed={dates.period === value.id} onClick={() => dates.selectPeriod(value.id as LeaderboardPeriodId, Date.now())}>{value.label}</button>)}</div>;
}

/** Shows only while the period is Custom. */
export function LeaderboardRangeForm({ dates }: { dates: Dates }) {
  const { period, range, draftRange, setDraftRange, rangeError, pickerNow, monthKey, customView, applyRange, selectCustomView, selectMonth } = dates;
  if (period !== "custom") return null;
  const months = pickerNow ? leaderboardMonthOptions(pickerNow) : [];
  const weeks = pickerNow && monthKey ? leaderboardMonthWeeks(monthKey, pickerNow) : [];
  const wholeMonth = pickerNow && monthKey ? leaderboardMonthRange(monthKey, pickerNow) : null;
  return <form className={styles.range} onSubmit={event => {
    event.preventDefault();
    // Submit the visible fields, including edits not yet reflected in React state.
    const fields = new FormData(event.currentTarget);
    applyRange({ from: String(fields.get("from") ?? ""), to: String(fields.get("to") ?? "") });
  }}>
    <div className={styles.segment} role="group" aria-label="Custom range">{CUSTOM_VIEWS.map(value => <button key={value.id} type="button" aria-pressed={customView === value.id} aria-controls={value.id === "choose" ? "leaderboard-month-picker" : value.id === "range" ? "leaderboard-date-range" : undefined} onClick={() => selectCustomView(value.id)}>{value.label}</button>)}</div>
    {customView === "choose" && months.length > 0 && <div id="leaderboard-month-picker" className={styles.monthPicker}>
      <h3 id="leaderboard-month-label">Month &amp; week</h3>
      <MonthWheel months={months} value={monthKey} onChange={selectMonth} labelledBy="leaderboard-month-label" />
      <div className={styles.weeks} role="group" aria-label={`Weeks of ${months.find(month => month.key === monthKey)?.label ?? "the month"}`}>
        <button type="button" aria-pressed={Boolean(wholeMonth) && range.from === wholeMonth?.from && range.to === wholeMonth?.to} disabled={!wholeMonth} onClick={() => wholeMonth && applyRange(wholeMonth)}>Full month<small>All weeks</small></button>
        {weeks.map(week => <button key={week.week} type="button" aria-pressed={range.from === week.from && range.to === week.to} disabled={!week.available} title={week.available ? undefined : "This week has not started yet"} onClick={() => applyRange({ from: week.from, to: week.to })}>Week {week.week}<small>{week.label}</small></button>)}
      </div>
    </div>}
    {customView === "range" && <div id="leaderboard-date-range" className={styles.dateFields}>
      <label>From<input type="date" name="from" min="2000-01-01" max="2099-12-31" aria-label="From date" aria-describedby="leaderboard-range-help" required value={draftRange.from} onInput={event => {
        const from = event.currentTarget.value;
        setDraftRange(value => ({ ...value, from }));
      }} /></label>
      <label>To<input type="date" name="to" min="2000-01-01" max="2099-12-31" aria-label="To date" aria-describedby="leaderboard-range-help" value={draftRange.to} onInput={event => {
        const to = event.currentTarget.value;
        setDraftRange(value => ({ ...value, to }));
      }} /></label>
      <button type="submit" className="btn btn-primary">Apply dates</button>
      <p id="leaderboard-range-help">One day or a date range, up to 366 days · Eastern time. Leave To blank for one day.</p>
    </div>}
    {rangeError && <p role="alert">{rangeError}</p>}
  </form>;
}
