"use client";
import type { ReactNode } from "react";
import { SectionToggle, useCollapsibleCards, useDashboardCollapse } from "./dashboard-section";
import SummaryPreview from "./summary-preview";

// badge is the short gold value on a row; detail is its spoken and hover form; previewDetail is a fuller line for
// the title's hover preview. external links open in a new tab.
export type SummaryChip = { id: string; href?: string; external?: boolean; name: string; badge?: string; detail: string; previewDetail?: string };
type More = { href?: string; external?: boolean; label: string };
// href makes the title open its own page; hovering or focusing the title then previews the first few items.
// lead is the card's gold plus that adds a task, follow-up or meeting. previewActions are buttons inside the hover
// preview, e.g. Add Note, Add Task, Add Follow-Up, Add Meeting and Add to Calendar.
type Props = { id: string; title: string; count?: string; note: string; chips: readonly SummaryChip[]; empty: ReactNode; more: More; className?: string; href?: string; lead?: ReactNode; previewActions?: ReactNode };
const ROWS = 3;
const PREVIEW = 6;
const newTab = (external?: boolean) => external ? { target: "_blank", rel: "noopener noreferrer" } : {};
// A compact dashboard card: title and count with its plus, a one-line note, the next few items, then "+N more".
// Among the dashboard's collapsible cards it also has a chevron that folds it to its title row.
export default function SummaryChips({ id, title, count, note, chips, empty, more, className, href, lead, previewActions }: Props) {
  const collapsible = useCollapsibleCards();
  const { collapsed: folded, toggle } = useDashboardCollapse(`card:${id}`);
  const collapsed = collapsible && folded;
  const rest = Math.max(0, chips.length - ROWS);
  const moreHref = more.href ?? href;
  const moreText = <>+{rest} more<span className="sr-only"> {more.label}</span></>;
  const heading = <SummaryPreview id={`${id}-preview`} enabled={Boolean(href)} heading={
      <h2 id={id}>{href ? <a className="summary-chips-link" href={href}>{title}<span className="sr-only"> page</span></a> : title}{count && <span className="summary-card-count">{count}</span>}</h2>}>
      {href && <>
        <p className="summary-preview-title">{title}{count ? ` · ${count}` : ""}</p>
        {chips.length ? <ul>{chips.slice(0, PREVIEW).map(chip => <li key={chip.id}>{chip.href ? <a href={chip.href} {...newTab(chip.external)}>{chip.name}</a> : <span>{chip.name}</span>}<span className="muted">{chip.previewDetail ?? chip.detail}</span></li>)}</ul> : <p className="muted">{empty}</p>}
        {chips.length > PREVIEW && <p className="muted">+{chips.length - PREVIEW} more</p>}
        {previewActions}
        <a className="text-link summary-preview-open" href={href}>Open {title}</a>
      </>}
    </SummaryPreview>;
  return <section id={`${id}-card`} className={`summary-chips summary-card${className ? ` ${className}` : ""}${collapsed ? " is-collapsed" : ""}`} aria-labelledby={id}>
    <div className="summary-card-head">{heading}{lead && <div className="summary-card-add">{lead}</div>}{collapsible && <SectionToggle collapsed={collapsed} onToggle={toggle} label={title} controls={`${id}-card`} />}</div>
    <p className="summary-card-note">{note}</p>
    {!chips.length ? <p className="summary-card-empty">{empty}</p> : <ul className="summary-card-list">
      {chips.slice(0, ROWS).map(chip => {
        const label = <><span className="summary-card-name">{chip.name}</span>{chip.badge && <span className="summary-card-badge" aria-hidden="true">{chip.badge}</span>}<span className="sr-only">, {chip.detail}</span></>;
        return <li key={chip.id}>{chip.href ? <a href={chip.href} title={`${chip.name}, ${chip.detail}`} {...newTab(chip.external)}>{label}</a> : <span title={`${chip.name}, ${chip.detail}`}>{label}</span>}</li>;
      })}
    </ul>}
    {rest > 0 && (moreHref ? <a className="summary-card-more" href={moreHref} {...newTab(more.href ? more.external : false)}>{moreText}</a> : <span className="summary-card-more">{moreText}</span>)}
  </section>;
}
