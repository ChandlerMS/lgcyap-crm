"use client";
import { useId } from "react";
import { pageWindow } from "./panel-pager.mjs";

type Props = {
  count: number; page: number; size: number; label: string;
  onPage: (page: number) => void;
  // Optional rows-per-page menu, e.g. Meetings: 5, 10, 15, 20 or 25.
  sizes?: readonly number[]; onSize?: (size: number) => void;
  // Shown after the count when only part of the records is loaded, e.g. "of 2,619".
  totalNote?: string;
};

// Page number, the rows shown, Previous and Next for a dashboard panel. Always shown when the panel has rows.
export default function PanelPager({ count, page, size, label, onPage, sizes, onSize, totalNote }: Props) {
  const id = useId();
  const view = pageWindow(count, page, size);
  if (!view.rows) return null;
  return <nav className="panel-pager" aria-label={`${label} pages`}>
    <span className="panel-pager-count" aria-live="polite"><strong>Page {view.page} of {view.pages}</strong> · {view.start + 1}–{view.end} of {view.rows.toLocaleString("en-US")}{totalNote ? ` ${totalNote}` : ""}</span>
    <div className="panel-pager-controls">
      {sizes && onSize && <label className="panel-pager-size" htmlFor={id}>Rows<select id={id} value={size} onChange={event => { onSize(Number(event.target.value)); onPage(1); }}>{sizes.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
      <button type="button" className="btn btn-secondary" disabled={view.page <= 1} onClick={() => onPage(view.page - 1)}>Previous<span className="sr-only"> page of {label}</span></button>
      <button type="button" className="btn btn-secondary" disabled={view.page >= view.pages} onClick={() => onPage(view.page + 1)}>Next<span className="sr-only"> page of {label}</span></button>
    </div>
  </nav>;
}
