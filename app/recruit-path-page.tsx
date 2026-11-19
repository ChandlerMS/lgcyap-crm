"use client";
import DismissibleNotice from './dismissible-notice';

import { useCallback, useEffect, useRef, useState } from "react";
import RecruitsPanel from "./recruits-panel";
import type { PipelineRecruit } from "./recruit-pipeline";

type Result = { recruits: PipelineRecruit[]; total: number; partial: boolean; continuation?: string | null; capabilities?: { canEdit?: boolean }; error?: { message?: string }; retryAfterSeconds?: number };
export default function RecruitPathPage({ view, label, demoRecords, onUnauthorized }: { view: string; label: string; demoRecords?: readonly PipelineRecruit[]; onUnauthorized: () => void }) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const retryRef = useRef(0);
  const failedAfterRef = useRef<string | undefined>(undefined);
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { unauthorizedRef.current = onUnauthorized; }, [onUnauthorized]);
  const load = useCallback(async (after?: string) => {
    if (requestRef.current) return;
    if (retryRef.current > Date.now()) { setError("HubSpot is limiting requests. Wait a moment before trying again."); return; }
    const controller = new AbortController(); requestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 60_000);
    failedAfterRef.current = after;
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ path: view, ...(after ? { after } : {}) });
      const response = await fetch(`/api/recruits?${query}`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal });
      const data = await response.json() as Result;
      if (response.status === 401) { setResult(null); unauthorizedRef.current(); return; }
      if (!response.ok) {
        if (response.status === 429) retryRef.current = Date.now() + Math.max(1000, Math.min(86400, Number(data.retryAfterSeconds) || 10) * 1000);
        throw new Error(data.error?.message || "Recruits could not be loaded. Try again.");
      }
      if (!Array.isArray(data.recruits) || !Number.isSafeInteger(data.total) || data.continuation && (!/^[1-9]\d{0,19}$/.test(data.continuation) || after && BigInt(data.continuation) <= BigInt(after))) throw new Error("HubSpot returned an unexpected page. Try Refresh.");
      setResult(previous => {
        if (!after || !previous) return data;
        const rows = new Map(previous.recruits.map(row => [row.id, row]));
        for (const row of data.recruits) rows.set(row.id, row);
        return { ...data, recruits: [...rows.values()], total: Math.max(previous.total, rows.size + Math.max(0, data.total - data.recruits.length)) };
      });
    } catch (failure) {
      if (requestRef.current === controller) setError(controller.signal.aborted ? "HubSpot took too long. Try again." : failure instanceof Error ? failure.message : "Recruits could not be loaded.");
    } finally {
      window.clearTimeout(timer);
      if (requestRef.current === controller) { requestRef.current = null; setBusy(false); }
    }
  }, [view]);
  useEffect(() => {
    const timer = window.setTimeout(() => { if (!demoRecords) void load(); }, 0);
    return () => { window.clearTimeout(timer); const request = requestRef.current; requestRef.current = null; request?.abort(); };
  }, [load, demoRecords]);
  const rows = demoRecords ?? result?.recruits ?? [];
  return <>
    <div className="page-heading"><h1 className="page-title" id="page-title" tabIndex={-1}>{label}</h1>{!demoRecords && <button className="btn btn-secondary" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Refresh"}</button>}</div>
    <p className="helper">All stages in the {label} recruiting path.</p>
    {error && <DismissibleNotice role="alert" className="connection-alert">{error} <button className="text-link" disabled={busy} onClick={() => void load(failedAfterRef.current)}>Retry</button></DismissibleNotice>}
    {busy && !result && !demoRecords ? <p role="status">Loading {label.toLowerCase()} recruits…</p> : <>
      {!demoRecords && result?.partial && <p role="status">Showing {rows.length} of {result.total} recruits. {result.continuation ? "Load more to include the remaining records." : "HubSpot returned an incomplete result. Use Refresh to try again."}</p>}
      <RecruitsPanel nativeLinks={!demoRecords} records={rows} partial={!demoRecords && result?.partial} canAddActivity={!demoRecords && result?.capabilities?.canEdit === true} />
      {!demoRecords && result?.continuation && <button className="btn btn-secondary" disabled={busy} onClick={() => void load(result.continuation!)}>{busy ? "Loading…" : "Load more recruits"}</button>}
    </>}
  </>;
}
