"use client";
import { useEffect, useRef, useState } from "react";
type Context = { threadId: string; status: "OPEN" | "CLOSED"; archived: boolean; contextToken: string };
export default function InboxThreadControls({ threadId, refreshKey, disabled, onUnauthorized, onUpdated, onBusyChange }: { threadId: string; refreshKey: number; disabled: boolean; onUnauthorized: () => void; onUpdated: () => void; onBusyChange: (busy: boolean) => void }) {
  const [context, setContext] = useState<Context | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => { unauthorized.current = onUnauthorized; }, [onUnauthorized]);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/inbox-thread", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", threadId }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
        if (!active) return;
        if (response.status === 401) { unauthorized.current(); return; }
        const result = await response.json();
        if (!active) return;
        if (!response.ok || result.threadId !== threadId || !result.contextToken || !["OPEN", "CLOSED"].includes(result.status) || typeof result.archived !== "boolean") throw Error(result.error?.message ?? "Conversation controls could not be loaded.");
        setContext(result); setError("");
      } catch (failure) { if (active) { setContext(null); setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "Conversation controls took too long to load."); } }
    })();
    return () => { active = false; controller.abort(); };
  }, [threadId, refreshKey, attempt]);
  useEffect(() => {
    const refresh = () => { if (!disabled && !lock.current && document.visibilityState !== "hidden") setAttempt(value => value + 1); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [disabled]);
  const update = async () => {
    if (!context || lock.current || disabled) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/inbox-thread", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(60000), body: JSON.stringify({ action: "update", threadId, requestId: crypto.randomUUID(), contextToken: context.contextToken, operation: context.archived ? "restore" : context.status === "OPEN" ? "close" : "reopen" }) });
      if (response.status === 401) { unauthorized.current(); return; }
      const result = await response.json();
      if (!response.ok || result.status !== "saved") throw Error(result.error?.message ?? "Refresh the conversation to confirm whether the update completed.");
      setNotice("Conversation updated in HubSpot."); setContext(null); setAttempt(value => value + 1); onUpdated();
    } catch (failure) { setContext(null); setError(failure instanceof Error ? failure.message : "Refresh the conversation to confirm whether the update completed."); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  };
  return <div className="inbox-thread-controls">
    <div><strong>Status:</strong> {context ? context.archived ? "Archived" : context.status === "OPEN" ? "Open" : "Closed" : "Unavailable"}</div>
    <div className="inbox-thread-actions"><button type="button" className="btn btn-secondary" disabled={busy || disabled || !context} onClick={() => void update()}>{busy ? "Saving…" : context?.archived ? "Restore conversation" : context?.status === "CLOSED" ? "Reopen conversation" : "Close conversation"}</button><button type="button" className="text-link" disabled={busy || disabled} onClick={() => setAttempt(value => value + 1)}>Refresh status</button></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </div>;
}
