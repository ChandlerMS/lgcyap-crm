/* eslint-disable @next/next/no-html-link-for-pages -- Full document navigation preserves the existing unsaved-edit beforeunload protection. */
import Image from "next/image";
import styles from "./version-switch.module.css";

export default function VersionSwitch({ version }: { version: 1 | 2 }) {
  return <div className={styles.space}><nav className={`${styles.bar} ${version === 1 ? styles.withControls : ""}`} aria-label="CRM version">
    <span className={styles.brand}><Image unoptimized className={styles.mark} src="/v2/brand/legacy-mark-light.png" alt="Legacy Agency Partners" width="160" height="128" />LEGACY <span>WORKSPACE</span></span>
    <div className={styles.tabs}>
      <a href="/" aria-current={version === 1 ? "page" : undefined}>Version 1</a>
      <a href="/v2" aria-current={version === 2 ? "page" : undefined}>Version 2</a>
    </div>
    {version === 1 ? <div id="crm-title-controls" className={styles.controlHost} /> : <a className={styles.github} href="https://github.com/LegacyAgencyPartners/LGCY-Onboard" target="_blank" rel="noopener noreferrer" aria-label="Open LGCY Onboard repository on GitHub">GitHub<span> · LGCY-Onboard</span></a>}
  </nav></div>;
}
