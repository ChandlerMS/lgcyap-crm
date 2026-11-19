"use client";

import { useState } from "react";
import PrivateEmailPanel from "./private-email-panel";
import { useRecruitEmail } from "./recruit-email";
import RecruitCommunications from "./recruit-communications";
import { SectionToggle } from "./dashboard-section";
import PanelPager from "./panel-pager";
import { pageWindow } from "./panel-pager.mjs";
import styles from "./hubspot-workspace.module.css";

type Recipient = { id: string; name: string; email?: string | null; office?: string | null; stage?: string | null; isDemo?: boolean; phone?: string | null; hubspotUrl?: string };
type Props = { compact?: boolean; recruits: readonly Recipient[]; onRefresh?: () => void; refreshing?: boolean; refreshDisabled?: boolean; onUnauthorized?: () => void };
export default function RecruitEmailPanel({ recruits, onRefresh, refreshing = false, refreshDisabled = false, compact = true, onUnauthorized }: Props) {
  const { open, disabled } = useRecruitEmail();
  const [page, setPage] = useState(1);
  const rows = disabled ? [] : recruits.filter(item => !item.isDemo && item.email && /^[1-9]\d{0,29}$/.test(item.id)).sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }));
  const view = pageWindow(rows.length, page, 10);
  const Heading = compact ? "h2" : "h1";
  const titleId = compact ? "today-email-title" : "page-title";
  return <section className={`${styles.workspace} ${compact ? styles.compact : ""}`} aria-labelledby={titleId}>
    <div className={styles.heading} data-section-heading><div className="section-title-controls"><Heading id={titleId} tabIndex={-1}>{compact ? <a className="panel-title-link" href="#email">Email</a> : "Email"}<span className={styles.headingCount}>{rows.length}</span></Heading><div className="panel-heading-actions"><button type="button" className="summary-add" title="New Email" aria-label="New Email" disabled={disabled} onClick={() => open()}><span aria-hidden="true">+</span><span className="sr-only">New Email</span></button><SectionToggle /></div></div><div className={styles.headingActions}><a className={styles.nativeLink} href="https://app.hubspot.com/contacts/50894788/objects/0-1" target="_blank" rel="noopener noreferrer">Open in HubSpot<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></svg><span className="sr-only"> (opens in a new tab)</span></a>{onRefresh && <button type="button" className="btn btn-secondary" disabled={refreshing || refreshDisabled} onClick={onRefresh}>{refreshing ? "Loading…" : "Refresh"}</button>}</div></div>
    <PrivateEmailPanel compact={compact} disabled={disabled} onUnauthorized={onUnauthorized} />
    <p className="helper">Recruit email recipients · Compose and send in HubSpot.</p>
    {disabled ? <p className="helper">Email is unavailable for demo recruits. Switch to live data to compose an email.</p> : !rows.length ? <p className="helper">No loaded recruit has an email address yet.</p> : <><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Recruit</th><th>Email</th><th>Office</th><th>Stage</th><th><span className="sr-only">Call and text</span></th></tr></thead><tbody>{rows.slice(view.start, view.end).map(item => <tr key={item.id}><td><a className="text-link" href={`#recruit/${encodeURIComponent(item.id)}`}>{item.name}</a></td><td><button type="button" className="text-link" onClick={() => open(item.id, item.name)} aria-label={`Email ${item.name} at ${item.email}`}>{item.email}</button></td><td>{item.office || "Not recorded"}</td><td>{item.stage || "Not recorded"}</td><td><RecruitCommunications recruitId={item.id} recruitName={item.name} phone={item.phone} hubspotUrl={item.hubspotUrl ?? ""} isDemo={item.isDemo} actions={["call", "text"]} labeled /></td></tr>)}</tbody></table></div><PanelPager count={rows.length} page={view.page} size={10} label="Email recipients" onPage={setPage} /></>}
  </section>;
}
