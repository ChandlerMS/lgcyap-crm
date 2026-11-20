"use client";
import DismissibleNotice from './dismissible-notice';

import { startTransition, useEffect, useRef, useState } from "react";
import styles from "./svp-dispositions.module.css";

type Duration = "interaction" | "talk" | "handle" | "wrap" | "hold";
type Filters = { from: string; to: string; query: string; agent: string; state: string; disposition: string; result: string; number: string; notes: string; recording: string; summary: string; startTime: string; sort: string; direction: string; duration: Record<Duration, { min: string; max: string }> };
type Result = { source: string; importedAt: string; appliedFilters: string[]; columns: string[]; total: number; snapshotTotal: number; from: string; to: string; page: number; pages: number; pageSize: number; facets: Record<"agent" | "state" | "disposition" | "result", string[]>; dispositions: { name: string; count: number }[]; agents: number; averageInteraction: number | null; rows: string[][] };
const DURATIONS: [Duration, string][] = [["interaction", "Interaction Time"], ["talk", "KPI Talk Time"], ["handle", "KPI Handle Time"], ["wrap", "KPI Wrap Time"], ["hold", "Hold Time"]];
const ATTRIBUTES = [["agent", "Agent"], ["state", "State"], ["disposition", "Disposition"], ["result", "Call Result"]] as const;
const TEXT = [["number", "Number"], ["notes", "Disposition Notes"], ["recording", "Call Recording URL"], ["summary", "Auto Summary URL"], ["startTime", "Start Time (Eastern)"]] as const;
const DEFAULTS: Filters = { from: "", to: "", query: "", agent: "", state: "", disposition: "", result: "", number: "", notes: "", recording: "", summary: "", startTime: "", sort: "date", direction: "desc", duration: { interaction: { min: "", max: "" }, talk: { min: "", max: "" }, handle: { min: "", max: "" }, wrap: { min: "", max: "" }, hold: { min: "", max: "" } } };
const NUMBER = new Intl.NumberFormat("en-US");
function payload(filters: Filters, page: number) {
  return { ...filters, page, duration: Object.fromEntries(DURATIONS.map(([key]) => [key, Object.fromEntries(Object.entries(filters.duration[key]).filter(([, value]) => value !== "").map(([key, value]) => [key, Number(value)]))])) };
}
function safeUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export default function SvpDispositions({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [draft, setDraft] = useState<Filters>(DEFAULTS);
  const [request, setRequest] = useState({ filters: DEFAULTS, page: 1, refresh: 0 });
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const unauthorized = useRef(onUnauthorized);
  const [facets, setFacets] = useState<Result["facets"] | null>(null);
  useEffect(() => { unauthorized.current = onUnauthorized; }, [onUnauthorized]);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 65000);
    startTransition(() => { setLoading(true); setError(""); setData(null); });
    void (async () => {
      try {
        const response = await fetch("/api/svp-dispositions", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(request.filters, request.page)), signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) { unauthorized.current(); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Call dispositions could not be loaded.");
        if (controller.signal.aborted) return;
        setFacets(result.facets);
        setData(result as Result);
      } catch (error) { if (!disposed) setError(controller.signal.aborted ? "Loading timed out. Try Reload snapshot." : error instanceof Error ? error.message : "Call dispositions could not be loaded."); }
      finally { window.clearTimeout(timeout); if (!disposed) setLoading(false); }
    })();
    return () => { disposed = true; controller.abort(); window.clearTimeout(timeout); };
  }, [request]);
  const change = (key: keyof Filters, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const reset = () => { setDraft(DEFAULTS); setRequest(current => ({ filters: DEFAULTS, page: 1, refresh: current.refresh + 1 })); };
  const download = async () => {
    setExporting(true); setError("");
    try {
      const response = await fetch("/api/svp-dispositions", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload(request.filters, 1), export: true }) });
      if (response.status === 401) { unauthorized.current(); return; }
      if (!response.ok) throw new Error("Export could not be created. Please try again.");
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url; link.download = "standard-vs-preferred-dispositions.csv"; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(error instanceof Error ? error.message : "Export could not be created."); }
    finally { setExporting(false); }
  };
  return <section className={styles.page} aria-labelledby="page-title">
    <header className="sales-heading"><h1 className="page-title" id="page-title" tabIndex={-1}>Standard vs Preferred Dispositions</h1><a className="btn btn-secondary" href="https://ringcx.ringcentral.com/analytics/voice/historical/reports/aadxn5qBRud2" target="_blank" rel="noopener noreferrer">Open RingCX report<span className="sr-only"> (opens in a new tab)</span></a></header>
    <DismissibleNotice className={styles.notice}>Uploaded call-history snapshot · Final = Yes · Times are US/Eastern. This view does not update automatically from RingCX.{data && <> {NUMBER.format(data.snapshotTotal)} rows · {data.from} through {data.to}.</>}</DismissibleNotice>
    <form className={styles.filters} onSubmit={event => { event.preventDefault(); setRequest(current => ({ filters: draft, page: 1, refresh: current.refresh + 1 })); }}>
      <div className={styles.grid}>
        <label>From date<input type="date" value={draft.from} max={draft.to || undefined} onChange={event => change("from", event.target.value)} /></label>
        <label>Through date<input type="date" value={draft.to} min={draft.from || undefined} onChange={event => change("to", event.target.value)} /></label>
        {ATTRIBUTES.map(([key, label]) => <label key={key}>{label}<select value={draft[key]} onChange={event => change(key, event.target.value)}><option value="">All</option>{(data?.facets ?? facets)?.[key]?.filter(Boolean).map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
        <label className={styles.search}>Search all columns<input type="search" value={draft.query} maxLength={500} placeholder="Number, notes, agent, disposition…" onChange={event => change("query", event.target.value)} /></label>
      </div>
      <details><summary>More filters and sorting</summary><div className={styles.grid}>
        {TEXT.map(([key, label]) => <label key={key}>{label} contains<input value={draft[key]} maxLength={500} onChange={event => change(key, event.target.value)} /></label>)}
        {DURATIONS.map(([key, label]) => <fieldset key={key}><legend>{label} (seconds)</legend>{(["min", "max"] as const).map(bound => <label key={bound}>{bound === "min" ? "Minimum" : "Maximum"}<input type="number" min="0" step="any" value={draft.duration[key][bound]} onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, duration: { ...current.duration, [key]: { ...current.duration[key], [bound]: value } } })); }} /></label>)}</fieldset>)}
        <label>Sort by<select value={draft.sort} onChange={event => change("sort", event.target.value)}><option value="date">Date and Start Time</option>{[...ATTRIBUTES, ...TEXT, ...DURATIONS].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Sort order<select value={draft.direction} onChange={event => change("direction", event.target.value)}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
      </div></details>
      <div className={styles.actions}><button className="btn btn-primary" type="submit" disabled={loading}>Apply filters</button><button className="btn btn-secondary" type="button" onClick={reset}>Reset</button><button className="btn btn-secondary" type="button" disabled={loading} onClick={() => setRequest(current => ({ ...current, refresh: current.refresh + 1 }))}>Reload snapshot</button><button className="btn btn-secondary" type="button" disabled={loading || exporting || !data?.total} onClick={() => void download()}>{exporting ? "Exporting…" : "Export filtered CSV"}</button></div>
    </form>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div aria-busy={loading}>
      {loading ? <p role="status">Loading call history…</p> : data && <>
        <dl className={styles.metrics}><div><dt>Matching calls</dt><dd>{NUMBER.format(data.total)}</dd></div><div><dt>Agents</dt><dd>{NUMBER.format(data.agents)}</dd></div><div><dt>Dispositions</dt><dd>{data.dispositions.length}</dd></div><div><dt>Average interaction</dt><dd>{data.averageInteraction === null ? "—" : `${data.averageInteraction.toFixed(1)}s`}</dd></div></dl>
        <details className={styles.breakdown}><summary>Disposition breakdown ({data.dispositions.length})</summary><ul>{data.dispositions.map(item => <li key={item.name}><span>{item.name}</span><strong>{NUMBER.format(item.count)}</strong></li>)}</ul></details>
        <DismissibleNotice className={styles.notice} role="status">{data.total ? `Showing ${NUMBER.format((data.page - 1) * data.pageSize + 1)}–${NUMBER.format(Math.min(data.page * data.pageSize, data.total))} of ${NUMBER.format(data.total)} matching calls` : "No calls match these filters."}</DismissibleNotice>
        <div className={styles.table} role="region" aria-label="Call history results" tabIndex={0}><table><thead><tr>{data.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{data.rows.map((row, index) => <tr key={`${data.page}-${index}`}>{row.map((value, column) => <td key={column}>{[6, 7].includes(column) && safeUrl(value) ? <a href={safeUrl(value)!} target="_blank" rel="noopener noreferrer">{column === 6 ? "Recording" : "Summary"}<span className="sr-only"> (opens in a new tab)</span></a> : value || "—"}</td>)}</tr>)}</tbody></table></div>
        <nav className={styles.pagination} aria-label="Call history pages"><button className="btn btn-secondary" type="button" disabled={data.page <= 1} onClick={() => setRequest(current => ({ ...current, page: data.page - 1 }))}>Previous</button><span>Page {NUMBER.format(data.page)} of {NUMBER.format(data.pages)}</span><button className="btn btn-secondary" type="button" disabled={data.page >= data.pages} onClick={() => setRequest(current => ({ ...current, page: data.page + 1 }))}>Next</button></nav>
      </>}
    </div>
  </section>;
}
