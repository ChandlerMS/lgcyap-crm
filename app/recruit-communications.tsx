"use client";

import { useRecruitEmail } from "./recruit-email";
import { useId } from "react";
import { communicationAction } from "./recruit-communication-links.mjs";
import { communicationPhone } from "./ringcentral-bridge.mjs";
import { useRingCentral } from "./ringcentral-panel";

function CommunicationIcon({ action }: { action: "call" | "text" | "email" }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{action === "call"
    ? <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    : action === "text" ? <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6A8.4 8.4 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>
    : <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>}</svg>;
}

const ACTION_LABELS = { call: "Call", text: "Text", email: "Email" } as const;

/**
 * `labeled` shows the action name beside each icon for larger quick-action buttons. `mini` is the small icon-and-name
 * style of a hover card's quick links, beside its Note, Task, Meeting and Calendar buttons.
 */
export default function RecruitCommunications({ recruitName, recruitId, hubspotUrl, phone, isDemo = false, labeled = false, mini = false }: { recruitName: string; recruitId: string; hubspotUrl: string; phone?: string | null; isDemo?: boolean; labeled?: boolean; mini?: boolean }) {
  const id = useId();
  const ringCentral = useRingCentral();
  const email = useRecruitEmail();
  const number = communicationPhone(phone);
  const buttonClass = mini ? "mini-action-button" : labeled ? "communication-button communication-button-labeled" : "communication-button";
  return <div className={mini ? "mini-communications" : labeled ? "recruit-communications recruit-communications-labeled" : "recruit-communications"} role="group" aria-label={`Contact tools for ${recruitName}`}>
    {(["call", "text", "email"] as const).map(action => {
      const content = <><CommunicationIcon action={action} />{!mini && labeled && <span className="communication-label" aria-hidden="true">{ACTION_LABELS[action]}</span>}</>;
      const result = communicationAction(recruitId, hubspotUrl, action, isDemo);
      const ringAction = action !== "email";
      const available = action === "call" && !isDemo && ringCentral.configured && Boolean(number);
      const reason = action === "text" ? "Texting is paused while messaging approval is pending." : !ringAction ? "Choose an offer template or compose a new email." : isDemo ? "Demo contacts cannot call or text." : !ringCentral.configured ? "RingCentral is not configured." : !number ? "Add a valid phone number to use RingCentral." : "Prepare a call in RingCentral. You choose when to dial.";
      const label = action === "email" ? `Email ${recruitName}` : `${action === "call" ? "Call" : "Text"} ${recruitName} with RingCentral`;
      const descriptionId = `${id}-${action}`;
      return <span className="communication-item" key={action}>
        {ringAction ? <button className={buttonClass} type="button" disabled={!available} aria-label={label} aria-describedby={descriptionId} title={reason} onClick={() => { if (available && number) ringCentral.open({ action, phone: number, name: recruitName }); }}>{content}</button>
          : result.href ? <button className={buttonClass} type="button" disabled={isDemo || email.disabled} onClick={() => email.open(recruitId, recruitName)} aria-label={label} aria-describedby={descriptionId} title={reason}>{content}</button>
          : <button className={buttonClass} type="button" disabled aria-label={label} aria-describedby={descriptionId} title={reason}>{content}</button>}
        <span className="communication-tooltip" role="tooltip" id={descriptionId}>{reason}</span>
      </span>;
    })}
  </div>;
}
