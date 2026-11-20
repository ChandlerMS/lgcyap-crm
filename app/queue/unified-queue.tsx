"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import tabs from "../leaderboard.module.css";
import QueueBoard from "./queue-board";
import RingCxDashboard from "../ringcx/ringcx-dashboard";
import styles from "./unified-queue.module.css";

type QueueView = "all" | "shopper" | "standard";
export default function UnifiedQueue({ embedded = false, initialView = "all", tv = false }: { embedded?: boolean; initialView?: QueueView; tv?: boolean }) {
  const [view, setView] = useState<QueueView>(initialView);
  // Shopper already manages its wall-screen wake lock and reload. Standard TV needs the same lifecycle.
  useEffect(() => {
    if (!tv || initialView !== "standard") return;
    let stopped = false;
    let wake: WakeLockSentinel | null = null;
    const acquire = async () => { try { const lock = await navigator.wakeLock.request("screen"); if (stopped) await lock.release(); else wake = lock; } catch { /* Screen wake lock is optional. */ } };
    const visible = () => { if (document.visibilityState === "visible" && (!wake || wake.released)) void acquire(); };
    void acquire(); document.addEventListener("visibilitychange", visible);
    const reload = setTimeout(() => window.location.reload(), 6 * 3600e3);
    return () => { stopped = true; clearTimeout(reload); document.removeEventListener("visibilitychange", visible); void wake?.release().catch(() => {}); };
  }, [tv, initialView]);
  const title = tv ? `${view === "shopper" ? "Shopper" : "Standard vs Preferred"} Queue` : "Queues";
  return <main className={`${styles.page}${tv ? ` ${styles.tv}` : ""}`} data-queue-tv={tv || undefined}>
    <header className={styles.header}>
      <Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners" width={164} height={107} priority className={styles.logo} />
      <div><h1>{title}</h1><p>{tv ? "Legacy Agency Partners · Live office queue" : "Shopper and Standard vs Preferred"}</p></div>
      <div className={styles.actions}>
        {!embedded && <a href="https://crm.lgcyap.com/">Recruiting workspace</a>}
        <button type="button" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>Full screen</button>
      </div>
    </header>
    {!tv && <div className={`${tabs.boardTabs} ${styles.viewTabs}`} role="group" aria-label="Queue view">{([['all', 'All'], ['shopper', 'Shopper'], ['standard', 'Standard vs. Preferred']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div>}
    <div className={`${styles.groups}${view !== "all" ? ` ${styles.singleGroup}` : ""}`}>
      {view !== "standard" && <section aria-label="Shopper" className={styles.group}><QueueBoard embedded={embedded} grouped tv={tv} /></section>}
      {view !== "shopper" && <section aria-label="Standard vs Preferred" className={styles.group}><RingCxDashboard grouped tv={tv} /></section>}
    </div>
  </main>;
}
