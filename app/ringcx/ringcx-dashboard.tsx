'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useTvPage } from '../queue/use-tv-page';
import { queueTvPage } from '../queue/tv-model.mjs';
import styles from './ringcx.module.css';

type Agent = {id: string; name: string; status: string; todayCalls: number | null; todaySales: number | null; stateSeconds: number | null};
const duration = (seconds: number | null | undefined) => { if (seconds == null) return "—"; const total = Math.max(0, Math.floor(seconds)); return `${Math.floor(total / 3600).toString().padStart(2,"0")}:${Math.floor(total / 60 % 60).toString().padStart(2,"0")}:${(total % 60).toString().padStart(2,"0")}`; };
type Snapshot = { observedAt: string; agents: { available: number; onCalls: number; loggedIn: number; other: number }; availableAgents: Agent[]; onCallAgents: Agent[]; busyAgents: Agent[]; dailyPerformance: {sales: number | null; closeRate: number | null}; averageWaitSeconds: number | null; queues: number; calls: { connected: number | null; answered: number | null; activeConnected: number; status: string } };
const initials = (name: string) => { const parts = name.split(/\s+/).filter(Boolean); return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase(); };
export default function RingCxDashboard({ grouped = false, tv = false }: { grouped?: boolean; tv?: boolean }) {
  const turn = useTvPage(tv);
  const Container = grouped ? "div" : "main";
  const Heading = grouped ? "h2" : "h1";
  const Subheading = grouped ? "h3" : "h2";
  const [signInRequired, setSignInRequired] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [now, setNow] = useState(0);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true);
    try {
      const response = await fetch('/api/ringcx', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) { if (response.status === 401) { setData(null); setSignInRequired(true); } throw new Error(response.status === 401 ? 'Sign in to the CRM to view this dashboard.' : 'RingCX could not refresh. Last received data is shown below.'); }
      const result = await response.json();
      if (!result?.agents || !Array.isArray(result.busyAgents) || !Array.isArray(result.availableAgents) || !Number.isFinite(Date.parse(result.observedAt))) throw new Error('RingCX returned an incomplete update.');
      setData(result); setError(''); setSignInRequired(false); setNow(Date.now());
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'RingCX could not refresh.');
    } finally { if (!controller.signal.aborted) setBusy(false); active.current = null; }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => { setNow(Date.now()); if (!document.hidden) void refresh(); }, 15000);
    const resume = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', resume);
    return () => { clearTimeout(initial); clearInterval(timer); document.removeEventListener('visibilitychange', resume); active.current?.abort(); };
  }, [refresh]);
  const stale = !!data && (now - Date.parse(data.observedAt) > 45000 || !!error);
  const value = (number: number | null | undefined) => number == null ? '—' : number.toLocaleString('en-US');
  const availablePage = queueTvPage(data?.availableAgents ?? [], tv ? turn : 0, tv ? 6 : Math.max(1, data?.availableAgents.length ?? 1));
  const busyPage = queueTvPage(data?.busyAgents ?? [], tv ? turn : 0, tv ? 6 : Math.max(1, data?.busyAgents.length ?? 1));
  return <Container className={`${styles.board}${grouped ? ` ${styles.grouped}` : ""}`}>
    <header className={styles.header}><div className={styles.identity}>{!grouped && <Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners" width={164} height={107} priority className={styles.logo}/>}<div>{!grouped && <p className={styles.brand}>Legacy Agency Partners</p>}<Heading>Standard vs Preferred</Heading><p className={styles.subtitle}>RingCX · Live agent dashboard</p></div></div><div className={styles.controls}>{grouped && !tv && <a className={styles.tvLink} href="https://queue.lgcyap.com/standard" target="_blank" rel="noopener noreferrer" aria-label="Standard vs Preferred Queue TV HUD (opens in a new tab)">TV HUD</a>}<span className={`${styles.status} ${stale || error ? styles.warning : ''}`} role="status">{error || stale ? 'Update unavailable' : data ? 'Live' : 'Connecting'}</span><button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh'}</button></div></header>
    {error && <p role="alert" className={styles.alert}>{error}{signInRequired && <> <a href={tv ? "/sign-in?return_to=%2Fstandard" : "/sign-in?return_to=%2Fqueue"} target="_top">Sign in</a></>}</p>}
    <section aria-label="Live agent availability" className={styles.live}>
      <article><Subheading>Agents Available</Subheading><p className={styles.available}>{value(data?.agents.available)}</p><span>Ready to take a call</span></article>
      <article><Subheading>On calls</Subheading><p className={styles.onCalls}>{value(data?.agents.onCalls)}</p><span>Agents in an active call state</span></article>
      <article><Subheading>Average wait</Subheading><p className={styles.waitValue}>{duration(data?.averageWaitSeconds)}</p><span>Before answer · today’s inbound calls</span></article>
      <article><Subheading>Total Calls</Subheading><p className={styles.onCalls}>{value(data?.calls.answered)}</p><span>Answered today · Eastern</span></article>
    </section>
    <div className={styles.rosterGrid}>
    <section className={styles.roster} aria-labelledby="available-title"><div className={styles.rosterHead}><div><Subheading id="available-title">Agents Available</Subheading><p>{stale ? 'Last received roster · updates unavailable' : 'Ready to take a call · Standard vs Preferred'}{tv && availablePage.pages > 1 && ` · Page ${availablePage.page} of ${availablePage.pages}`}</p></div><span className={styles.rosterCount}>{value(data?.availableAgents.length)}</span></div>
      {/* The time in state sits on the right in gold, like the Shopper board's timers. */}
      <ol className={styles.agentList}>{(availablePage.rows as Agent[]).map(agent => <li className={`${styles.agentRow} ${styles.timedRow}`} key={agent.id}><span className={styles.avatar} aria-hidden="true">{initials(agent.name)}</span><span className={styles.agentName}>{agent.name}<span className={styles.agentMetrics}>{value(agent.todayCalls)} calls today · {value(agent.todaySales)} Sold today</span></span><span className={styles.callStatus}>{agent.status}</span><span className={styles.stateTime}>{duration(agent.stateSeconds)}<span className="sr-only"> in {agent.status.toLowerCase()} state</span></span></li>)}</ol>
      {!data && <p className={styles.empty}>{error ? 'Agent list unavailable.' : 'Connecting to RingCX…'}</p>}
      {data && !data.availableAgents.length && <p className={styles.empty}>{stale ? 'No agents were available at the last update.' : 'No agents are currently available.'}</p>}
    </section>
    <section className={styles.roster} aria-labelledby="on-call-title"><div className={styles.rosterHead}><div><Subheading id="on-call-title">On Live Calls or Busy</Subheading><p>{stale ? 'Last received roster · updates unavailable' : 'All logged-in agents not in Available'}{tv && busyPage.pages > 1 && ` · Page ${busyPage.page} of ${busyPage.pages}`}</p></div><span className={styles.rosterCount}>{value(data?.busyAgents.length)}</span></div>
      <ol className={styles.agentList}>{(busyPage.rows as Agent[]).map(agent => <li className={styles.agentRow} key={agent.id}><span className={styles.avatar} aria-hidden="true">{initials(agent.name)}</span><span className={styles.agentName}>{agent.name}<span className={styles.agentMetrics}>{value(agent.todayCalls)} calls today · {value(agent.todaySales)} Sold today · {duration(agent.stateSeconds)} in {agent.status === "On call" || agent.status === "On hold" ? "active" : agent.status.toLowerCase()} state</span></span><span className={styles.callStatus}>{agent.status}</span></li>)}</ol>
      {!data && <p className={styles.empty}>{error ? 'Agent list unavailable.' : 'Connecting to RingCX…'}</p>}
      {data && !data.busyAgents.length && <p className={styles.empty}>{stale ? 'No busy agents at the last update.' : 'No agents are currently busy.'}</p>}
    </section>
    </div>
  </Container>;
}
