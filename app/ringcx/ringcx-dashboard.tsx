'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './ringcx.module.css';

type Snapshot = { observedAt: string; agents: { available: number; onCalls: number; loggedIn: number; other: number }; queues: number; calls: { connected: number | null; answered: number | null; status: string } };
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
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to the CRM to view this dashboard.' : 'RingCX could not refresh. Last received data is shown below.');
      const result = await response.json();
      if (!result?.agents || !Number.isFinite(Date.parse(result.observedAt))) throw new Error('RingCX returned an incomplete update.');
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
    <header className={styles.header}><div><p className={styles.brand}>Legacy Agency Partners</p><h1>RingCX live desk</h1><p className={styles.subtitle}>Agents - Standard vs Preferred</p></div><div className={styles.controls}><span className={`${styles.status} ${stale || error ? styles.warning : ''}`}>{error || stale ? 'Update unavailable' : data ? 'Connected' : 'Connecting'}</span><button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh'}</button></div></header>
    {error && <p role="alert" className={styles.alert}>{error}</p>}
    <section aria-label="Live agent availability" className={styles.live}>
      <article><h2>Available</h2><p className={styles.available}>{value(data?.agents.available)}</p><span>Ready to take a call</span></article>
      <article><h2>On calls</h2><p className={styles.onCalls}>{value(data?.agents.onCalls)}</p><span>Agents in an active call state</span></article>
      <aside><strong>{value(data?.agents.loggedIn)}</strong><span>Logged in</span><p>{value(data?.agents.other)} in other states</p></aside>
    </section>
    <section className={styles.daily} aria-label="Today's inbound calls"><div className={styles.sectionHeading}><h2>Today’s inbound calls</h2><span>Eastern time</span></div><p className={styles.subtitle}>Standard vs Preferred queues only</p><div className={styles.totals}><article><h3>Connected</h3><strong>{value(data?.calls.connected)}</strong></article><article><h3>Answered</h3><strong>{value(data?.calls.answered)}</strong></article></div><p className={styles.note}>Daily totals are awaiting verification against RingCX Analytics. Unverified totals are not shown as zero.</p></section>
    <footer><span>{data ? `${stale ? 'Last received' : 'Updated'} ${new Date(data.observedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} Eastern` : 'Waiting for the first RingCX update'}</span><span>{data ? `${data.queues} queues · ` : ''}Refreshes every 15 seconds</span></footer>
  </main>;
}
