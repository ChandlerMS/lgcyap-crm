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
  const { open, disabled, sentView } = useRecruitEmail();
  const [page, setPage] = useState(1);
  const [viewSelection, setViewSelection] = useState<{ view: "received" | "recipients"; sentView: number }>({ view: "received", sentView });
  const view = viewSelection.sentView === sentView ? viewSelection.view : "received";
  const setView = (next: "received" | "recipients") => setViewSelection({ view: next, sentView });
  const [mailRefresh, setMailRefresh] = useState(0);
  const rows = disabled ? [] : recruits.filter(item => !item.isDemo && item.email && /^[1-9]\d{0,29}$/.test(item.id)).sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }));
  const pageView = pageWindow(rows.length, page, 10);
  const Heading = compact ? "h2" : "h1";
  const titleId = compact ? "today-email-title" : "page-title";
  return <section className={`${styles.workspace} ${compact ? styles.compact : ""}`} aria-labelledby={titleId}>
    <div className={styles.heading} data-section-heading>
      <div className="section-title-controls"><Heading id={titleId} tabIndex={-1}>{compact ? <a className="panel-title-link" href="#email">Email</a> : "Email"}</Heading><div className="panel-heading-actions"><button type="button" className="summary-add" title="New Email" aria-label="New Email" disabled={disabled} onClick={() => open()}><span aria-hidden="true">+</span><span className="sr-only">New Email</span></button><SectionToggle /></div></div>
      <div className={styles.headingActions}><button type="button" className="btn btn-secondary" disabled={disabled || refreshing || refreshDisabled} onClick={() => { setMailRefresh(value => value + 1); onRefresh?.(); }}>{refreshing ? "Refreshing…" : "Refresh"}</button></div>
    </div>
    <div className="email-view-tabs" role="group" aria-label="Email view"><button type="button" className={`btn ${view === "received" ? "btn-primary" : "btn-secondary"}`} aria-pressed={view === "received"} onClick={() => setView("received")}>Mailbox</button><button type="button" className={`btn ${view === "recipients" ? "btn-primary" : "btn-secondary"}`} aria-pressed={view === "recipients"} onClick={() => setView("recipients")}>Recruit recipients <span className="email-recipient-count">{rows.length}</span></button></div>
    <div hidden={view !== "received"}><PrivateEmailPanel active={view === "received"} compact={compact} disabled={disabled} onUnauthorized={onUnauthorized} refreshKey={mailRefresh} /></div>
    <div hidden={view !== "recipients"}><p className="helper">Select a recruit email address to choose a template, preview and send here.</p>
    {disabled ? <p className="helper">Email is unavailable for demo recruits. Switch to live data to compose an email.</p> : !rows.length ? <p className="helper">No loaded recruit has an email address yet.</p> : <><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Recruit</th><th>Email</th><th>Office</th><th>Stage</th><th><span className="sr-only">Call and text</span></th></tr></thead><tbody>{rows.slice(pageView.start, pageView.end).map(item => <tr key={item.id}><td><a className="text-link" href={`#recruit/${encodeURIComponent(item.id)}`}>{item.name}</a></td><td><button type="button" className="text-link" onClick={() => open(item.id, item.name)} aria-label={`Email ${item.name} at ${item.email}`}>{item.email}</button></td><td>{item.office || "Not recorded"}</td><td>{item.stage || "Not recorded"}</td><td><RecruitCommunications recruitId={item.id} recruitName={item.name} phone={item.phone} hubspotUrl={item.hubspotUrl ?? ""} isDemo={item.isDemo} actions={["call", "text"]} labeled /></td></tr>)}</tbody></table></div><PanelPager count={rows.length} page={pageView.page} size={10} label="Email recipients" onPage={setPage} /></>}
    </div>
  </section>;
}
