"use client";

import { Fragment } from "react";
import DismissibleNotice from "./dismissible-notice";
import { leaderboardBarWidth, leaderboardComparisonCsv, leaderboardComparisonRows, leaderboardCsvFilename, leaderboardSpCallLabel, leaderboardTotals } from "./leaderboard-data.mjs";
import type { Board, Result } from "./leaderboard";
import styles from "./leaderboard.module.css";

type SideValues = { sales: number | null; premium: number | null };
type ComparisonRow = { name: string; left: SideValues | null; right: SideValues | null };
type Props = {
  left: Result | null; right: Result | null; leftBoard: Board; rightBoard: Board; leftLabel: string; rightLabel: string;
  leftError: string | null; rightError: string | null; loading: boolean; periodLabel: string; requestedStart: string; requestedEnd: string;
  metric: "sales" | "ap"; query: string; onQuery: (value: string) => void;
  sort: { field: string; direction: "asc" | "desc" }; onSort: (field: string) => void; retryAt: number | null;
};
const NUMBER = new Intl.NumberFormat("en-US");
const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const PERCENT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const UPDATED = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const SORT_FIELDS = [{ field: "production", label: "Annual premium" }, { field: "sales", label: "Policies sold" }, { field: "name", label: "Alphabetical" }];
const value = (input: unknown, money = false) => typeof input === "number" && Number.isFinite(input) ? (money ? MONEY : NUMBER).format(input) : "—";
const timestamp = (input?: string) => input && Number.isFinite(Date.parse(input)) ? UPDATED.format(Date.parse(input)) : null;

function SourceSummary({ result, board, label, error, loading, start, end }: { result: Result | null; board: Board; label: string; error: string | null; loading: boolean; start: string; end: string }) {
  const available = result?.status === "available";
  const totals = available ? leaderboardTotals(result.rows, board) : null;
  const combined = available && board === "all" ? result.combinedTotals : null;
  const report = available && board === "shopper" ? result.reportTotals : null;
  const policies = combined ? combined.sales : report ? report.submitted : totals?.first;
  const premium = combined ? combined.annualPremium : report ? report.premium : totals?.second;
  const calls = !available ? null : combined ? combined.calls : board === "sp" ? result.calls?.total : board === "shopper" ? report?.leads ?? totals?.leads : result.calls?.connected;
  const close = !available ? null : combined ? combined.closeRate : board === "sp" ? result.calls?.soldPerInboundLog : board === "shopper" ? typeof policies === "number" && typeof calls === "number" && calls > 0 ? policies / calls : null : result.calls?.closeRate;
  const firstDate = result?.startDate ?? start, lastDate = result?.endDate ?? end;
  const stats = [{ label: board === "shopper" ? "Policies submitted" : "Policies sold", value: value(policies) }, { label: board === "shopper" ? "Annual premium · submitted" : "Annual premium", value: value(premium, true) }, { label: board === "all" ? "Calls / leads" : board === "shopper" ? "Leads" : "Calls", value: value(calls) }, { label: board === "all" ? "Sales / activity" : "Close rate", value: typeof close === "number" && Number.isFinite(close) ? PERCENT.format(close) : "—" }];
  return <section className={`${styles.card} ${styles.comparisonSource}`} aria-label={label}>
    <div className={styles.cardHeading}><h2>{label}</h2><span className={styles.comparisonStatus}>{loading && !result ? "Loading" : available ? result.stale ? "Saved · stale" : "Available" : "Unavailable"}</span></div>
    <dl className={`${styles.tiles} ${styles.compareTiles}`} aria-label={`${label} totals`}>{stats.map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd title={stat.value}>{stat.value}</dd></div>)}</dl>
    <div className={styles.comparisonSourceNotes}>
      <p>{result?.source ?? label}</p>
      <p>{firstDate}{lastDate && lastDate !== firstDate ? ` – ${lastDate}` : ""} · Eastern time{!result && " · selected range"}</p>
      <p>{result?.fetchedAt && timestamp(result.fetchedAt) ? `Updated ${timestamp(result.fetchedAt)}` : "Updated time unavailable"}</p>
      {loading && !result && <p role="status">Loading source data…</p>}
      {!available && !loading && <p role="status">{error ?? result?.error?.message ?? result?.notice ?? (board === "whatsapp-sp" ? "Awaiting separate Standard vs Preferred WhatsApp spreadsheets." : "Source data unavailable for this period.")}</p>}
      {available && error && <DismissibleNotice className={styles.alert} role="alert">Showing the last loaded source. {error}</DismissibleNotice>}
      {available && result.notice && <p role="status">{result.notice}</p>}
      {result?.stale && <p role="status">Saved results are stale. This source has not refreshed successfully.</p>}
      {result?.partial && <p role="status">Incomplete results: totals and named rows cover loaded records or imported days only.</p>}
      {result?.callNotice && <p role="status">{result.callNotice}</p>}
      {result?.calls?.partial && <p role="status">Incomplete call results: calls cover loaded logs only.</p>}
      {board === "sp" && <p>HubSpot Sold deals by close date. {leaderboardSpCallLabel(result?.calls?.basis)}. Close is sold ÷ calls.</p>}
      {board === "shopper" && <p>PolicyTek Shopper Agent Report by submit date. Policy and annual premium comparisons use submitted values; report totals can include activity without a named agent.</p>}
      {board === "all" && <p>PolicyTek Shopper + HubSpot Standard vs Preferred. Calls / leads combines Shopper leads and Standard vs Preferred calls. Sales / activity uses that mixed basis; source totals can include activity without a named agent.</p>}
      {(board === "whatsapp" || board === "whatsapp-sp") && <p>Imported daily agent reports by sale date. Total Production is annual premium.{result?.dataThrough ? ` Activity through ${result.dataThrough}.` : ""} {result?.calls?.basis === "monthly" ? "Calls are entered monthly totals; Close is sales ÷ calls." : `Calls are connected inbound queue calls; Close is queue sold ÷ calls, recorded from ${result?.calls?.coverageStart ?? "2026-06-17"}.`}</p>}
    </div>
  </section>;
}

export default function LeaderboardComparison(props: Props) {
  const { left, right, leftBoard, rightBoard, leftLabel, rightLabel, leftError, rightError, loading, periodLabel, requestedStart, requestedEnd, metric, query, onQuery, sort, onSort, retryAt } = props;
  const allRows = leaderboardComparisonRows(left, right, metric) as ComparisonRow[];
  const rows = leaderboardComparisonRows(left, right, metric, query, ["sales", "production", "name"].includes(sort.field) ? sort : undefined) as ComparisonRow[];
  const selected = metric === "ap" ? "premium" : "sales";
  const max = Math.max(0, ...allRows.flatMap(row => [row.left?.[selected], row.right?.[selected]]).filter((input): input is number => typeof input === "number" && Number.isFinite(input)));
  const exportRows = () => {
    const url = URL.createObjectURL(new Blob(["\uFEFF", leaderboardComparisonCsv(rows, leftLabel, rightLabel)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = leaderboardCsvFilename(`${leftLabel} vs ${rightLabel}`, requestedStart, requestedEnd);
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <>
    <div className={styles.comparisonSources}>
      <SourceSummary result={left} board={leftBoard} label={leftLabel} error={leftError} loading={loading} start={requestedStart} end={requestedEnd} />
      <SourceSummary result={right} board={rightBoard} label={rightLabel} error={rightError} loading={loading} start={requestedStart} end={requestedEnd} />
    </div>
    {retryAt && <DismissibleNotice className={styles.notice} role="status">Refresh is available after {timestamp(new Date(retryAt).toISOString())}.</DismissibleNotice>}
    <section className={styles.card} aria-labelledby="leaderboard-comparison-title">
      <div className={styles.cardHeading}><h2 id="leaderboard-comparison-title">Agent comparison · {periodLabel}</h2><p>Bars share one {metric === "ap" ? "annual premium" : "policies sold"} scale across both sources.</p></div>
      <div className={styles.rowTools}>
        <label className={styles.search}><span>Search agents</span><input type="search" value={query} placeholder="Agent name" autoComplete="off" spellCheck={false} onChange={event => onQuery(event.currentTarget.value)} /></label>
        <div className={styles.segment} role="group" aria-label="Sort comparison by">{SORT_FIELDS.map(option => <button key={option.field} type="button" aria-pressed={sort.field === option.field} aria-label={`Sort ${option.field === "name" ? "alphabetically" : `by ${option.label}`}${sort.field === option.field ? sort.direction === "asc" ? ", ascending" : ", descending" : ""}`} onClick={() => onSort(option.field)}>{option.label}{sort.field === option.field && <span aria-hidden="true"> {sort.direction === "asc" ? "↑" : "↓"}</span>}</button>)}</div>
        <button type="button" className={`btn btn-secondary ${styles.export}`} disabled={!rows.length} onClick={exportRows}>Export</button>
        {query.trim() && <p role="status">{rows.length} of {allRows.length} agents</p>}
      </div>
      {loading && !left && !right ? <div className={styles.empty} role="status">Loading comparison data…</div> : !rows.length ? <div className={styles.empty} role="status">{query.trim() ? `No agents match “${query.trim()}”.` : left?.status === "available" || right?.status === "available" ? "No recorded activity for this period." : "Comparison data unavailable for this period."}</div> : <div className={styles.comparisonTableWrap}><table className={`${styles.table} ${styles.comparisonTable}`} aria-label="Agent comparison"><thead><tr><th rowSpan={2} scope="col">Agent</th><th colSpan={2} scope="colgroup">{leftLabel}</th><th colSpan={2} scope="colgroup">{rightLabel}</th></tr><tr>{["left", "right"].map(side => <Fragment key={side}><th scope="col">Policies sold{side === "left" && leftBoard === "shopper" ? " / submitted" : ""}</th><th scope="col">Annual premium</th></Fragment>)}</tr></thead><tbody>{rows.map(row => <tr key={row.name}><th scope="row">{row.name}</th>{(["left", "right"] as const).map(side => <Fragment key={side}>{(["sales", "premium"] as const).map(column => <td key={column} className={styles.comparisonValue}>{row[side]?.[column] == null ? "—" : <><span>{value(row[side]?.[column], column === "premium")}</span>{column === selected && <span className={styles.comparisonBarTrack} aria-hidden="true"><span data-comparison-bar={side} className={`${styles.bar} ${side === "right" ? styles.comparisonBarRight : ""}`} style={{ width: `${leaderboardBarWidth(row[side]?.[column], max)}%` }} /></span>}</>}</td>)}</Fragment>)}</tr>)}</tbody></table></div>}
      <p className={`${styles.foot} ${styles.comparisonLegend}`}>— means the source or agent value is unavailable. Agent names align across sources. Source totals may include activity outside the named rows.</p>
    </section>
  </>;
}
