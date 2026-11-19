"use client";

import Image from "next/image";
import QueueBoard from "./queue-board";
import RingCxDashboard from "../ringcx/ringcx-dashboard";
import styles from "./unified-queue.module.css";

export default function UnifiedQueue({ embedded = false }: { embedded?: boolean }) {
  return <main className={styles.page}>
    <header className={styles.header}>
      <Image unoptimized src="/legacy-logo.png" alt="Legacy Agency Partners" width={164} height={107} priority className={styles.logo} />
      <div><h1>Queues</h1><p>Shopper and Standard vs Preferred</p></div>
      <div className={styles.actions}>
        {!embedded && <a href="https://crm.lgcyap.com/">Recruiting workspace</a>}
        <button type="button" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>Full screen</button>
      </div>
    </header>
    <div className={styles.groups}>
      <section aria-label="Shopper" className={styles.group}><QueueBoard embedded={embedded} grouped /></section>
      <section aria-label="Standard vs Preferred" className={styles.group}><RingCxDashboard grouped /></section>
    </div>
  </main>;
}
