"use client";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { emptyInboxPages, walkInboxPages } from "./inbox-pagination.mjs";
export type Item = { id: string; title?: string; subtitle?: string; status?: string; archived?: boolean; updatedAt?: string; createdAt?: string; text?: string | null; direction?: string; type?: string; truncated?: boolean };
type Pages = { items: Item[]; continuation: string | null; complete: boolean; notice: string; fetchedAt?: string; pages: number };
type Input = { archive: string; threadId?: string };

export function useInboxPages(input: Input | null, onUnauthorized: () => void, endpoint = "/api/hubspot-tools/inbox", maxPages = 100) {
  const [state, setState] = useState<Pages>(emptyInboxPages);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const stateRef = useRef<Pages>(state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { unauthorizedRef.current = onUnauthorized; }, [onUnauthorized]);
  const archive = input?.archive, threadId = input?.threadId;
  const currentScope = archive ? `${endpoint}:${archive}:${threadId ?? 'threads'}` : null;
  const load = useCallback(async (reset = false, background = false) => {
    if (!archive || retryAt > Date.now()) return;
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    const seed = reset ? emptyInboxPages() : stateRef.current;
    const previous = stateRef.current;
    if (reset && !background) { stateRef.current = seed; setState(seed); setLoadedScope(`${endpoint}:${archive}:${threadId ?? 'threads'}`); }
    setBusy(true); setError(null);
    try {
      const final = await walkInboxPages({ initial: seed, maxPages, input: { archive, ...(threadId ? { threadId } : {}) }, signal: controller.signal,
        request: async (body: object, parent: AbortSignal) => {
          const pageController = new AbortController();
          const abort = () => pageController.abort(); parent.addEventListener("abort", abort, { once: true });
          const timeout = window.setTimeout(abort, 30_000);
          try {
            const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: pageController.signal });
            if (parent.aborted || requestRef.current !== controller) throw new DOMException('Request cancelled', 'AbortError');
            if (response.status === 401) { stateRef.current = emptyInboxPages(); setState(stateRef.current); unauthorizedRef.current(); throw Error("Sign in again to load Inbox."); }
            const result = await response.json();
            if (parent.aborted || requestRef.current !== controller) throw new DOMException('Request cancelled', 'AbortError');
            if (response.status === 429 || result.error?.code === "HUBSPOT_RATE_LIMITED") {
              const seconds = Number(result.retryAfterSeconds ?? response.headers.get("Retry-After"));
              setRetryAt(Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) : 60) * 1000);
            }
            if (!response.ok || result.status !== "available") throw Error(result.error?.message ?? "Inbox could not load the next page. Continue to try again.");
            return result;
          } finally { window.clearTimeout(timeout); parent.removeEventListener("abort", abort); }
        },
        onPage: (page: Pages) => { if (requestRef.current === controller) {
          const retained = background && !page.complete ? { ...page, items: [...new Map([...previous.items, ...page.items].map(item => [item.id, item])).values()], continuation: previous.pages > page.pages ? previous.continuation : page.continuation, pages: Math.max(previous.pages, page.pages) } : page;
          stateRef.current = retained; setState(retained);
        } },
      });
      if (requestRef.current === controller && !controller.signal.aborted && !final.complete && !final.continuation) setError("HubSpot could not provide the remaining pages. Loaded items are retained; refresh to restart.");
    } catch (failure) {
      if (requestRef.current === controller && !controller.signal.aborted) setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "Loading this page timed out. Continue to try again.");
    } finally { if (requestRef.current === controller) { requestRef.current = null; setBusy(false); } }
  }, [archive, threadId, retryAt, endpoint, maxPages]);
  // A new scope starts a new walk; it must never inherit another thread's cursor.
  useEffect(() => {
    requestRef.current?.abort(); requestRef.current = null;
    startTransition(() => { stateRef.current = emptyInboxPages(); setState(stateRef.current); setError(null); setBusy(false); if (archive) void load(true); });
    return () => { requestRef.current?.abort(); requestRef.current = null; };
    // Cooldown changes must not restart a completed or paused walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archive, threadId, endpoint]);
  useEffect(() => { if (!retryAt) return; const timer = window.setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now())); return () => window.clearTimeout(timer); }, [retryAt]);
  useEffect(() => {
    const refresh = () => { if (archive && document.visibilityState !== "hidden" && !requestRef.current && stateRef.current.complete) void load(true, true); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [archive, threadId, endpoint, load]);
  const pause = () => { requestRef.current?.abort(); requestRef.current = null; setBusy(false); };
  return { state: loadedScope === currentScope ? state : emptyInboxPages() as Pages, busy: loadedScope === currentScope && busy, error: loadedScope === currentScope ? error : null, retryAt, load, pause };
}

