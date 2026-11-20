"use client";

import { useEffect } from "react";
import usePortalHost from "./use-portal-host";
import { createPortal } from "react-dom";
import WorkspaceSearch from "./workspace-search";
import styles from "./workspace-titlebar.module.css";

type SupportArea = "tasks" | "follow-up" | "meetings" | "calendar" | "email" | "inbox" | "help-desk" | "tickets";
type Props = {
  demo: boolean; modeDisabled: boolean; searchDisabled: boolean; activeView: string; menuOpen: boolean;
  demoRecords: { id: string; name: string; email?: string | null; phone?: string | null; office?: string }[];
  onModeChange: (demo: boolean) => void; onNavigate: () => void;
  onSupportNavigate: (id: SupportArea) => void; onUnauthorized: () => void;
  unreadCounts?: Partial<Record<SupportArea, number | null>>;
};
const SUPPORT: { id: SupportArea; label: string }[] = [{ id: "tasks", label: "Tasks" }, { id: "follow-up", label: "Follow-up" }, { id: "meetings", label: "Meetings" }, { id: "calendar", label: "Calendar" }, { id: "email", label: "Email" }, { id: "inbox", label: "Inbox" }, { id: "help-desk", label: "Help Desk" }, { id: "tickets", label: "Tickets" }];

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
    <nav className={styles.support} aria-label="Workspace shortcuts">
      {SUPPORT.map(item => {
        const raw = props.demo ? null : props.unreadCounts?.[item.id];
        const count = typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
        return <a key={item.id} href={`#${item.id}`} aria-current={props.activeView === item.id ? "page" : undefined} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} aria-label={item.label} title={count === null ? item.label : `${item.label} · ${count} unread`} onClick={event => {
          if (disabled) { event.preventDefault(); return; }
          props.onSupportNavigate(item.id);
        }}><ShortcutIcon name={item.id} /><span className="sr-only">{item.label}</span>{count !== null && count > 0 && <span className={styles.badge} aria-label={`${count} unread`}>{count > 99 ? "99+" : count}</span>}</a>;
      })}
    </nav>
  </div>, host);
}

function ShortcutIcon({ name }: { name: SupportArea }) {
  const paths = {
    tasks: 'M9 5h11v16H4V5h2M9 3h6v4H9zM8 12l2 2 5-5M8 18h8',
    'follow-up': 'M4 7h11a5 5 0 0 1 0 10h-3M4 7l4-4M4 7l4 4M5 17h3M6.5 15.5v3',
    meetings: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    calendar: 'M4 5h16v16H4zM16 3v4M8 3v4M4 11h16M8 15h2M14 15h2',
    email: 'M3 5h18v14H3zM3 6l9 7 9-7',
    inbox: 'M4 4h16l2 12v4H2v-4zM2 16h6l2 3h4l2-3h6',
    'help-desk': 'M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v7h4v-7zM20 12h2v7h-4v-7zM20 19c0 2-3 3-7 3',
    tickets: 'M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4zM15 5v3M15 11v2M15 16v3',
  };
  return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
