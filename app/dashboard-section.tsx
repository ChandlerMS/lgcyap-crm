"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

// Which dashboard sections each viewer has collapsed, kept in this browser only.
const STORAGE_KEY = "crm:dashboard-collapsed";
function readCollapsed(id: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return saved && typeof saved === "object" && typeof saved[id] === "boolean" ? saved[id] as boolean : fallback;
  } catch { return fallback; }
}
function writeCollapsed(id: string, collapsed: boolean) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...(saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {}), [id]: collapsed }));
  } catch { /* Private windows and blocked storage still collapse; the choice just isn't remembered. */ }
}

/** One dashboard section's collapsed state, remembered in this browser. Only render it in the browser (the dashboard waits for data). */
export function useDashboardCollapse(id: string, defaultCollapsed = false) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id, defaultCollapsed));
  const toggle = () => { const next = !collapsed; setCollapsed(next); writeCollapsed(id, next); };
  return { collapsed, toggle };
}

type Section = { label: string; collapsed: boolean; toggle: () => void; controls: string };
const SectionContext = createContext<Section | null>(null);
// The summary cards collapse one by one; inside this scope each offers its own toggle.
const CollapsibleScope = createContext(false);
export const CollapsibleCards = ({ children }: { children: ReactNode }) => <CollapsibleScope.Provider value>{children}</CollapsibleScope.Provider>;
export const useCollapsibleCards = () => useContext(CollapsibleScope);

/**
 * A collapsible dashboard section. The panel inside puts <SectionToggle /> in its heading row; collapsed, the panel
 * shows only the part holding the toggle (see .dashboard-section.is-collapsed in globals.css). The panel stays mounted,
 * so its data keeps loading and refreshing.
 */
export function DashboardSection({ id, label, defaultCollapsed = false, className, children }: { id: string; label: string; defaultCollapsed?: boolean; className?: string; children: ReactNode }) {
  const { collapsed, toggle } = useDashboardCollapse(id, defaultCollapsed);
  const controls = `dashboard-section-${id}`;
  return <SectionContext.Provider value={{ label, collapsed, toggle, controls }}>
    <div id={controls} className={`dashboard-section${collapsed ? " is-collapsed" : ""}${className ? ` ${className}` : ""}`}>{children}</div>
  </SectionContext.Provider>;
}

/**
 * The gold chevron at the right of a section's heading row. Inside a DashboardSection it needs no props; elsewhere it
 * renders nothing unless given its own state.
 */
export function SectionToggle({ collapsed, onToggle, label, controls }: { collapsed?: boolean; onToggle?: () => void; label?: string; controls?: string }) {
  const section = useContext(SectionContext);
  const state = onToggle ? { collapsed: Boolean(collapsed), toggle: onToggle, label: label ?? "section", controls } : section;
  if (!state) return null;
  const action = `${state.collapsed ? "Expand" : "Collapse"} ${state.label}`;
  return <button type="button" className="section-toggle" aria-expanded={!state.collapsed} aria-controls={state.controls} aria-label={action} title={action} onClick={state.toggle}>
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
  </button>;
}
