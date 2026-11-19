"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { upcomingMeetingChips, weekMeetingChips } from "./dashboard-activity.mjs";
import { MEETINGS_CHANGED_EVENT } from "./recruit-quick-actions";
import SummaryChips, { type SummaryChip } from "./summary-chips";

type MeetingsResult = { status?: string; tool?: string; records?: { id: string; title: string; status?: string | null; scheduledAt?: string | null; hubspotUrl?: string }[]; partial?: boolean; error?: { message?: string } };
type State = { status: "loading" } | { status: "ready"; result: MeetingsResult } | { status: "failed"; message: string };
const FAILED = "Meetings could not be loaded from HubSpot.";
// Meetings and Calendar beneath Tasks and Follow up: one read of your HubSpot meetings feeds both. Each title opens its
// page and previews on hover; a chip opens that meeting in HubSpot.
export default function RecruitMeetingChips({ live, now, onUnauthorized, meetingLead, calendarLead }: { live: boolean; now: number; onUnauthorized: () => void; meetingLead?: ReactNode; calendarLead?: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { unauthorizedRef.current = onUnauthorized; }, [onUnauthorized]);
  // A meeting added from a Recruits row reloads these.
  useEffect(() => {
    const reload = () => setAttempt(value => value + 1);
    window.addEventListener(MEETINGS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(MEETINGS_CHANGED_EVENT, reload);
  }, []);
  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
    void (async () => {
      try {
        const response = await fetch("/api/hubspot-tools/meetings", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal });
        if (response.status === 401) { unauthorizedRef.current(); return; }
        const result = await response.json() as MeetingsResult;
        setState(response.ok && result.status === "available" && Array.isArray(result.records) ? { status: "ready", result } : { status: "failed", message: result.error?.message ?? FAILED });
      } catch {
        if (timedOut || !controller.signal.aborted) setState({ status: "failed", message: timedOut ? "HubSpot took too long to return meetings." : FAILED });
      } finally { window.clearTimeout(timer); }
    })();
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [live, attempt]);

  const ready = live && state.status === "ready" ? state.result : null;
  const meetings: SummaryChip[] = ready ? upcomingMeetingChips(ready.records ?? [], now) : [];
  const calendar: SummaryChip[] = ready ? weekMeetingChips(ready.records ?? [], now) : [];
  const count = (chips: readonly SummaryChip[]) => ready ? `${chips.length}${ready.partial ? "+" : ""}` : undefined;
  const waiting = (none: string) => !live ? "Switch to live data to see HubSpot meetings."
    : state.status === "loading" ? "Loading meetings from HubSpot…"
    : state.status === "failed" ? <>{state.message} <button className="text-link" onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}>Try again</button></>
    : none;
  return <>
    <SummaryChips id="meeting-chips-title" className="meeting-chips" title="Meetings" href="#meetings" lead={meetingLead} count={count(meetings)} note="Yours, upcoming" chips={meetings}
      empty={waiting("No upcoming meetings assigned to you.")} more={{ href: "#meetings", label: "upcoming meetings" }} />
    <SummaryChips id="calendar-chips-title" className="calendar-chips" title="Calendar" href="#calendar" lead={calendarLead} count={count(calendar)} note="Next 7 days" chips={calendar}
      empty={waiting("Nothing scheduled in the next 7 days.")} more={{ href: "#calendar", label: "meetings this week" }} />
  </>;
}
