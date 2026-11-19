"use client";
import { useState } from "react";
import HubSpotWorkspace from "./hubspot-workspace";
import tabs from "./leaderboard.module.css";

export default function SalesPage({ onUnauthorized, onDirtyChange, onBusyChange }: { onUnauthorized: () => void; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  const [view, setView] = useState<"shopper" | "standard">("shopper");
  return <>
    <div className={`${tabs.boardTabs} ${tabs.centeredBoardTabs}`} role="group" aria-label="Sales view">
      <button type="button" aria-pressed={view === "shopper"} onClick={() => setView("shopper")}>Shopper</button>
      <button type="button" aria-pressed={view === "standard"} onClick={() => setView("standard")}>Standard vs Preferred</button>
    </div>
    {view === "shopper" ? <section aria-label="Shopper sales" className="shopper-sales">
      <div className="sales-heading"><h1 className="page-title" id="page-title" tabIndex={-1}>Shopper Sales</h1><a className="btn btn-secondary" href="https://app.policytek.com/leads" target="_blank" rel="noopener noreferrer">Open in PolicyTek<span className="sr-only"> (opens in a new tab)</span></a></div>
      <p className="helper">Live leads from PolicyTek. If prompted, sign in to PolicyTek in this view or open PolicyTek in a new tab.</p>
      <div className="shopper-embed"><iframe className="shopper-embed-frame" src="https://app.policytek.com/leads" title="Shopper sales · PolicyTek leads" referrerPolicy="no-referrer" /></div>
    </section> : <div className="sales-records"><HubSpotWorkspace tool="sales" label="Sales" description="Standard vs Preferred deals from HubSpot." onUnauthorized={onUnauthorized} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} /></div>}
  </>;
}
