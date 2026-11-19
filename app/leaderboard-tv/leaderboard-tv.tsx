'use client';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TV_PERIODS, TV_REFRESH_MS, tvBoardLabel, tvConfig, tvSlide, tvSubtitle } from './tv-model.mjs';
import styles from './leaderboard-tv.module.css';

type Slide = { key: string; board: string; period: string };
type Stat = { label: string; value: number | null; kind: 'count' | 'money' | 'percent' };
type TvRow = { rank: number; name: string; value: number | null; count: number | null };
type SlideView = { available: true; stats: Stat[]; rows: TvRow[]; max: number; more: number; valueLabel: string; countLabel: string; partial: boolean; fetchedAt: string | null } | { available: false; message: string };
type Entry = { result: unknown; loadedAt: number; error?: string };

const ZONE = 'America/New_York';
const CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' });
const DATE = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'long', month: 'long', day: 'numeric' });
const UPDATED = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' });
const NUMBER = new Intl.NumberFormat('en-US');
const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const PERCENT = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const format = (value: number | null | undefined, kind: Stat['kind']) => typeof value !== 'number' || !Number.isFinite(value) ? '—' : kind === 'money' ? MONEY.format(value) : kind === 'percent' ? PERCENT.format(value) : NUMBER.format(value);

export default function LeaderboardTv({ search }: { search: string }) {
  const [config] = useState(() => tvConfig(search));
  const slides = config.slides as Slide[];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cache, setCache] = useState<Record<string, Entry>>({});
  const [signIn, setSignIn] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [idle, setIdle] = useState(false);
  const cacheRef = useRef(cache);
  const busy = useRef(false);

  // One read at a time, oldest first, each board at most every five minutes, so several TVs stay light on HubSpot and PolicyTek.
  const refreshDue = useCallback(async () => {
    if (busy.current || signIn) return;
    busy.current = true;
    try {
      for (const slide of slides) {
        const entry = cacheRef.current[slide.key];
        if (entry && Date.now() - entry.loadedAt < (entry.error ? 60_000 : TV_REFRESH_MS)) continue;
        let next: Entry;
        try {
          const response = await fetch('/api/leaderboard', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: slide.board, period: slide.period }) });
          if (response.status === 401) { setSignIn(true); return; }
          const result = await response.json().catch(() => null);
          next = response.ok ? { result, loadedAt: Date.now() } : { result: entry?.result ?? null, loadedAt: Date.now(), error: result?.error?.message ?? 'This leaderboard could not be loaded.' };
        } catch {
          next = { result: entry?.result ?? null, loadedAt: Date.now(), error: 'The connection dropped. Retrying shortly.' };
        }
        cacheRef.current = { ...cacheRef.current, [slide.key]: next };
        setCache(cacheRef.current);
      }
    } finally { busy.current = false; }
  }, [slides, signIn]);

  useEffect(() => {
    const first = setTimeout(() => void refreshDue(), 0);
    const timer = setInterval(() => void refreshDue(), 30_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [refreshDue]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 15_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const timer = setInterval(() => setIndex(value => (value + 1) % slides.length), config.seconds * 1000);
    return () => clearInterval(timer);
  }, [paused, slides.length, config.seconds]);

  // Keep the screen awake while the page is showing; the browser releases the lock when hidden.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => { try { if (!document.hidden && 'wakeLock' in navigator) lock = await (navigator as Navigator & { wakeLock: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen'); } catch { /* Not supported or not allowed. */ } };
    void request();
    document.addEventListener('visibilitychange', request);
    return () => { document.removeEventListener('visibilitychange', request); void lock?.release().catch(() => {}); };
  }, []);

  // Arrow keys move between boards, Space pauses, F toggles full screen. The cursor hides when still.
  useEffect(() => {
    let hide = setTimeout(() => setIdle(true), 3000);
    const moved = () => { setIdle(false); clearTimeout(hide); hide = setTimeout(() => setIdle(true), 3000); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') setIndex(value => (value + 1) % slides.length);
      else if (event.key === 'ArrowLeft') setIndex(value => (value - 1 + slides.length) % slides.length);
      else if (event.key === ' ') { event.preventDefault(); setPaused(value => !value); }
      else if (event.key.toLowerCase() === 'f') { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {}); }
    };
    window.addEventListener('mousemove', moved);
    window.addEventListener('keydown', key);
    return () => { clearTimeout(hide); window.removeEventListener('mousemove', moved); window.removeEventListener('keydown', key); };
  }, [slides.length]);

  const slide = slides[index % slides.length];
  const entry = cache[slide.key];
  const view = (entry?.result ? tvSlide(entry.result, slide.board, config.rows) : null) as SlideView | null;

  if (signIn) return <main className={styles.tv}><div className={styles.message}><Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners" width={220} height={143} /><h1>Sign in to show the leaderboard</h1><p>This screen’s sign-in has ended.</p><a className={styles.signIn} href="/sign-in">Sign in</a></div></main>;

  return <main className={`${styles.tv} ${idle ? styles.idle : ''}`} onDoubleClick={() => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {}); }}>
    <header className={styles.header}>
      <Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners" width={220} height={143} className={styles.logo} priority />
      <div className={styles.titles}>
        <p className={styles.eyebrow}>Agent Leaderboard</p>
        <h1>{tvBoardLabel(slide.board)}</h1>
        <p className={styles.subtitle}><strong>{TV_PERIODS[slide.period as keyof typeof TV_PERIODS]}</strong> · {tvSubtitle(slide.board)}</p>
      </div>
      <div className={styles.clock} aria-live="off">
        <strong>{now ? CLOCK.format(now) : ''}</strong>
        <span>{now ? DATE.format(now) : ''}</span>
        <span className={styles.updated}>{entry?.error ? 'Showing last update · reconnecting' : view?.available && view.fetchedAt ? `Updated ${UPDATED.format(Date.parse(view.fetchedAt))}` : entry ? '' : 'Loading…'}{paused ? ' · Paused' : ''}</span>
      </div>
    </header>

    {view?.available ? <>
      <dl className={styles.stats}>{view.stats.map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd>{format(stat.value, stat.kind)}</dd></div>)}</dl>
      <section className={styles.board} aria-label={`${tvBoardLabel(slide.board)} ranking`}>
        <div className={styles.columns} aria-hidden="true"><span>Rank</span><span>Agent</span><span>{view.countLabel}</span><span /><span>{view.valueLabel}</span></div>
        {view.rows.length ? <ol className={styles.rows} style={{ gridTemplateRows: `repeat(${config.rows}, minmax(0, 1fr))` }}>
          {view.rows.map(row => <li key={`${row.rank}-${row.name}`} className={row.rank <= 3 ? styles[`top${row.rank}`] : undefined}>
            <span className={styles.medal}>{row.rank}</span>
            <span className={styles.name}>{row.name}</span>
            <span className={styles.count}>{format(row.count, 'count')}</span>
            <span className={styles.track}><span className={styles.bar} style={{ width: `${typeof row.value === 'number' && view.max > 0 ? Math.max(2, row.value / view.max * 100) : 0}%` }} /></span>
            <strong className={styles.value}>{format(row.value, 'money')}</strong>
          </li>)}
        </ol> : <p className={styles.empty}>No recorded activity yet {TV_PERIODS[slide.period as keyof typeof TV_PERIODS].toLowerCase()}.</p>}
        {(view.more > 0 || view.partial) && <p className={styles.note}>{view.more > 0 ? `+ ${view.more} more ${view.more === 1 ? 'agent' : 'agents'} in the CRM Leaderboard. ` : ''}{view.partial ? 'Some records are still loading; totals cover loaded records only.' : ''}</p>}
      </section>
    </> : <div className={styles.message}><h2>{view ? 'Leaderboard unavailable' : 'Loading the leaderboard…'}</h2>{view && !view.available && <p>{view.message}</p>}</div>}

    {slides.length > 1 && <footer className={styles.footer}>
      <ol className={styles.dots}>{slides.map((item, at) => <li key={item.key} className={at === index % slides.length ? styles.current : undefined}>{tvBoardLabel(item.board)}{config.periods.length > 1 ? ` · ${TV_PERIODS[item.period as keyof typeof TV_PERIODS]}` : ''}</li>)}</ol>
      {!paused && <span key={`${slide.key}-${index}`} className={styles.progress} style={{ animationDuration: `${config.seconds}s` }} />}
    </footer>}
  </main>;
}
