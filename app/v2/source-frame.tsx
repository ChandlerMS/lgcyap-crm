import styles from "./source-frame.module.css";

const onboardUrl = "https://lgcy-onboard.carlos-831.workers.dev/";

export default function SourceFrame() {
  return <section className={styles.host} aria-label="LGCY Onboard live workspace">
    <div className={styles.toolbar}>
      <span>Live LGCY Onboard · Sign in on the embedded site if prompted.</span>
      <a href={onboardUrl} target="_blank" rel="noopener noreferrer">Open in new tab</a>
    </div>
    <iframe className={styles.frame} src={onboardUrl} title="Version 2 — Live LGCY Onboard" allow="clipboard-write" referrerPolicy="no-referrer" />
  </section>;
}
