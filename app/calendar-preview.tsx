"use client";
import { useMemo, useState } from "react";
import { hubspotHref } from "./recruit-task-chips.mjs";

export type CalendarMeeting = { id: string; title: string; status?: string | null; subtitle?: string | null; owner?: string | null; scheduledAt?: string | null; endedAt?: string | null; hubspotUrl?: string };
type Mode = "day" | "week" | "month";

// Every date here is an Eastern calendar day as YYYY-MM-DD, the office's calendar.
const ZONE = "America/New_York";
const KEY = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" });
const MONTH = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
const SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MODES: [Mode, string][] = [["day", "Day"], ["week", "Week"], ["month", "Month"]];
const MONTH_CELL_LIMIT = 2;

const noon = (key: string) => Date.parse(`${key}T12:00:00Z`);
const addDays = (key: string, days: number) => new Date(noon(key) + days * 86_400_000).toISOString().slice(0, 10);
const weekStart = (key: string) => addDays(key, -new Date(noon(key)).getUTCDay());
const addMonths = (key: string, months: number) => { const [year, month] = key.split("-").map(Number); return new Date(Date.UTC(year, month - 1 + months, 1, 12)).toISOString().slice(0, 10); };
const validKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(noon(value));

/**
 * The Calendar card's calendar: the loaded HubSpot meetings by day, week or month, Eastern time. Previous, Today and
 * Next move by the chosen view, the date box jumps to any date past or future, and selecting a day opens it.
 */
export default function CalendarPreview({ meetings, now, status }: { meetings: readonly CalendarMeeting[]; now: number; status?: string }) {
  // The dashboard's clock, or this calendar's first render if it has none yet.
  const [openedAt] = useState(() => Date.now());
  const today = KEY.format(Number.isFinite(now) && now > 0 ? now : openedAt);
  const [mode, setMode] = useState<Mode>("month");
  const [focus, setFocus] = useState(today);
  const byDay = useMemo(() => {
    const days = new Map<string, { meeting: CalendarMeeting; at: number }[]>();
    for (const meeting of meetings) {
      const at = Date.parse(meeting.scheduledAt ?? "");
      if (!meeting?.id || !Number.isFinite(at)) continue;
      const key = KEY.format(at);
      days.set(key, [...(days.get(key) ?? []), { meeting, at }]);
    }
    for (const list of days.values()) list.sort((a, b) => a.at - b.at);
    return days;
  }, [meetings]);
  const shift = (direction: number) => setFocus(mode === "month" ? addMonths(focus, direction) : addDays(focus, direction * (mode === "week" ? 7 : 1)));
  const openDay = (key: string) => { setFocus(key); setMode("day"); };
  const first = mode === "month" ? weekStart(`${focus.slice(0, 8)}01`) : weekStart(focus);
  const lastOfMonth = addDays(addMonths(focus, 1), -1);
  const weeks = mode === "month" ? Math.ceil((noon(lastOfMonth) - noon(first)) / 86_400_000 / 7 + 1 / 7) : 1;
  const cells = Array.from({ length: weeks * 7 }, (_, index) => addDays(first, index));
  const title = mode === "month" ? MONTH.format(noon(focus)) : mode === "week" ? `${SHORT.format(noon(first))} – ${SHORT.format(noon(addDays(first, 6)))}, ${addDays(first, 6).slice(0, 4)}` : DAY.format(noon(focus));
  const link = (meeting: CalendarMeeting, label: string) => {
    const href = hubspotHref(meeting.hubspotUrl);
    return href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}<span className="sr-only"> (opens in HubSpot)</span></a> : <span>{label}</span>;
  };
  const dayMeetings = byDay.get(focus) ?? [];

  return <section className="cal-preview" aria-label="Calendar">
    <div className="cal-preview-bar">
      <div className="cal-preview-modes" role="group" aria-label="Calendar view">{MODES.map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div>
      <div className="cal-preview-nav">
        <button type="button" aria-label={`Previous ${mode}`} onClick={() => shift(-1)}>‹</button>
        <button type="button" onClick={() => setFocus(today)} disabled={focus === today}>Today</button>
        <button type="button" aria-label={`Next ${mode}`} onClick={() => shift(1)}>›</button>
        <label className="cal-preview-date"><span className="sr-only">Go to date</span><input type="date" value={focus} min="2000-01-01" max="2100-12-31" onChange={event => { if (validKey(event.target.value)) { setFocus(event.target.value); event.target.blur(); } }} /></label>
      </div>
    </div>
    <p className="cal-preview-title" aria-live="polite">{title}</p>
    {status && <p className="muted cal-preview-status">{status}</p>}

    {mode === "day" ? <div className="cal-preview-day">
      {dayMeetings.length ? <ul>{dayMeetings.map(({ meeting, at }) => {
        const ends = Date.parse(meeting.endedAt ?? "");
        return <li key={meeting.id}>
          <span className="cal-preview-time">{TIME.format(at)}{Number.isFinite(ends) && ends > at ? ` – ${TIME.format(ends)}` : ""}</span>
          <div>{link(meeting, meeting.title || "Meeting")}<span className="muted">{[meeting.status, meeting.subtitle, meeting.owner].filter(Boolean).join(" · ") || "No details recorded"}</span></div>
        </li>;
      })}</ul> : <p className="muted">No meetings on this day.</p>}
    </div> : <div className={`cal-preview-grid ${mode === "week" ? "is-week" : ""}`}>
      {WEEKDAYS.map(name => <span key={name} className="cal-preview-weekday">{name}</span>)}
      {cells.map(key => {
        const list = byDay.get(key) ?? [];
        const shown = mode === "month" ? list.slice(0, MONTH_CELL_LIMIT) : list;
        const outside = mode === "month" && key.slice(0, 7) !== focus.slice(0, 7);
        return <div key={key} className={`cal-preview-cell${outside ? " is-outside" : ""}${key === today ? " is-today" : ""}`}>
          <button type="button" className="cal-preview-date-button" aria-label={`${DAY.format(noon(key))}: ${list.length} meeting${list.length === 1 ? "" : "s"}. Open the day.`} onClick={() => openDay(key)}>{mode === "week" ? `${WEEKDAY.format(noon(key))} ${Number(key.slice(8))}` : Number(key.slice(8))}</button>
          {shown.map(({ meeting, at }) => <div key={meeting.id} className="cal-preview-event"><span>{TIME.format(at)}</span>{link(meeting, meeting.title || "Meeting")}</div>)}
          {list.length > shown.length && <button type="button" className="cal-preview-more" onClick={() => openDay(key)}>+{list.length - shown.length} more</button>}
        </div>;
      })}
    </div>}
  </section>;
}
