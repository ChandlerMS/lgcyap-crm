"use client";
import HubSpotWorkspace from "./hubspot-workspace";
import tabs from "./leaderboard.module.css";

export default function CallsPage({ view, onSourceChange, onUnauthorized, onDirtyChange, onBusyChange }: { view: "shopper" | "standard"; onSourceChange: (source: "shopper" | "standard") => void; onUnauthorized: () => void; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  return <>
    <div className={tabs.boardTabs} role="group" aria-label="Calls view">
      <button type="button" aria-pressed={view === "shopper"} onClick={() => onSourceChange("shopper")}>Shopper</button>
      <button type="button" aria-pressed={view === "standard"} onClick={() => onSourceChange("standard")}>Standard vs Preferred</button>
    </div>
    {view === "shopper" ? <section aria-label="Shopper calls">
      <div className="sales-heading"><h1 className="page-title" id="page-title" tabIndex={-1}>Shopper Calls</h1><a className="btn btn-secondary" href="https://app.policytek.com/calls" target="_blank" rel="noopener noreferrer">Open in PolicyTek<span className="sr-only"> (opens in a new tab)</span></a></div>
      <p className="helper">Live calls from PolicyTek. If prompted, sign in to PolicyTek in this view or open PolicyTek in a new tab.</p>
      <iframe className="policytek-frame" src="https://app.policytek.com/calls" title="Shopper calls · PolicyTek" referrerPolicy="no-referrer" />
    </section> : <div className="sales-records"><HubSpotWorkspace tool="calls" label="Calls" description="Standard vs Preferred · HubSpot calls assigned to you." onUnauthorized={onUnauthorized} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} /></div>}
  </>;
}
