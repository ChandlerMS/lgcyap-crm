"use client";

import { useId } from "react";
import { communicationAction } from "./recruit-communication-links.mjs";

function CommunicationIcon({ action }: { action: "call" | "text" | "email" }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{action === "call"
    ? <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    : action === "text" ? <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6A8.4 8.4 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>
    : <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>}</svg>;
}

export default function RecruitCommunications({ recruitName, recruitId, hubspotUrl }: { recruitName: string; recruitId: string; hubspotUrl: string }) {
  const id = useId();
  return <div className="recruit-communications" role="group" aria-label={`HubSpot tools for ${recruitName}`}>
    {(["call", "text", "email"] as const).map(action => {
      const result = communicationAction(recruitId, hubspotUrl, action);
      const label = action === "call" ? `Open HubSpot calling tools for ${recruitName}` : action === "text" ? `Texting not connected for ${recruitName}` : `Email ${recruitName} in HubSpot`;
      const descriptionId = `${id}-${action}`;
      return <span className="communication-item" key={action}>
        {result.href ? <a className="communication-button" href={result.href} target="_blank" rel="noopener noreferrer" aria-label={label} aria-describedby={descriptionId} title={result.reason}><CommunicationIcon action={action} /></a>
          : <button className="communication-button" type="button" aria-disabled="true" aria-label={label} aria-describedby={descriptionId} title={result.reason}><CommunicationIcon action={action} /></button>}
        <span className="communication-tooltip" role="tooltip" id={descriptionId}>{result.reason}</span>
      </span>;
    })}
  </div>;
}
