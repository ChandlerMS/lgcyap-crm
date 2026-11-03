"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";

type Call = { id: string; name: string; direction: "inbound" | "outbound" | null; source: string | null; since: number };
type Agent = { id: string; name: string; since: number | null; idle: boolean; dim?: boolean };
type Board = { ok: true; now: number; calls: Call[]; available: Agent[] };
type Problem = "not_configured" | "policytek_sign_in" | "policytek_down" | "denied" | "server" | "network";

const POLL_MS = 5000; // how often this screen asks for the queue
const STALE_MS = 20000; // older than this, the header says so
const RELOAD_MS = 6 * 3600e3; // a wall screen reloads now and then to pick up a new deployment

const NOTICES: Record<Problem, string> = {
  not_configured: "PolicyTek isn’t connected yet: POLICYTEK_REFRESH_TOKEN and POLICYTEK_WORKSPACE_ID are not set on this deployment.",
  policytek_sign_in: "PolicyTek turned down the queue’s sign-in. Its refresh token needs replacing.",
  policytek_down: "Can’t reach PolicyTek right now. Showing the last queue and retrying.",
  denied: "This account doesn’t have access to the queue.",
  server: "The queue hit an error. Retrying.",
  network: "This screen can’t reach the app. Retrying.",
};

const initials = (name: string) => { const words = name.split(/\s+/).filter(Boolean); return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase(); };
const two = (n: number) => String(n).padStart(2, "0");

// A call's length as a stopwatch (4:07, 1:02:13); a wait in minutes (just now, 12m, 1h 05m).
function stopwatch(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
function waited(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${two(m % 60)}m`;
}

function Column({ kind, title, count, empty, children }: { kind: "calls" | "available"; title: string; count: number | null; empty: string | null; children: ReactNode }) {
  return <section className={`queue-col is-${kind}`} aria-labelledby={`queue-${kind}-title`}><div className="queue-col-head"><h2 id={`queue-${kind}-title`}>{title}</h2><span className="queue-count" aria-label={title}>{count ?? "–"}</span></div><ol className="queue-list">{children}</ol>{empty && <p className="queue-empty">{empty}</p>}</section>;
}

function Row({ kind, name, meta, timer, dim }: { kind: "call" | "ready"; name: string; meta: string; timer: string; dim?: boolean }) {
  return <li className={`queue-row is-${kind}${dim ? " is-dim" : ""}`}><span className="queue-avatar" aria-hidden="true">{initials(name)}</span><span className="queue-who"><span className="queue-name">{name}</span><span className="queue-meta">{meta}</span></span><span className="queue-timer">{timer}</span></li>;
}

export default function QueueBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [tick, setTick] = useState<number | null>(null); // this screen's clock, once a second
  const [offset, setOffset] = useState(0); // the server's clock minus this screen's, so timers agree across screens

  useEffect(() => {
    let stopped = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await fetch("/api/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) { window.location.assign(typeof body.signInPath === "string" ? body.signInPath : "/sign-in?return_to=%2Fqueue"); return; }
        if (typeof body.served === "number") setOffset(body.served - Date.now());
        if (response.status === 403) setProblem("denied");
        else if (body.ok === true) { setBoard(body); setProblem(null); }
        else setProblem(body.error in NOTICES ? body.error : "server");
      } catch {
        setProblem("network");
      }
      setTick(Date.now());
      if (!stopped) next = setTimeout(poll, POLL_MS);
    }
    void poll();
    const clock = setInterval(() => setTick(Date.now()), 1000);
    const reload = setTimeout(() => window.location.reload(), RELOAD_MS);
    return () => { stopped = true; clearTimeout(next); clearInterval(clock); clearTimeout(reload); };
  }, []);

  // Keep a wall screen from sleeping while the queue is showing.
  useEffect(() => {
    let wake: WakeLockSentinel | null = null;
    const keepAwake = async () => { try { wake = await navigator.wakeLock.request("screen"); } catch { /* not allowed here; the screen may sleep */ } };
    const onVisible = () => { if (document.visibilityState === "visible" && (!wake || wake.released)) void keepAwake(); };
    void keepAwake();
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); void wake?.release().catch(() => {}); };
  }, []);

  const now = tick === null ? null : tick + offset;
  const age = board && now !== null ? now - board.now : 0;
  const state = !board ? "connecting" : age > STALE_MS ? "stale" : "live";
  const stateText = state === "live" ? "Live" : state === "stale" ? `Last update ${age < 60000 ? `${Math.floor(age / 1000)}s` : waited(age)} ago` : "Connecting…";
  const notice = problem && !(problem === "policytek_down" && !board) ? NOTICES[problem] : null;
  const empty = (rows: unknown[] | undefined, none: string) => board ? (rows?.length ? null : none) : problem === "policytek_down" ? NOTICES.policytek_down : "Connecting to PolicyTek…";

  return <div className="queue-page">
    <header className="queue-top">
      <Image unoptimized className="queue-logo" src="/legacy-logo.png" alt="Legacy Agency Partners" width="164" height="107" priority />
      <div className="queue-title"><h1>Queue</h1><p>Legacy Agency Partners</p></div>
      <div className="queue-top-right">
        <span className="queue-state" data-state={state} role="status"><span className="queue-pulse" aria-hidden="true" />{stateText}</span>
        <time className="queue-clock">{tick === null ? "" : new Date(tick).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
        <a className="queue-icon-btn" href="/" aria-label="Back to the recruiting workspace" title="Recruiting workspace"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1z" /></svg></a>
        <button className="queue-icon-btn" type="button" aria-label="Full screen" title="Full screen" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg></button>
      </div>
    </header>

    {notice && <p className="queue-notice" role="alert">{notice}</p>}

    <main className="queue-board">
      <Column kind="calls" title="On Live Calls" count={board ? board.calls.length : null} empty={empty(board?.calls, "No one is on a live call.")}>
        {board?.calls.map(call => <Row key={call.id} kind="call" name={call.name}
          meta={[call.direction === "inbound" ? "Inbound" : call.direction === "outbound" ? "Outbound" : "Call", call.source].filter(Boolean).join(" · ")}
          timer={now === null ? "" : stopwatch(now - call.since)} />)}
      </Column>
      <Column kind="available" title="Available" count={board ? board.available.length : null} empty={empty(board?.available, "No one is available.")}>
        {board?.available.map(agent => <Row key={agent.id} kind="ready" name={agent.name} dim={agent.dim}
          meta={agent.idle ? "Available · idle" : "Available"}
          timer={now === null || agent.since === null ? "" : waited(now - agent.since)} />)}
      </Column>
    </main>

    <p className="queue-foot">Live from PolicyTek, updated every 5 seconds. Longest call and longest wait first. On DND and Offline are not shown.</p>
  </div>;
}
