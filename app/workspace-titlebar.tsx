"use client";

import { useEffect } from "react";
import usePortalHost from "./use-portal-host";
import { createPortal } from "react-dom";
import WorkspaceSearch from "./workspace-search";
import styles from "./workspace-titlebar.module.css";

type SupportArea = "inbox" | "help-desk" | "tickets";
type Props = {
  demo: boolean; modeDisabled: boolean; searchDisabled: boolean; activeView: string; menuOpen: boolean;
  demoRecords: { id: string; name: string; email?: string | null; phone?: string | null; office?: string }[];
  onModeChange: (demo: boolean) => void; onNavigate: () => void;
  onSupportNavigate: (id: SupportArea) => void; onUnauthorized: () => void;
  unreadCounts?: Partial<Record<SupportArea, number | null>>;
};
const SUPPORT: { id: SupportArea; label: string }[] = [{ id: "inbox", label: "Inbox" }, { id: "help-desk", label: "Help Desk" }, { id: "tickets", label: "Tickets" }];

export default function WorkspaceTitlebar(props: Props) {
  const host = usePortalHost("crm-title-controls");
  useEffect(() => {
    const bar = host?.closest("nav");
    if (!bar) return;
    let height = 0;
    const measure = () => {
      const next = Math.ceil(bar.getBoundingClientRect().height);
      if (next !== height) { height = next; document.documentElement.style.setProperty("--crm-titlebar-height", `${next}px`); }
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(bar);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--crm-titlebar-height"); };
  }, [host]);
  if (!host) return null;
  const disabled = props.modeDisabled || props.menuOpen;
  return createPortal(<div className={styles.controls} inert={props.menuOpen}>
    <div className={styles.mode} role="group" aria-label="Recruiting data source">
      <button type="button" aria-pressed={!props.demo} disabled={disabled} onClick={() => props.onModeChange(false)}>Live Data</button>
      <button type="button" aria-pressed={props.demo} disabled={disabled} onClick={() => props.onModeChange(true)}>Demo Data</button>
    </div>
    <WorkspaceSearch demo={props.demo} demoRecords={props.demoRecords} disabled={props.searchDisabled || props.modeDisabled || props.menuOpen} onUnauthorized={props.onUnauthorized} onNavigate={props.onNavigate} />
    <nav className={styles.support} aria-label="Support workspaces">
      {SUPPORT.map(item => {
        const raw = props.demo ? null : props.unreadCounts?.[item.id];
        const count = typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
        return <a key={item.id} href={`#${item.id}`} aria-current={props.activeView === item.id ? "page" : undefined} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} title={count === null ? `${item.label} · HubSpot unread count unavailable` : `${item.label} · ${count} unread`} onClick={event => {
          if (disabled) { event.preventDefault(); return; }
          props.onSupportNavigate(item.id);
        }}>{item.label}{count !== null && count > 0 && <span className={styles.badge} aria-label={`${count} unread`}>{count > 99 ? "99+" : count}</span>}</a>;
      })}
    </nav>
  </div>, host);
}
