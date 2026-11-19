"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { demoSearchGroups, mergeSearchGroups, normalizeSearchGroups, workspaceSearchStatus } from "./workspace-search-view.mjs";
import styles from "./workspace-titlebar.module.css";

type RecordResult = { id: string; title: string; subtitle: string | null; href: string };
type Group = { id: string; label: string; status: string; partial: boolean; continuation: string | null; notice: string | null; records: RecordResult[] };
type DemoRecruit = { id: string; name: string; email?: string | null; phone?: string | null; office?: string };
type Props = { demo: boolean; demoRecords: DemoRecruit[]; disabled: boolean; onUnauthorized: () => void; onNavigate: () => void };

export default function WorkspaceSearch({ demo, demoRecords, disabled, onUnauthorized, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const [completedKey, setCompletedKey] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState("");
  const cooldown = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const continuationRequest = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const callbacks = useRef({ onUnauthorized, onNavigate });
  const uid = useId();
  const normalized = query.trim();
  useEffect(() => { callbacks.current = { onUnauthorized, onNavigate }; }, [onUnauthorized, onNavigate]);

  useEffect(() => {
    const version = ++sequence.current;
    request.current?.abort(); continuationRequest.current?.abort();
    setCompletedKey(""); setGroups([]); setActive(-1); setError(""); setContinuing(false); setBusy(false);
    if (disabled || normalized.length < 2 || normalized.length > 200) return;
    if (demo) { setGroups(demoSearchGroups(demoRecords, normalized) as Group[]); setCompletedKey(`${demo}:${normalized}`); return; }
    const controller = new AbortController(); request.current = controller;
    const timer = window.setTimeout(async () => {
      if (cooldown.current > Date.now()) { setError("HubSpot is limiting requests. Please wait before searching again."); return; }
      setBusy(true);
      try {
        const response = await fetch("/api/workspace-search", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: normalized }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]) });
        if (controller.signal.aborted || sequence.current !== version) return;
        if (response.status === 401) { callbacks.current.onUnauthorized(); throw new Error("Sign in again to search the workspace."); }
        const result = await response.json();
        if (controller.signal.aborted || sequence.current !== version) return;
        if (response.status === 429 || response.headers.has("Retry-After")) {
          const retry = Number(response.headers.get("Retry-After") ?? result.retryAfterSeconds ?? 30);
          cooldown.current = Date.now() + Math.max(1, Math.min(86400, Number.isFinite(retry) ? retry : 30)) * 1000;
        }
        if (!response.ok) throw new Error(result.error?.message ?? "Workspace search is unavailable. Try again.");
        if (result.query !== normalized) throw new Error("Search returned a different query. Please try again.");
        setGroups(normalizeSearchGroups(result.groups) as Group[]);
        setCompletedKey(`${demo}:${normalized}`);
      } catch (failure) {
        if (!controller.signal.aborted && sequence.current === version) setError(failure instanceof Error ? failure.message : "Workspace search is unavailable. Try again.");
      } finally { if (!controller.signal.aborted && sequence.current === version) setBusy(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [normalized, demo, demoRecords, disabled, attempt]);

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setActive(-1); } };
    document.addEventListener("pointerdown", close);
    return () => { document.removeEventListener("pointerdown", close); continuationRequest.current?.abort(); };
  }, []);

  const results = groups.flatMap(group => group.records);
  const selected = active >= 0 ? results[active] : null;
  const shown = open && !disabled && normalized.length >= 2;
  const navigate = () => { setOpen(false); setActive(-1); callbacks.current.onNavigate(); };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true);
      setActive(value => !results.length ? -1 : event.key === "ArrowDown" ? (value + 1) % results.length : (value < 0 ? results.length - 1 : (value - 1 + results.length) % results.length));
    }
    if (event.key === "Enter" && selected && shown) {
      event.preventDefault();
      const link = root.current?.querySelector<HTMLAnchorElement>(`[data-search-index="${active}"]`);
      link?.click();
    }
  };
  useEffect(() => { if (active >= 0) root.current?.querySelector(`[data-search-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  async function continueInbox(continuation: string) {
    if (continuing || demo || disabled) return;
    if (cooldown.current > Date.now()) { setError("HubSpot is limiting requests. Please wait before continuing the search."); return; }
    const version = sequence.current;
    continuationRequest.current?.abort();
    const controller = new AbortController(); continuationRequest.current = controller;
    setContinuing(true); setError("");
    try {
      const response = await fetch("/api/workspace-search", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: normalized, continuation }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]) });
      if (controller.signal.aborted || version !== sequence.current) return;
      if (response.status === 401) { callbacks.current.onUnauthorized(); throw new Error("Sign in again to continue searching."); }
      const result = await response.json();
      if (controller.signal.aborted || version !== sequence.current) return;
      if (response.status === 429 || response.headers.has("Retry-After")) {
        const retry = Number(response.headers.get("Retry-After") ?? 30);
        cooldown.current = Date.now() + Math.max(1, Math.min(86400, Number.isFinite(retry) ? retry : 30)) * 1000;
      }
      if (!response.ok || result.query !== normalized) throw new Error(result.error?.message ?? "The search could not continue. Please try again.");
      setGroups(previous => mergeSearchGroups(previous, normalizeSearchGroups(result.groups)) as Group[]);
    } catch (failure) {
      if (!controller.signal.aborted && version === sequence.current) setError(failure instanceof Error ? failure.message : "The search could not continue.");
    } finally { if (!controller.signal.aborted && version === sequence.current) setContinuing(false); }
  }

  let index = 0;
  return <div ref={root} className={styles.search}>
    <label className="sr-only" htmlFor={`${uid}-input`}>Search workspace</label>
    <input ref={input} id={`${uid}-input`} type="search" role="combobox" autoComplete="off" spellCheck={false} maxLength={200} disabled={disabled} placeholder="Search workspace" value={query} aria-expanded={shown} aria-controls={`${uid}-results`} aria-haspopup="listbox" aria-autocomplete="list" aria-activedescendant={selected && shown ? `${uid}-result-${active}` : undefined} onFocus={() => setOpen(true)} onKeyDown={keyDown} onChange={event => { setQuery(event.currentTarget.value); setOpen(true); setActive(-1); }} />
    {shown && <div className={styles.resultsPanel}>
      <p className={styles.searchSummary} role="status">{workspaceSearchStatus({ demo, busy, pending: completedKey !== `${demo}:${normalized}`, error, groups })}</p>
      {error && <div className={styles.searchError} role="alert"><p>{error}</p>{!busy && <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry search</button>}</div>}
      <div id={`${uid}-results`} role="listbox" aria-label="Workspace search results" className={styles.results}>
        {groups.map(group => <div key={group.id} role="group" aria-label={group.label}>
          <h2 className={styles.groupTitle}>{group.label}{group.partial && <span> · Partial results</span>}</h2>
          {group.records.map(record => {
            const current = index++;
            return <a key={record.id} id={`${uid}-result-${current}`} data-search-index={current} role="option" aria-selected={current === active} className={styles.result} href={record.href} {...(record.href.startsWith("https:") ? { target: "_blank", rel: "noopener noreferrer" } : {})} onClick={navigate}><strong>{record.title}</strong>{record.subtitle && <span>{record.subtitle}</span>}</a>;
          })}
          {!group.records.length && <p className={styles.empty}>{group.status === "unavailable" ? "This area could not be searched." : group.partial ? "No matches in the portion searched so far." : "No matching records."}</p>}
        </div>)}
      </div>
      <div className={styles.searchNotices}>
        {groups.filter(group => group.notice || group.continuation).map(group => <div key={group.id}>
          {group.notice && <p><strong>{group.label}:</strong> {group.notice}</p>}
          {group.continuation && <button type="button" disabled={continuing} onClick={() => void continueInbox(group.continuation!)}>{continuing ? "Searching more conversations…" : "Continue Inbox search"}</button>}
        </div>)}
      </div>
      <button type="button" className={styles.closeSearch} onClick={() => { input.current?.focus(); setOpen(false); }}>Close search</button>
    </div>}
  </div>;
}
