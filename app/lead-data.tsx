"use client";

import Image from "next/image";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { filterLeaderboardRows, leaderboardBarWidth, leaderboardCallsRefreshActive, leaderboardCallsRefreshDelay } from "./leaderboard-data.mjs";
import { LeaderboardPeriodTabs, LeaderboardRangeForm, useLeaderboardDates } from "./leaderboard-date-range";
import { LEAD_DATA_METRICS, LEAD_DATA_REPORTS, LEAD_DATA_SOURCES, leadDataCompareRows, leadDataCsv, leadDataCsvFilename, rankLeadDataRows, sortLeadDataRows } from "./lead-data-view.mjs";
import { leaderboardPeriod } from "../lib/leaderboard-period.mjs";
import { policytekRefreshActive } from "../lib/policytek-schedule.mjs";
import styles from "./leaderboard.module.css";

type Source = "policytek" | "ringcentral" | "compare";
type Metric = "instantDisconnects" | "shortDuration";
type RowSort = { field: "count" | "name"; direction: "asc" | "desc" };
type Counts = { instantDisconnects: number; shortDuration: number };
type Row = Counts & { name: string };
type Ringcentral = { status: "available" | "unavailable"; message?: string; source?: string; fetchedAt?: string; notice?: string; rows?: Row[]; noAgent?: Counts; totals?: Counts };
type Result = { board: string; period: string; startDate: string; endDate: string; policytek: { status: string; message: string }; ringcentral: Ringcentral };
const NUMBER = new Intl.NumberFormat("en-US");
const UPDATED = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const COUNT_SORT: RowSort = { field: "count", direction: "desc" };
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? NUMBER.format(value) : "—"; }
function updated(value: string | undefined) { const stamp = value ? Date.parse(value) : NaN; return Number.isFinite(stamp) ? UPDATED.format(stamp) : null; }

export default function LeadData({ onUnauthorized }: { onUnauthorized: () => void }) {
  // RingCentral opens first because PolicyTek has no numbers to show yet.
  const [source, setSource] = useState<Source>("ringcentral");
  const [metric, setMetric] = useState<Metric>("instantDisconnects");
  const [rowSort, setRowSort] = useState<RowSort>(COUNT_SORT);
  const [query, setQuery] = useState("");
  const dates = useLeaderboardDates();
  const { period, range, periodLabel } = dates;
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { unauthorizedRef.current = onUnauthorized; }, [onUnauthorized]);
  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    // The first load of all reads both reports, so this outlasts the server's 60-second limit.
    const timeout = window.setTimeout(() => controller.abort(), 70_000);
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/lead-data", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period, ...(period === "custom" ? range : {}) }), signal: controller.signal });
      if (requestRef.current !== controller) return;
      if (response.status === 401) { setData(null); unauthorizedRef.current(); return; }
      if (!response.ok) { setError(response.status === 403 ? "This account cannot access Lead Data." : "Lead Data could not be loaded. Try Refresh."); return; }
      const result = await response.json() as Result;
      if (requestRef.current !== controller) return;
      if (result.board !== "lead-data" || result.period !== period || !result.policytek || !result.ringcentral) throw new Error("Unexpected Lead Data response");
      setData(result);
    } catch {
      if (requestRef.current === controller) setError(controller.signal.aborted ? "Loading Lead Data timed out. Try Refresh." : "Lead Data could not be loaded. Check the connection and try Refresh.");
    } finally { window.clearTimeout(timeout); if (requestRef.current === controller) { requestRef.current = null; setLoading(false); } }
  }, [period, range]);
  useEffect(() => { startTransition(() => { setData(null); void load(); }); return () => { requestRef.current?.abort(); requestRef.current = null; }; }, [load]);

  useEffect(() => {
    if (!leaderboardCallsRefreshActive(period, range.to, leaderboardPeriod("day", Date.now()).startDate)) return;
    const refresh = () => { if (policytekRefreshActive() && !document.hidden && !requestRef.current) void load(); };
    let timer: number;
    const tick = () => { refresh(); timer = window.setTimeout(tick, leaderboardCallsRefreshDelay()); };
    timer = window.setTimeout(tick, leaderboardCallsRefreshDelay());
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [period, range.to, load]);

  const current = data?.period === period && (period !== "custom" || (data.startDate === range.from && data.endDate === range.to)) ? data : null;
  const ring = current?.ringcentral.status === "available" ? current.ringcentral : null;
  const sourceLabel = LEAD_DATA_SOURCES.find(value => value.id === source)?.label ?? "Lead Data";
  const metricLabel = LEAD_DATA_METRICS.find(value => value.id === metric)?.label ?? "Calls";
  const ranked = rankLeadDataRows(ring?.rows ?? [], metric) as (Row & { rank: number })[];
  const rows = filterLeaderboardRows(sortLeadDataRows(ranked, metric, rowSort), query) as (Row & { rank: number })[];
  const max = Math.max(0, ...ranked.map(row => row[metric]));
  const total = ring?.totals?.[metric], noAgent = ring?.noAgent?.[metric];
  const showRing = source === "ringcentral";
  const stats = [
    { label: metricLabel, value: showRing ? number(total) : "—" },
    { label: "With an agent", value: showRing && typeof total === "number" && typeof noAgent === "number" ? number(total - noAgent) : "—" },
    { label: "No agent (N/A)", value: showRing ? number(noAgent) : "—" },
    { label: "Agents", value: showRing && ring ? number(ranked.length) : "—" },
  ];
  // Names sort A–Z first; counts sort highest first.
  const chooseSort = (field: RowSort["field"]) => setRowSort(value => ({ field, direction: value.field === field ? value.direction === "asc" ? "desc" : "asc" : field === "name" ? "asc" : "desc" }));
  const exportRows = () => {
    const url = URL.createObjectURL(new Blob(["﻿", leadDataCsv(rows, query.trim() ? null : ring?.noAgent ?? null)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = leadDataCsvFilename(sourceLabel, metricLabel, current?.startDate, current?.endDate);
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const compareRows = leadDataCompareRows(ring?.rows ?? []) as Row[];
  const policytekEmpty = <div className={styles.empty} role="status"><h3>PolicyTek is not connected yet</h3><p>{current?.policytek.message ?? "Loading…"}</p></div>;
  const ringEmpty = <div className={styles.empty} role="status">{loading && !current ? "Loading Lead Data…" : <><h3>RingCentral data unavailable</h3><p>{current?.ringcentral.message ?? "Lead Data could not be loaded. Try Refresh."}</p></>}</div>;
  return <section className={styles.leaderboard} aria-labelledby="lead-data-title" aria-busy={loading}>
    <header className={styles.hero}><Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners" width={180} height={117} /><p className={styles.eyebrow}>Lead quality</p><h1 id="lead-data-title" tabIndex={-1}>Lead Data</h1><p>Instant Disconnects and Short Duration Calls by agent.</p></header>
    <div className={styles.boardTabs} role="group" aria-label="Lead data source">{LEAD_DATA_SOURCES.map(value => <button key={value.id} type="button" aria-pressed={source === value.id} onClick={() => setSource(value.id as Source)}>{value.label}</button>)}</div>
    {source !== "compare" && <div className={styles.boardTabs} role="group" aria-label="Call type">{LEAD_DATA_METRICS.map(value => <button key={value.id} type="button" aria-pressed={metric === value.id} onClick={() => setMetric(value.id as Metric)}>{value.label}</button>)}</div>}
    <div className={styles.controls}><LeaderboardPeriodTabs dates={dates} label="Lead data period" /><button className="btn btn-secondary" type="button" disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button></div>
    <LeaderboardRangeForm dates={dates} />
    <div className={styles.source}><span>{source === "policytek" ? "PolicyTek" : ring?.source ?? "RingCX reports"}</span>{source !== "policytek" && ring?.fetchedAt && <span>Updated {updated(ring.fetchedAt)}</span>}{current?.startDate && <span>{current.startDate}{current.endDate !== current.startDate ? ` – ${current.endDate}` : ""} · Eastern time</span>}</div>
    {error && <div className={styles.alert} role="alert"><strong>{ring ? "Showing the last loaded numbers" : "Lead Data unavailable"}</strong><p>{error}</p></div>}
    {source !== "policytek" && ring?.notice && <p className={styles.notice} role="status">{ring.notice}</p>}
    {source === "compare" ? <div className={styles.compare}>
      <section className={styles.card} aria-labelledby="lead-compare-policytek"><div className={styles.cardHeading}><h2 id="lead-compare-policytek">PolicyTek</h2><p>{periodLabel}</p></div>{policytekEmpty}</section>
      <section className={styles.card} aria-labelledby="lead-compare-ringcentral"><div className={styles.cardHeading}><h2 id="lead-compare-ringcentral">RingCentral</h2><p>{periodLabel}</p></div>
        {!ring ? ringEmpty : <>
          <dl className={`${styles.tiles} ${styles.compareTiles}`} aria-label="RingCentral totals">{LEAD_DATA_METRICS.map(value => <div key={value.id}><dt>{value.label}</dt><dd>{number(ring.totals?.[value.id as Metric])}</dd></div>)}</dl>
          <div className={styles.tableWrap}><table className={`${styles.table} ${styles.compareTable}`}><thead><tr><th scope="col">Agent</th>{LEAD_DATA_METRICS.map(value => <th key={value.id} scope="col">{value.label}</th>)}</tr></thead>
            <tbody>{compareRows.map(row => <tr key={row.name}><th scope="row">{row.name}</th><td>{number(row.instantDisconnects)}</td><td>{number(row.shortDuration)}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row">No agent (N/A)</th><td>{number(ring.noAgent?.instantDisconnects)}</td><td>{number(ring.noAgent?.shortDuration)}</td></tr><tr><th scope="row">Total</th><td>{number(ring.totals?.instantDisconnects)}</td><td>{number(ring.totals?.shortDuration)}</td></tr></tfoot></table></div>
        </>}
      </section>
    </div> : <>
      <dl className={styles.tiles} aria-label={`${sourceLabel} totals`}>{stats.map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd title={stat.value}>{stat.value}</dd></div>)}</dl>
      <section className={styles.card} aria-labelledby="lead-data-chart-title"><div className={styles.cardHeading}><h2 id="lead-data-chart-title">{sourceLabel} · {metricLabel} · {periodLabel}</h2>{showRing && <p>RingCX report “{LEAD_DATA_REPORTS[metric]}”</p>}</div>
        {!showRing ? policytekEmpty : !ring ? ringEmpty : <>
          {ranked.length > 0 && <div className={styles.rowTools}>
            <label className={styles.search}><span>Search agents</span><input type="search" value={query} placeholder="Agent name" autoComplete="off" spellCheck={false} onChange={event => setQuery(event.currentTarget.value)} /></label>
            <div className={styles.segment} role="group" aria-label="Sort agents by">{[{ field: "count" as const, label: metricLabel }, { field: "name" as const, label: "Alphabetical" }].map(option => <button key={option.field} type="button" aria-pressed={rowSort.field === option.field} aria-label={`Sort ${option.field === "name" ? "alphabetically" : `by ${option.label}`}${rowSort.field === option.field ? rowSort.direction === "asc" ? ", ascending" : ", descending" : ""}`} onClick={() => chooseSort(option.field)}>{option.label}{rowSort.field === option.field && <span aria-hidden="true"> {rowSort.direction === "asc" ? "↑" : "↓"}</span>}</button>)}</div>
            {query.trim() && <p role="status">{rows.length} of {ranked.length} agents</p>}
            <button className={`btn btn-secondary ${styles.export}`} type="button" disabled={!rows.length} onClick={exportRows}>Export</button>
          </div>}
          {!ranked.length ? <div className={styles.empty}>{total ? "All of these calls have no agent." : "No recorded calls for this period."}</div> : !rows.length ? <div className={styles.empty} role="status">No agents match “{query.trim()}”.</div> : <><div className={`${styles.chartHead} ${styles.leadRows}`} aria-hidden="true"><span /><span>Agent</span><span /><span>{metricLabel}</span></div><ol className={`${styles.chart} ${styles.leadRows}`} aria-label={`Ranked by ${metricLabel}`}>{rows.map(row => <li key={row.name} tabIndex={0}><span className={`${styles.medal} ${row.rank <= 3 ? styles[`medal${row.rank}`] : ""}`} aria-label={`Rank ${row.rank}`}>{row.rank}</span><span className={styles.name} title={row.name}>{row.name}</span><span className={styles.barTrack}><span className={styles.bar} style={{ width: `${leaderboardBarWidth(row[metric], max)}%` }} /></span><strong>{number(row[metric])}</strong><div className={styles.rowDetails}>{LEAD_DATA_METRICS.map(value => <span key={value.id}>{value.label}: {number(row[value.id as Metric])}</span>)}</div></li>)}</ol></>}
        </>}
      </section>
    </>}
    <p className={styles.foot}>Counts only: caller numbers, notes and recordings are not read or stored. Calls with no agent count toward the totals and are not ranked.</p>
  </section>;
}
