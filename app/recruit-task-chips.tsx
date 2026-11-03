"use client";
import { useEffect, useRef, useState } from "react";
import { hubspotHref, openTaskChips } from "./recruit-task-chips.mjs";
import SummaryChips, { type SummaryChip } from "./summary-chips";

type TasksResult = { status?: string; records?: { id: string; title: string; status?: string | null; scheduledAt?: string | null; hubspotUrl?: string }[]; partial?: boolean; hubspotUrl?: string; error?: { message?: string } };
type State = { status: "loading" } | { status: "ready"; result: TasksResult } | { status: "failed"; message: string };
const FAILED = "Tasks could not be loaded from HubSpot.";
// Open HubSpot tasks beside Follow Up, soonest due first; a chip opens that task in HubSpot and "+N more" opens HubSpot's task list.
export default function RecruitTaskChips({ live, now, onUnauthorized }: { live: boolean; now: number; onUnauthorized: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { unauthorizedRef.current = onUnauthorized; }, [onUnauthorized]);
  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
    void (async () => {
      try {
        const response = await fetch("/api/hubspot-tools/tasks", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal });
        if (response.status === 401) { unauthorizedRef.current(); return; }
        const result = await response.json() as TasksResult;
        setState(response.ok && result.status === "available" && Array.isArray(result.records) ? { status: "ready", result } : { status: "failed", message: result.error?.message ?? FAILED });
      } catch {
        if (timedOut || !controller.signal.aborted) setState({ status: "failed", message: timedOut ? "HubSpot took too long to return tasks." : FAILED });
      } finally { window.clearTimeout(timer); }
    })();
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [live, attempt]);

  const ready = live && state.status === "ready" ? state.result : null;
  const chips: SummaryChip[] = ready ? openTaskChips(ready.records ?? [], now) : [];
  const empty = !live ? "Switch to live data to see HubSpot tasks."
    : state.status === "loading" ? "Loading tasks from HubSpot…"
    : state.status === "failed" ? <>{state.message} <button className="text-link" onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}>Try again</button></>
    : "No open tasks.";
  return <SummaryChips id="task-chips-title" className="task-chips" title="Tasks" count={ready ? `${chips.length}${ready.partial ? "+" : ""}` : undefined} note="Open, soonest due" chips={chips}
    empty={empty} more={{ href: hubspotHref(ready?.hubspotUrl), external: true, label: "open tasks in HubSpot" }} />;
}
