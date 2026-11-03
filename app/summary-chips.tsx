"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fitFollowUpChips } from "./recruit-follow-up.mjs";

// badge is the short gold value on the chip; detail is its spoken and hover form. external links open in a new tab.
export type SummaryChip = { id: string; href?: string; external?: boolean; name: string; badge?: string; detail: string };
type More = { href?: string; external?: boolean; label: string };
type Props = { id: string; title: string; count?: string; note: string; chips: readonly SummaryChip[]; empty: ReactNode; more: More; className?: string };
const RENDERED = 24;
const newTab = (external?: boolean) => external ? { target: "_blank", rel: "noopener noreferrer" } : {};
// Chips beside the Today totals, trimmed to the rows set by --chip-rows and ending in a "+N more" count.
export default function SummaryChips({ id, title, count, note, chips, empty, more, className }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const [fit, setFit] = useState(RENDERED);
  const rowKey = chips.slice(0, RENDERED).map(chip => `${chip.id}:${chip.badge ?? ""}`).join(",") + `/${chips.length}`;
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
      setFit(fitFollowUpChips(widths, moreWidth, measuredWidth, parseFloat(style.columnGap) || 0, Number(style.getPropertyValue("--chip-rows")) || 2, chips.length));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
    // rowKey captures every input to the measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey]);
  const shown = Math.min(fit, chips.length), rest = chips.length - shown;
  const moreText = <>+{rest} more<span className="sr-only"> {more.label}</span></>;
  return <section className={`summary-chips${className ? ` ${className}` : ""}`} aria-labelledby={id}>
    <div className="summary-chips-heading"><h2 id={id}>{title}{count && <span>{count}</span>}</h2><span className="muted">{note}</span></div>
    {!chips.length ? <p className="summary-chips-empty muted">{empty}</p> : <ul className="summary-chip-list" ref={listRef}>
      {chips.slice(0, RENDERED).map((chip, index) => {
        const label = <><span className="summary-chip-name">{chip.name}</span>{chip.badge && <span className="summary-chip-badge" aria-hidden="true">{chip.badge}</span>}<span className="sr-only">, {chip.detail}</span></>;
        return <li key={chip.id} data-chip className={index < shown ? undefined : "is-overflow"}>{chip.href ? <a className="summary-chip" href={chip.href} title={`${chip.name}, ${chip.detail}`} {...newTab(chip.external)}>{label}</a> : <span className="summary-chip" title={`${chip.name}, ${chip.detail}`}>{label}</span>}</li>;
      })}
      <li data-more className={rest > 0 ? undefined : "is-overflow"}>{more.href ? <a className="summary-chip summary-chip-more" href={more.href} {...newTab(more.external)}>{moreText}</a> : <span className="summary-chip summary-chip-more">{moreText}</span>}</li>
    </ul>}
  </section>;
}
