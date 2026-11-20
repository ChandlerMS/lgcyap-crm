"use client";
import type { ReactNode } from "react";
import { SectionToggle, useCollapsibleCards, useDashboardCollapse } from "./dashboard-section";
import SummaryPreview from "./summary-preview";

// badge is the short gold value on a row; detail is its spoken and hover form; previewDetail is a fuller line for
// the title's hover preview. external links open in a new tab.
// facts and actions fill the item's row in the hover list: its details as label and value, and buttons such as Call or Add Note.
// onSelect makes the item a button instead of a link, e.g. an Email card recruit that opens New Email.
export type SummaryChip = { id: string; href?: string; external?: boolean; name: string; badge?: string; detail: string; previewDetail?: string; facts?: readonly (readonly [string, string])[]; actions?: ReactNode; previewAction?: ReactNode; onSelect?: () => void; previewOnSelect?: () => void };
type More = { href?: string; external?: boolean; label: string };
// href makes the title open its own page; hovering or focusing the title then previews the first few items.
// lead is the card's gold plus that adds a task, follow-up or meeting. previewActions are buttons inside the hover
// preview, e.g. Add Note, Add Task, Add Follow-Up, Add Meeting and Add to Calendar.
// preview opens the hover list even without a page to link to (Email); previewChips lists other items there than the card's;
// previewExtra comes first in the pop-up (Calendar's calendar), in a pop-up previewWidth wide. onTitleClick makes the title
// a button when there is no page to open (Email opens New Email).
type Props = { id: string; title: string; count?: string; note: string; chips: readonly SummaryChip[]; empty: ReactNode; more: More; className?: string; href?: string; lead?: ReactNode; previewActions?: ReactNode; preview?: boolean; previewChips?: readonly SummaryChip[]; previewExtra?: ReactNode; previewWidth?: number; onTitleClick?: () => void; previewBody?: ReactNode; previewPersist?: boolean; onPreviewClose?: () => void; previewTall?: boolean; previewOpenLink?: boolean };
const ROWS = 3;
const newTab = (external?: boolean) => external ? { target: "_blank", rel: "noopener noreferrer" } : {};
// A compact dashboard card: title and count with its plus, a one-line note, the next few items, then "+N more".
// Among the dashboard's collapsible cards it also has a chevron that folds it to its title row.
export default function SummaryChips({ id, title, count, note, chips, empty, more, className, href, lead, previewActions, preview = false, previewChips, previewExtra, previewWidth, onTitleClick, previewBody, previewPersist, onPreviewClose, previewTall, previewOpenLink = true }: Props) {
  const collapsible = useCollapsibleCards();
  const { collapsed: folded, toggle } = useDashboardCollapse(`card:${id}`);
  const collapsed = collapsible && folded;
  const rest = Math.max(0, chips.length - ROWS);
  const moreHref = more.href ?? href;
  const moreText = <>+{rest} more<span className="sr-only"> {more.label}</span></>;
  const listed = Boolean(href) || preview;
  const items = previewChips ?? chips;
  // Hovering the title opens every item, not just the first few, each with its details, link and actions.
  const heading = <SummaryPreview id={`${id}-preview`} enabled={listed} width={previewWidth} persist={previewPersist} onClose={onPreviewClose} tall={previewTall} heading={
      <h2 id={id} tabIndex={!href && !onTitleClick && listed ? 0 : undefined}>{href ? <a className="summary-chips-link" href={href}>{title}<span className="sr-only"> page</span></a> : onTitleClick ? <button type="button" className="summary-chips-link summary-title-button" onClick={onTitleClick}>{title}</button> : title}{count && <span className="summary-card-count">{count}</span>}</h2>}>
      {listed && <>
        <div className="summary-preview-head"><p className="summary-preview-title">{title}{count ? ` · ${count}` : ""}</p>{href && previewOpenLink && <a className="text-link summary-preview-open" href={href}>Open {title}</a>}</div>
        {previewBody ?? <>
        {previewExtra}
        {previewActions}
        {items.length ? <ul className="summary-preview-list">{items.map(chip => <li key={chip.id}>
          <div className="summary-preview-row">{(chip.previewOnSelect ?? chip.onSelect) ? <button type="button" className="summary-preview-select" onClick={chip.previewOnSelect ?? chip.onSelect}>{chip.name}</button> : chip.href ? <a href={chip.href} {...newTab(chip.external)}>{chip.name}{chip.external && <span className="sr-only"> (opens in HubSpot)</span>}</a> : <span>{chip.name}</span>}{chip.previewAction ?? (chip.badge && <span className="summary-card-badge">{chip.badge}</span>)}</div>
          {chip.facts?.length ? <dl className="summary-preview-facts">{chip.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <span className="muted">{chip.previewDetail ?? chip.detail}</span>}
          {chip.actions && <div className="summary-preview-actions">{chip.actions}</div>}
        </li>)}</ul> : <p className="muted">{empty}</p>}
        </>}
      </>}
    </SummaryPreview>;
  return <section id={`${id}-card`} className={`summary-chips summary-card${className ? ` ${className}` : ""}${collapsed ? " is-collapsed" : ""}`} aria-labelledby={id}>
    <div className="summary-card-head">{heading}{lead && <div className="summary-card-add">{lead}</div>}{collapsible && <SectionToggle collapsed={collapsed} onToggle={toggle} label={title} controls={`${id}-card`} />}</div>
    <p className="summary-card-note">{note}</p>
    {!chips.length ? <p className="summary-card-empty">{empty}</p> : <ul className="summary-card-list">
      {chips.slice(0, ROWS).map(chip => {
        const label = <><span className="summary-card-name">{chip.name}</span>{chip.badge && <span className="summary-card-badge" aria-hidden="true">{chip.badge}</span>}<span className="sr-only">, {chip.detail}</span></>;
        return <li key={chip.id}>{chip.onSelect ? <button type="button" className="summary-card-select" title={`${chip.name}, ${chip.detail}`} onClick={chip.onSelect}>{label}</button> : chip.href ? <a href={chip.href} title={`${chip.name}, ${chip.detail}`} {...newTab(chip.external)}>{label}</a> : <span title={`${chip.name}, ${chip.detail}`}>{label}</span>}</li>;
      })}
    </ul>}
    {rest > 0 && (moreHref ? <a className="summary-card-more" href={moreHref} {...newTab(more.href ? more.external : false)}>{moreText}</a> : <span className="summary-card-more">{moreText}</span>)}
  </section>;
}
