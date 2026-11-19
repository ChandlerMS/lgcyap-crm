"use client";

import { useState } from "react";
import { useRecruitEmail } from "./recruit-email";
import { SectionToggle } from "./dashboard-section";
import PanelPager from "./panel-pager";
import { pageWindow } from "./panel-pager.mjs";
import styles from "./hubspot-workspace.module.css";

type Recipient = { id: string; name: string; email?: string | null; office?: string | null; stage?: string | null; isDemo?: boolean };
type Props = { recruits: readonly Recipient[]; onRefresh?: () => void; refreshing?: boolean; refreshDisabled?: boolean };
export default function RecruitEmailPanel({ recruits, onRefresh, refreshing = false, refreshDisabled = false }: Props) {
  const { open, disabled } = useRecruitEmail();
  const [page, setPage] = useState(1);
  const rows = disabled ? [] : recruits.filter(item => !item.isDemo && item.email && /^[1-9]\d{0,29}$/.test(item.id)).sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }));
  const view = pageWindow(rows.length, page, 10);
  return <section className={`${styles.workspace} ${styles.compact}`} aria-labelledby="today-email-title">
    <div className={styles.heading} data-section-heading><div className="section-title-controls"><h2 id="today-email-title">Email<span className={styles.headingCount}>{rows.length}</span></h2><div className="panel-heading-actions"><button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => open()}>New Email</button><SectionToggle /></div></div><div className={styles.headingActions}><a className={styles.nativeLink} href="https://app.hubspot.com/contacts/50894788/objects/0-1" target="_blank" rel="noopener noreferrer">Open in HubSpot<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></svg><span className="sr-only"> (opens in a new tab)</span></a>{onRefresh && <button type="button" className="btn btn-secondary" disabled={refreshing || refreshDisabled} onClick={onRefresh}>{refreshing ? "Loading…" : "Refresh"}</button>}</div></div>
    <p className="helper">Recruit email recipients · Compose and send in HubSpot.</p>
    {disabled ? <p className="helper">Email is unavailable for demo recruits. Switch to live data to compose an email.</p> : !rows.length ? <p className="helper">No loaded recruit has an email address yet.</p> : <><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Recruit</th><th>Email</th><th>Office</th><th>Stage</th><th><span className="sr-only">Email actions</span></th></tr></thead><tbody>{rows.slice(view.start, view.end).map(item => <tr key={item.id}><td><a className="text-link" href={`#recruit/${encodeURIComponent(item.id)}`}>{item.name}</a></td><td>{item.email}</td><td>{item.office || "Not recorded"}</td><td>{item.stage || "Not recorded"}</td><td><button type="button" className="btn btn-quiet" onClick={() => open(item.id, item.name)}>Email {item.name.split(' ')[0]}</button></td></tr>)}</tbody></table></div><PanelPager count={rows.length} page={view.page} size={10} label="Email recipients" onPage={setPage} /></>}
  </section>;
}
