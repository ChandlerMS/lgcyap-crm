'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import styles from './ringcx.module.css';

type Snapshot = { observedAt: string; agents: { available: number; onCalls: number; loggedIn: number; other: number }; availableAgents: {id: string; name: string; status: string}[]; onCallAgents: {id: string; name: string; status: string}[]; queues: number; calls: { connected: number | null; answered: number | null; activeConnected: number; status: string } };
const initials = (name: string) => { const parts = name.split(/\s+/).filter(Boolean); return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase(); };
export default function RingCxDashboard() {
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
      if (!response.ok) { if (response.status === 401) setData(null); throw new Error(response.status === 401 ? 'Sign in to the CRM to view this dashboard.' : 'RingCX could not refresh. Last received data is shown below.'); }
      const result = await response.json();
      if (!result?.agents || !Array.isArray(result.onCallAgents) || !Array.isArray(result.availableAgents) || !Number.isFinite(Date.parse(result.observedAt))) throw new Error('RingCX returned an incomplete update.');
      setData(result); setError(''); setNow(Date.now());
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
  return <main className={styles.board}>
    <header className={styles.header}><div className={styles.identity}><Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners" width={164} height={107} priority className={styles.logo}/><div><p className={styles.brand}>Legacy Agency Partners</p><h1>Standard vs Preferred</h1><p className={styles.subtitle}>Agents - Standard vs Preferred</p></div></div><div className={styles.controls}><span className={`${styles.status} ${stale || error ? styles.warning : ''}`} role="status">{error || stale ? 'Update unavailable' : data ? 'Live' : 'Connecting'}</span><button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh'}</button></div></header>
    {error && <p role="alert" className={styles.alert}>{error}</p>}
    <section aria-label="Live agent availability" className={styles.live}>
      <article><h2>Agents Available</h2><p className={styles.available}>{value(data?.agents.available)}</p><span>Ready to take a call</span></article>
      <article><h2>On calls</h2><p className={styles.onCalls}>{value(data?.agents.onCalls)}</p><span>Agents in an active call state</span></article>
      <aside><strong>{value(data?.agents.loggedIn)}</strong><span>Logged in</span><p>{value(data?.agents.other)} in other states</p></aside>
    </section>
    <div className={styles.rosterGrid}>
    <section className={styles.roster} aria-labelledby="available-title"><div className={styles.rosterHead}><div><h2 id="available-title">Agents Available</h2><p>{stale ? 'Last received roster · updates unavailable' : 'Ready to take a call · Standard vs Preferred'}</p></div><span className={styles.rosterCount}>{value(data?.availableAgents.length)}</span></div>
      <ol className={styles.agentList}>{data?.availableAgents.map(agent => <li className={styles.agentRow} key={agent.id}><span className={styles.avatar} aria-hidden="true">{initials(agent.name)}</span><span className={styles.agentName}>{agent.name}</span><span className={styles.callStatus}>{agent.status}</span></li>)}</ol>
      {!data && <p className={styles.empty}>{error ? 'Agent list unavailable.' : 'Connecting to RingCX…'}</p>}
      {data && !data.availableAgents.length && <p className={styles.empty}>{stale ? 'No agents were available at the last update.' : 'No agents are currently available.'}</p>}
    </section>
    <section className={styles.roster} aria-labelledby="on-call-title"><div className={styles.rosterHead}><div><h2 id="on-call-title">On Live Calls</h2><p>{stale ? 'Last received roster · updates unavailable' : 'Standard vs Preferred agents · including calls on hold'}</p></div><span className={styles.rosterCount}>{value(data?.onCallAgents.length)}</span></div>
      <ol className={styles.agentList}>{data?.onCallAgents.map(agent => <li className={styles.agentRow} key={agent.id}><span className={styles.avatar} aria-hidden="true">{initials(agent.name)}</span><span className={styles.agentName}>{agent.name}</span><span className={styles.callStatus}>{agent.status}</span></li>)}</ol>
      {!data && <p className={styles.empty}>{error ? 'Agent list unavailable.' : 'Connecting to RingCX…'}</p>}
      {data && !data.onCallAgents.length && <p className={styles.empty}>{stale ? 'No agents were on calls at the last update.' : 'No one is on a live call.'}</p>}
    </section>
    </div>
    <section className={styles.daily} aria-label="Today's inbound calls"><div className={styles.sectionHeading}><h2>Today’s inbound calls</h2><span>Resets at midnight Eastern</span></div><p className={styles.subtitle}>Standard vs Preferred queues only</p><div className={styles.totals}><article><h3>Connected today</h3><strong>{value(data?.calls.connected)}</strong></article><article><h3>Answered today</h3><strong>{value(data?.calls.answered)}</strong></article></div><p className={styles.note}>Answered matches RingCX “Answered Inbound.” The daily connected total is awaiting historical-report verification.</p><p className={styles.note}>Connected right now: <strong>{value(data?.calls.activeConnected)}</strong> calls across these queues. This is a live count, not today’s total.</p></section>
    <footer><span>{data ? `${stale ? 'Last received' : 'Updated'} ${new Date(data.observedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} Eastern` : 'Waiting for the first RingCX update'}</span><span>{data ? `${data.queues} queues · ` : ''}Refreshes every 15 seconds</span></footer>
  </main>;
}
