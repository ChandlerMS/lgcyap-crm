"use client";

import Image from "next/image";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { LEADERBOARD_BOARDS, LEADERBOARD_PERIODS, leaderboardBarWidth, leaderboardMetrics, leaderboardTotals, rankLeaderboardRows, sourceLeaderboardTableRows, sourceLeaderboardValue } from "./leaderboard-data.mjs";
import { hubspotRetryDeadline } from "./hubspot-workspace-view.mjs";
import styles from "./leaderboard.module.css";

type Board = "sp" | "shopper" | "source";
type Period = "day" | "week" | "month";
type Metric = "sales" | "ap";
type Row = { name: string; attributed?: boolean; sales?: number | null; annualPremium?: number | null; submitted?: number | null; premium?: number | null; leads?: number | null; spend?: number | null; closeRate?: number | null; roas?: number | null; [key: string]: unknown };
type Result = { board: Board; period: Period; status: "available" | "connection-required" | "unavailable"; rows: Row[]; partial: boolean; source: string; notice?: string; fetchedAt?: string; startDate?: string; endDate?: string; error?: { code?: string; message?: string }; retryAfterSeconds?: number };
const NUMBER = new Intl.NumberFormat("en-US");
const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const MONEY_EXACT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const PERCENT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const UPDATED = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const SOURCE_COLUMNS = [{ field: "name", label: "Source" }, { field: "leads", label: "Leads" }, { field: "submitted", label: "Submitted" }, { field: "premium", label: "Submitted premium" }, { field: "closeRate", label: "Close" }, { field: "spend", label: "Spend" }, { field: "roas", label: "ROAS" }];
function number(value: unknown, currency = false) { return typeof value === "number" && Number.isFinite(value) ? (currency ? MONEY : NUMBER).format(value) : "—"; }
function updated(value: string | undefined) { const stamp = value ? Date.parse(value) : NaN; return Number.isFinite(stamp) ? UPDATED.format(stamp) : null; }

export default function Leaderboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [board, setBoard] = useState<Board>("sp");
  const [period, setPeriod] = useState<Period>("day");
  const [metric, setMetric] = useState<Metric>("sales");
  const [sourceSort, setSourceSort] = useState({ field: "premium", direction: "desc" });
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const retryRef = useRef(0);
  const unauthorizedRef = useRef(onUnauthorized);
  const actualPeriod = board === "sp" ? period : "day";
  useEffect(() => { unauthorizedRef.current = onUnauthorized; }, [onUnauthorized]);
  const load = useCallback(async () => {
    if (retryRef.current > Date.now()) { setLoading(false); return; }
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/leaderboard", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ board, period: actualPeriod }), signal: controller.signal });
      if (requestRef.current !== controller) return;
      if (response.status === 401) { setData(null); unauthorizedRef.current(); return; }
      const result = await response.json() as Result;
      if (requestRef.current !== controller) return;
      const deadline = hubspotRetryDeadline(result.retryAfterSeconds ?? response.headers.get("Retry-After"), response.status === 429 || result.error?.code === "HUBSPOT_RATE_LIMITED");
      if (deadline) { retryRef.current = deadline; setRetryAt(deadline); }
      if (!response.ok) { setError(result.error?.message ?? "The leaderboard could not be loaded. Try Refresh."); return; }
      if (result.board !== board || result.period !== actualPeriod || !["available", "connection-required", "unavailable"].includes(result.status) || !Array.isArray(result.rows) || typeof result.source !== "string") throw new Error("Unexpected leaderboard response");
      setData(result);
    } catch {
      if (requestRef.current === controller) setError(controller.signal.aborted ? "Loading the leaderboard timed out. Try Refresh." : "The leaderboard could not be loaded. Check the connection and try Refresh.");
    } finally { window.clearTimeout(timeout); if (requestRef.current === controller) { requestRef.current = null; setLoading(false); } }
  }, [board, actualPeriod]);
  useEffect(() => { startTransition(() => { setData(null); void load(); }); return () => { requestRef.current?.abort(); requestRef.current = null; }; }, [load]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(() => { retryRef.current = 0; setRetryAt(null); }, Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAt]);

  const current = data?.board === board && data.period === actualPeriod ? data : null;
  const available = current?.status === "available";
  const rows = available ? rankLeaderboardRows(current.rows, board, metric) as Row[] : [];
  const totals = available ? leaderboardTotals(current.rows, board, metric) : null;
  const keys = leaderboardMetrics(board);
  const selectedField = metric === "ap" ? keys.second : keys.first;
  const max = Math.max(0, ...rows.map(row => typeof row[selectedField] === "number" ? row[selectedField] as number : 0));
  const missingMetrics = available ? current.rows.filter(row => typeof row[selectedField] !== "number" || !Number.isFinite(row[selectedField])).length : 0;
  const sourceTableRows = available && board === "source" ? sourceLeaderboardTableRows(current.rows, sourceSort) as Row[] : [];
  const periodLabel = actualPeriod === "day" ? "Today" : actualPeriod === "week" ? "This week" : "This month";
  const boardLabel = LEADERBOARD_BOARDS.find(value => value.id === board)?.label ?? "Leaderboard";
  const stats = board === "source" ? [
    { label: "Leads today", value: number(totals?.leads) }, { label: "Submitted today", value: number(totals?.first) }, { label: "Submitted premium", value: number(totals?.second, true) }, { label: "Return on spend", value: totals?.roas == null ? "—" : `${totals.roas.toFixed(2)}x` },
  ] : [
    { label: board === "sp" ? `Policies sold ${periodLabel.toLowerCase()}` : "Submitted today", value: number(totals?.first) },
    { label: board === "sp" ? `Annual premium ${periodLabel.toLowerCase()}` : "Submitted premium", value: number(totals?.second, true) },
    { label: board === "sp" ? "Agents with a sale" : "Agents with a submit", value: totals ? number(totals.activeAgents) : "—" }, { label: "Top producer", value: totals?.top ?? "—" },
  ];
  return <section className={styles.leaderboard} aria-labelledby="leaderboard-title" aria-busy={loading}>
    <header className={styles.hero}><Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners" width={180} height={117} /><h1 id="leaderboard-title" tabIndex={-1}>Agent Leaderboard</h1><p>Sold policies by writing agent.</p></header>
    <div className={styles.boardTabs} role="group" aria-label="Leaderboard">{LEADERBOARD_BOARDS.map(value => <button key={value.id} type="button" aria-pressed={board === value.id} onClick={() => setBoard(value.id as Board)}>{value.label}</button>)}</div>
    <div className={styles.controls}>{board === "sp" && <div className={styles.segment} role="group" aria-label="Leaderboard period">{LEADERBOARD_PERIODS.map(value => <button key={value.id} type="button" aria-pressed={period === value.id} onClick={() => setPeriod(value.id as Period)}>{value.label}</button>)}</div>}<div className={styles.segment} role="group" aria-label="Rank by"><button type="button" aria-pressed={metric === "sales"} onClick={() => setMetric("sales")}>{keys.firstLabel}</button><button type="button" aria-pressed={metric === "ap"} onClick={() => setMetric("ap")}>{keys.secondLabel}</button></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(retryAt)} onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button></div>
    <div className={styles.source}><span>{current?.source ?? (board === "sp" ? "HubSpot" : "PolicyTek")}</span>{current?.fetchedAt && <span>Updated {updated(current.fetchedAt)}</span>}{current?.startDate && <span>{current.startDate}{current.endDate && current.endDate !== current.startDate ? ` – ${current.endDate}` : ""} · Eastern time</span>}</div>
    {error && <div className={styles.alert} role="alert"><strong>{available ? "Showing the last loaded leaderboard" : "Leaderboard unavailable"}</strong><p>{error}</p></div>}
    {retryAt && <p className={styles.notice} role="status">Refresh is available after {updated(new Date(retryAt).toISOString())}.</p>}
    {current?.notice && <p className={styles.notice} role="status">{current.notice}</p>}
    {current?.partial && <p className={styles.alert} role="status">Incomplete results: totals and rankings below cover the loaded records only.</p>}
    {missingMetrics > 0 && <p className={styles.notice}>{missingMetrics} record{missingMetrics === 1 ? " lacks" : "s lack"} the selected metric and {missingMetrics === 1 ? "is" : "are"} not ranked.</p>}
    <dl className={styles.tiles} aria-label={`${boardLabel} totals`}>{stats.map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd title={stat.value}>{stat.value}</dd></div>)}</dl>
    <section className={styles.card} aria-labelledby="leaderboard-chart-title"><div className={styles.cardHeading}><h2 id="leaderboard-chart-title">{boardLabel} · {periodLabel}</h2><p>{board === "sp" ? "HubSpot Sold deals by close date" : board === "shopper" ? "PolicyTek Agent Report by submit date" : "PolicyTek Source Performance"}</p></div>
      {loading && !current ? <div className={styles.empty} role="status">Loading leaderboard data…</div> : !available ? <div className={styles.empty} role="status"><h3>{current?.status === "connection-required" ? "Data connection required" : "Leaderboard data unavailable"}</h3><p>{current?.error?.message ?? current?.notice ?? (board === "sp" ? "HubSpot deal access must be connected before rankings can appear." : "The PolicyTek report has not been connected to this app.")}</p></div> : !rows.length ? <div className={styles.empty}>No recorded activity for this period.</div> : <ol className={styles.chart} aria-label={`Ranked by ${metric === "ap" ? keys.secondLabel.toLowerCase() : keys.firstLabel.toLowerCase()}`}>{rows.map((row, index) => <li key={`${row.name}-${index}`} tabIndex={0} className={row.attributed === false ? styles.unattributed : undefined}><span className={`${styles.medal} ${row.attributed !== false && index < 3 ? styles[`medal${index + 1}`] : ""}`} aria-label={row.attributed === false ? "Unattributed, not ranked" : `Rank ${index + 1}`}>{row.attributed === false ? "—" : index + 1}</span><span className={styles.name} title={row.name}>{row.name}</span><span className={styles.barTrack}><span className={styles.bar} style={{ width: `${leaderboardBarWidth(row[selectedField], max)}%` }} /></span><strong>{number(row[selectedField], metric === "ap")}</strong><div className={styles.rowDetails}><span>{keys.firstLabel}: {number(row[keys.first])}</span><span>{keys.secondLabel}: {number(row[keys.second], true)}</span><span>Average premium each: {typeof row[keys.first] === "number" && (row[keys.first] as number) > 0 && typeof row[keys.second] === "number" ? MONEY.format((row[keys.second] as number) / (row[keys.first] as number)) : "—"}</span></div></li>)}</ol>}
      {board === "source" && available && sourceTableRows.length > 0 && <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{SOURCE_COLUMNS.map(column => <th key={column.field} scope="col" aria-sort={sourceSort.field === column.field ? sourceSort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className={styles.sortButton} aria-label={`Sort by ${column.label}`} onClick={() => setSourceSort(value => ({ field: column.field, direction: value.field === column.field && value.direction === "asc" ? "desc" : "asc" }))}>{column.label}<span aria-hidden="true">{sourceSort.field === column.field ? sourceSort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>)}</tr></thead><tbody>{sourceTableRows.map((row, index) => { const close = sourceLeaderboardValue(row, "closeRate"), roas = sourceLeaderboardValue(row, "roas"); return <tr key={`${row.name}-${index}`}><th scope="row">{row.name}</th><td>{number(row.leads)}</td><td>{number(row.submitted)}</td><td>{typeof row.premium === "number" ? MONEY_EXACT.format(row.premium) : "—"}</td><td>{close == null ? "—" : PERCENT.format(close)}</td><td>{number(row.spend, true)}</td><td>{roas == null ? "—" : `${roas.toFixed(2)}x`}</td></tr>; })}</tbody></table></div>}
    </section>
    <p className={styles.foot}>{board === "sp" ? "Standard and Preferred are combined here. These are HubSpot Sold deals; PolicyTek remains a separate source." : "PolicyTek data is not connected to this app."}</p>
  </section>;
}
