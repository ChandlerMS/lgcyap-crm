"use client";
import { useEffect, useRef, useState } from "react";
import InboxConversation, { type InboxDraft } from "./inbox-conversation";
import SummaryChips, { type SummaryChip } from "./summary-chips";

type Tool = "inbox" | "help-desk" | "tickets";
type Result = { status?: string; records?: { id: string; title: string; subtitle?: string | null; status?: string | null; preview?: string | null }[]; partial?: boolean; error?: { message?: string } };
const TITLES = { inbox: "Inbox", "help-desk": "Help Desk", tickets: "Tickets" };
const NOTES = { inbox: "Recent HubSpot conversations", "help-desk": "HubSpot Support Pipeline", tickets: "Tickets across HubSpot pipelines" };

export default function SupportSummary({ tool, live, onUnauthorized }: { tool: Tool; live: boolean; onUnauthorized: () => void }) {
  const [state, setState] = useState<{ result?: Result; error?: string }>({});
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, InboxDraft>>({});
  const [attempt, setAttempt] = useState(0);
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => { unauthorized.current = onUnauthorized; }, [onUnauthorized]);
  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/hubspot-tools/${tool}`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tool === "inbox" ? { archive: "active" } : {}), signal: controller.signal });
        if (!active) return;
        if (response.status === 401) { unauthorized.current(); return; }
        const result = await response.json() as Result;
        if (!active) return;
        if (!response.ok || result.status !== "available" || !Array.isArray(result.records)) throw new Error(result.error?.message ?? `${TITLES[tool]} could not be loaded.`);
        setState({ result });
      } catch (error) {
        if (active) setState({ error: error instanceof Error && error.name !== "AbortError" ? error.message : `${TITLES[tool]} took too long to load.` });
      } finally { window.clearTimeout(timeout); }
    })();
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [tool, live, attempt]);
  const result = live ? state.result : undefined;
  const chips: SummaryChip[] = (result?.records ?? []).map(record => ({ id: record.id, name: record.title, href: tool === "inbox" ? `#inbox/thread/${record.id}` : `#${tool}`, badge: record.status ?? undefined, detail: record.preview ?? record.subtitle ?? record.status ?? TITLES[tool], ...(tool === "inbox" ? { previewOnSelect: () => setSelectedThread(record.id), previewAction: <button type="button" className="text-link" onClick={() => setSelectedThread(record.id)}>Open<span className="sr-only"> conversation {record.id}</span></button> } : {}) }));
  const empty = !live ? `Switch to live data to see ${TITLES[tool]}.` : state.error ? <>{state.error} <button className="text-link" onClick={() => { setState({}); setAttempt(value => value + 1); }}>Try again</button></> : !result ? `Loading ${TITLES[tool]} from HubSpot…` : `No ${tool === "inbox" ? "active conversations" : "tickets"} found.`;
  return <SummaryChips id={`${tool}-summary`} title={TITLES[tool]} href={`#${tool}`} note={NOTES[tool]} chips={chips} count={result ? `${chips.length}${result.partial ? "+" : ""}` : undefined} empty={empty} more={{ label: TITLES[tool] }} previewWidth={tool === "inbox" ? 640 : undefined} previewPersist={tool === "inbox"} previewTall={live && tool === "inbox" && Boolean(selectedThread)} previewOpenLink={tool !== "inbox"} onPreviewClose={() => setSelectedThread(null)} previewBody={live && tool === "inbox" && selectedThread ? <InboxConversation key={selectedThread} threadId={selectedThread} draft={drafts[selectedThread] ?? { text: "" }} onDraftChange={draft => setDrafts(current => ({ ...current, [selectedThread]: draft }))} onBack={() => setSelectedThread(null)} onUnauthorized={onUnauthorized} onSent={() => setAttempt(value => value + 1)} /> : undefined} />;
}
