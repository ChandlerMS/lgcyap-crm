"use client";
import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { fitFollowUpChips, followUpRecruits } from "./recruit-follow-up.mjs";
import type { PipelineRecruit } from "./recruit-pipeline";

type Row = PipelineRecruit & { daysWaiting: number };
const RENDERED = 24;
// Same page as the full table, so jump to it without a hash change (hash changes route the workspace).
function showFullList(event: MouseEvent<HTMLAnchorElement>) {
  const title = document.getElementById("follow-up-title");
  if (!title) return;
  event.preventDefault();
  title.focus({ preventScroll: true });
  title.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
// Header summary of Follow Up: longest-waiting names first, trimmed to the rows set by --chip-rows, ending in a link to the full list.
export default function RecruitFollowUpChips({ records, now, partial }: { records: readonly PipelineRecruit[]; now: number; partial?: boolean }) {
  const rows = followUpRecruits(records, now) as Row[];
  const listRef = useRef<HTMLUListElement>(null);
  const [fit, setFit] = useState(RENDERED);
  const rowKey = rows.slice(0, RENDERED).map(row => `${row.id}:${row.daysWaiting}`).join(",") + `/${rows.length}`;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let measuredWidth = -1;
    const measure = () => {
      if (list.clientWidth === measuredWidth) return;
      measuredWidth = list.clientWidth;
      const style = getComputedStyle(list);
      const widths = Array.from(list.querySelectorAll<HTMLElement>("[data-chip]"), chip => chip.offsetWidth);
      // Leave a digit of slack: the more chip's count changes after this measurement.
      const moreWidth = (list.querySelector<HTMLElement>("[data-more]")?.offsetWidth ?? 0) + 12;
      setFit(fitFollowUpChips(widths, moreWidth, measuredWidth, parseFloat(style.columnGap) || 0, Number(style.getPropertyValue("--chip-rows")) || 2, rows.length));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
    // rowKey captures every input to the measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey]);
  const shown = Math.min(fit, rows.length), rest = rows.length - shown;
  return <section className="follow-up-chips" aria-labelledby="follow-up-chips-title">
    <div className="follow-up-chips-heading"><h2 id="follow-up-chips-title">Follow up <span>{rows.length}{partial ? "+" : ""}</span></h2><span className="muted">15+ days without contact</span></div>
    {!rows.length ? <p className="follow-up-chips-empty muted">No one is waiting more than 15 days.</p> : <ul className="follow-up-chip-list" ref={listRef}>
      {rows.slice(0, RENDERED).map((row, index) => {
        const name = row.name || [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unnamed recruit";
        return <li key={row.id} data-chip className={index < shown ? undefined : "is-overflow"}><a className="follow-up-chip" href={`#recruit/${encodeURIComponent(row.id)}`} title={`${name}, ${row.daysWaiting} days waiting`}><span className="follow-up-chip-name">{name}</span><span className="follow-up-chip-days" aria-hidden="true">{row.daysWaiting}d</span><span className="sr-only">, {row.daysWaiting} days waiting</span></a></li>;
      })}
      <li data-more className={rest > 0 ? undefined : "is-overflow"}><a className="follow-up-chip follow-up-chip-more" href="#follow-up" onClick={showFullList}>+{rest} more<span className="sr-only"> in the full Follow Up list</span></a></li>
    </ul>}
  </section>;
}
