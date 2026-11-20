"use client";
import SvpDispositions from "./svp-dispositions";
import HubSpotWorkspace from "./hubspot-workspace";
import tabs from "./leaderboard.module.css";

export default function CallsPage({ view, onSourceChange, onUnauthorized, onDirtyChange, onBusyChange }: { view: "shopper" | "shopper-dispositions" | "standard" | "standard-dispositions"; onSourceChange: (source: "shopper" | "shopper-dispositions" | "standard" | "standard-dispositions") => void; onUnauthorized: () => void; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  const dispositions = view.endsWith("-dispositions");
  const standard = view.startsWith("standard");
  return <>
    <div className="calls-view-controls">
      <div className={`${tabs.boardTabs} ${tabs.centeredBoardTabs}`} role="group" aria-label="Calls view">
        <button type="button" aria-pressed={!dispositions} onClick={() => onSourceChange(standard ? "standard" : "shopper")}>Calls</button>
        <button type="button" aria-pressed={dispositions} onClick={() => onSourceChange(standard ? "standard-dispositions" : "shopper-dispositions")}>Dispositions</button>
      </div>
      <div className={`${tabs.boardTabs} ${tabs.centeredBoardTabs}`} role="group" aria-label={dispositions ? "Dispositions source" : "Calls source"}>
        {dispositions ? <>
          <button type="button" aria-pressed={!standard} onClick={() => onSourceChange("shopper-dispositions")}>Shopper Dispositions</button>
          <button type="button" aria-pressed={standard} onClick={() => onSourceChange("standard-dispositions")}>Standard vs Preferred Dispositions</button>
        </> : <>
          <button type="button" aria-pressed={!standard} onClick={() => onSourceChange("shopper")}>Shopper</button>
          <button type="button" aria-pressed={standard} onClick={() => onSourceChange("standard")}>Standard vs Preferred</button>
        </>}
      </div>
    </div>
    {view === "standard-dispositions" ? <SvpDispositions onUnauthorized={onUnauthorized} /> : view !== "standard" ? <section aria-label={view === "shopper-dispositions" ? "Shopper dispositions" : "Shopper calls"}>
      <div className="sales-heading"><h1 className="page-title" id="page-title" tabIndex={-1}>{view === "shopper-dispositions" ? "Shopper Dispositions" : "Shopper Calls"}</h1><a className="btn btn-secondary" href={view === "shopper-dispositions" ? "https://app.policytek.com/leads" : "https://app.policytek.com/calls"} target="_blank" rel="noopener noreferrer">Open in PolicyTek<span className="sr-only"> (opens in a new tab)</span></a></div>
      <p className="helper">{view === "shopper-dispositions" ? "Shopper dispositions from PolicyTek." : "Live calls from PolicyTek."} If prompted, sign in to PolicyTek in this view or open PolicyTek in a new tab.</p>
      <div className="shopper-embed shopper-calls-embed"><iframe key={view} className="shopper-embed-frame" src={view === "shopper-dispositions" ? "https://app.policytek.com/leads" : "https://app.policytek.com/calls"} title={view === "shopper-dispositions" ? "Shopper dispositions · PolicyTek leads" : "Shopper calls · PolicyTek"} referrerPolicy="no-referrer" /></div>
    </section> : <div className="sales-records"><HubSpotWorkspace tool="calls" label="Calls" description="Standard vs Preferred · HubSpot calls assigned to you." onUnauthorized={onUnauthorized} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} /></div>}
  </>;
}
