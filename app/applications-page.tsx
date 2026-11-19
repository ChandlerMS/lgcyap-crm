"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./applications-page.module.css";
import ApplicationSheetsPanel from "./application-sheets-panel";
import PhotoIdViewer, { type PhotoNote } from "./photo-id-viewer";
import { useEventReviews, type EventReviews, type Review } from "./event-review";
import { useExpandCollapse } from "./expand-collapse";
import PanelPager from "./panel-pager";
import ApplicationExportButton from "./application-export-button";
import { recruitingCalendarDate, resolveRecruitingPeriod } from "./recruiting-period.mjs";
import { filterApplications } from "../lib/application-filters.mjs";
import { pageWindow } from "./panel-pager.mjs";

type Row = { label: string; value: string };
export type Application = {
  id: string; at: string; day: string; name: string; preferredName: string; email: string; phone: string; city: string; state: string; zip: string;
  office: string; officeKey: string | null; license: string; startDate: string; heardAbout: string; referredBy: string;
  requirementsMet: boolean | null; missed: string[]; flags: string[]; outcome: "new-ticket" | "existing-ticket" | "contact-only" | "unknown"; outcomeText: string;
  existingContact: boolean; photoId: boolean; photos?: PhotoNote[]; sections: { title: string; rows: Row[] }[];
  ticket: { id: string; stageId: string; stage: string; url: string } | null; contact: { id: string; url: string } | null; waitingAtHiringEvent: boolean;
};
type Report = {
  fetchedAt: string; since: string; partial: boolean; summary: { total: number; met: number; notMet: number; flagged: number; waitingAtHiringEvent: number; photoId: number }; applications: Application[];
  canReview?: boolean; reviews?: Record<string, Review>; reviewComplete?: boolean; reviewNotice?: string;
};
type Status = "all" | "not-met" | "flagged" | "waiting";
// Inside Event Attendance: its review state, a number that changes whenever it should read the applications again,
// whether links leave the board's own page (which may sit in the workspace frame) for the top window, wait, true
// until the board's own first read is done, so the two HubSpot reads never run at the same moment, afterRead,
// which changes each time a board read finishes, so a failed read here tries again right after the board's next one,
// and onApplications, where to hand each loaded list (the board's name cards show an applicant's answers).
export type BoardLink = { review: EventReviews; reload: number; topWindow: boolean; wait?: boolean; afterRead?: number; onApplications?: (applications: Application[]) => void };
const SECTION_PAGE_SIZE = 10;
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const SINCE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const OUTCOMES: Record<Application["outcome"], string> = {
  "new-ticket": "New recruiting ticket created at Application",
  "existing-ticket": "Added to the person's existing recruiting ticket",
  "contact-only": "No recruiting ticket: a required item was not met",
  unknown: "Recorded in HubSpot",
};

// Every online agent application in one place for the admin team: who applied and when, any required item they did
// not meet, what needs a private conversation, where the record is now, the Approved or Denied review, and every
// answer on request. Event Attendance shows the same list as its Applications section, ten a page.
export default function ApplicationsPage({ onUnauthorized, board }: { onUnauthorized: () => void; board?: BoardLink }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [office, setOffice] = useState("all");
  const [status, setStatus] = useState<Status>("all");
  const [datePreset, setDatePreset] = useState('all');
  const [selectedDate, setSelectedDate] = useState('');
  const [dateSort, setDateSort] = useState('newest');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  // The applicant whose photo ID is open, if any.
  const [photoFor, setPhotoFor] = useState<Application | null>(null);
  // In Event Attendance the list starts collapsed under its title; it still loads, for the counts and the name cards.
  const [listOpen, setListOpen] = useState(!board);
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => { unauthorized.current = onUnauthorized; }, [onUnauthorized]);
  const handOff = useRef(board?.onApplications);
  useEffect(() => { handOff.current = board?.onApplications; });
  useEffect(() => { if (report) handOff.current?.(report.applications); }, [report]);
  const refresh = useCallback(() => { setLoading(true); setAttempt(value => value + 1); }, []);
  // The board's Refresh, and a new application in its counts, read the list again.
  const [boardReload, setBoardReload] = useState(board?.reload);
  if (board && board.reload !== boardReload) { setBoardReload(board.reload); setLoading(true); setAttempt(value => value + 1); }
  // In Event Attendance a failed read, a HubSpot rate limit say, tries again after the board's next read (each minute).
  const [boardRead, setBoardRead] = useState(board?.afterRead);
  if (board && board.afterRead !== boardRead) { setBoardRead(board.afterRead); if (error && !loading) { setLoading(true); setAttempt(value => value + 1); } }
  // On its own page the list keeps its own review state; in Event Attendance it shares the board's.
  const ownReview = useEventReviews({ reviews: report?.reviews, reviewComplete: report?.reviewComplete, canReview: report?.canReview, onSignedOut: () => unauthorized.current(), onStale: refresh });
  const reviewer = board?.review ?? ownReview;
  const waiting = board?.wait ?? false;
  // Each Refresh starts a new read; state changes only once HubSpot answers. In Event Attendance the first read
  // waits for the board's, and shows the loading message meanwhile.
  useEffect(() => {
    if (waiting) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/applications", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal });
        if (response.status === 401) { unauthorized.current(); return; }
        const result = await response.json().catch(() => null);
        if (!response.ok || !result || !Array.isArray(result.applications)) setError(result?.error?.message ?? "Applications could not be loaded from HubSpot. Try Refresh.");
        else { setReport(result as Report); setError(""); }
      } catch {
        if (!controller.signal.aborted) setError("Applications could not be loaded. Check your connection and try Refresh.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [attempt, waiting]);

  const all = report?.applications ?? [];
  const anchorDate = selectedDate || recruitingCalendarDate(report?.fetchedAt) || '';
  const period = datePreset === 'all' || !anchorDate ? null : resolveRecruitingPeriod({ preset: datePreset === 'day' ? 'date' : datePreset === 'week' ? 'weekly' : 'monthly', startDate: anchorDate }, new Date(`${anchorDate}T12:00:00Z`));
  const dateFilters = { startDate: period?.startDate ?? '', endDate: period?.endDate ?? '', sort: dateSort };
  const shown = filterApplications(all, { query, office, status, ...dateFilters }) as Application[];
  // The page lists every match; the Event Attendance section shows them ten a page.
  const view = board ? pageWindow(shown.length, page, SECTION_PAGE_SIZE) : { start: 0, end: shown.length };
  const toggle = (id: string) => setOpen(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  useExpandCollapse(expanded => { setOpen(expanded ? new Set(shown.map(item => item.id)) : new Set()); if (board) setListOpen(expanded); });
  const allOpen = shown.length > 0 && shown.every(item => open.has(item.id));
  const filter = (next: Status) => { setStatus(next); setPage(1); };
  // In Event Attendance each count opens the list filtered to it; selecting the open one again collapses the list.
  const tileOpen = (key: Status) => listOpen && status === key;
  const pickTile = (key: Status) => {
    if (!board) { filter(key === status ? "all" : key); return; }
    if (tileOpen(key)) { setListOpen(false); return; }
    filter(key); setListOpen(true);
  };
  const dated = filterApplications(all, dateFilters) as Application[];
  const summary = !report ? undefined : !period ? report.summary : { total: dated.length, met: dated.filter(item => item.requirementsMet === true).length, notMet: dated.filter(item => item.requirementsMet === false).length, flagged: dated.filter(item => item.flags.length > 0).length, waitingAtHiringEvent: dated.filter(item => item.waitingAtHiringEvent).length, photoId: dated.filter(item => item.photoId).length };
  const tiles: { key: Status; label: string; value: number | undefined; tone?: string }[] = [
    { key: "all", label: "Applications", value: summary?.total },
    { key: "not-met", label: "Did not meet a required item", value: summary?.notMet, tone: styles.bad },
    { key: "flagged", label: "Need a private conversation", value: summary?.flagged, tone: styles.warn },
    { key: "waiting", label: "Still at Hiring Event", value: summary?.waitingAtHiringEvent, tone: styles.warn },
  ];
  // From the board's own page, recruit and Applications links open in the workspace around its frame.
  const top = board?.topWindow ? { target: "_top" } : {};
  const recruitHref = (id: string) => `${board?.topWindow ? "/" : ""}#recruit/${encodeURIComponent(id)}`;
  const Title = board ? "h2" : "h1";
  const Name = board ? "h3" : "h2";

  return <section className={board ? `${styles.page} ${styles.inBoard}` : styles.page} aria-labelledby="applications-title">
    <div className={styles.head}>
      <div>
        {board
          ? <Title id="applications-title"><a className="panel-title-link" href={board.topWindow ? "/#applications" : "#applications"} {...top}>Applications</a>{summary && <span className={styles.titleCount}>{summary.total}</span>}</Title>
          : <Title id="applications-title" className="page-title" tabIndex={-1}>Applications{summary && <span className={styles.titleCount}>{summary.total}</span>}</Title>}
        <p className={styles.lede}>Online agent applications from apply.lgcyap.com, newest first{report ? ` since ${SINCE.format(Date.parse(`${report.since}T12:00:00Z`))}` : ""}. Answers are private: share them only with the hiring team.</p>
      </div>
      <div className={styles.headActions}>
        <ApplicationExportButton filters={{ query, office, status, ...dateFilters }} count={shown.length} applications={shown} reviews={reviewer.reviews} reviewComplete={report?.reviewComplete} disabled={loading || !report || report.partial} />
        {report && <span className={styles.updated}>Updated {WHEN.format(Date.parse(report.fetchedAt))}</span>}
        {board ? loading && report && <span className={styles.updated} role="status">Loading…</span> : <button type="button" className="btn btn-secondary" disabled={loading} onClick={refresh}>{loading ? "Loading…" : "Refresh"}</button>}
      </div>
    </div>
    {!board && <ApplicationSheetsPanel />}
    <div className={styles.dateFilters} aria-label="Application date filters">
      <div className={styles.datePresets} role="group" aria-label="Application date period">
        {[['all', 'All dates'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([value, label]) => <button key={value} type="button" className="btn btn-secondary" aria-pressed={datePreset === value} onClick={() => { setDatePreset(value); setPage(1); }}>{label}</button>)}
      </div>
      {datePreset !== 'all' && <label className={styles.select}><span>{datePreset === 'day' ? 'Date' : `Date in ${datePreset}`}</span><input type="date" value={anchorDate} onChange={event => { if (event.target.value) { setSelectedDate(event.target.value); setPage(1); } }} /></label>}
      <label className={styles.select}><span>Sort by date</span><select value={dateSort} onChange={event => { setDateSort(event.target.value); setPage(1); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      <p className={styles.updated} role="status">{period?.description ?? 'All dates'} · Eastern time{datePreset === 'week' ? ' · Monday–Sunday' : ''}</p>
    </div>
    {error && <div className="connection-alert" role="alert"><strong>{report ? "Showing the last loaded applications" : "Applications unavailable"}</strong><p>{error}{board ? " This list tries again after the next automatic update, within a minute." : ""}</p></div>}
    {report?.partial && <p className="partial-notice" role="status">HubSpot returned part of the applications. Refresh later for the rest.</p>}
    {/* The board shows its own review notice and errors above its lists. */}
    {!board && report?.reviewNotice && <p className="partial-notice" role="status">{report.reviewNotice}</p>}
    {!board && reviewer.error && <div className="connection-alert" role="alert"><strong>Review not saved</strong><p>{reviewer.error}</p>{reviewer.retry ? <button type="button" className="btn btn-secondary" onClick={reviewer.retry}>Retry review</button> : <button type="button" className="btn btn-secondary" disabled={loading} onClick={refresh}>Refresh statuses</button>}</div>}
    {!report && loading && <p className={styles.empty} role="status">Loading applications from HubSpot…</p>}
    {/* The counts stay in view; in Event Attendance they also open and close the list below them. */}
    {report && <div className={styles.tiles} role="group" aria-label={board ? "Show applications by status" : "Filter by status"}>
      {tiles.map(tile => <button key={tile.key} type="button" className={`${styles.tile} ${tile.tone ?? ""}`} {...board ? { "aria-expanded": tileOpen(tile.key), "aria-controls": "applications-list" } : { "aria-pressed": status === tile.key }} onClick={() => pickTile(tile.key)}>
        <strong>{tile.value ?? 0}</strong><span>{tile.label}</span>{board && <em className={styles.tileMore} aria-hidden="true">{tileOpen(tile.key) ? "Hide ▲" : "Show ▼"}</em>}
      </button>)}
    </div>}
    {report && listOpen && <div id="applications-list">
      {summary && summary.waitingAtHiringEvent > 0 && <p className={styles.callout}>{summary.waitingAtHiringEvent} applicant{summary.waitingAtHiringEvent === 1 ? "'s" : "s'"} recruiting ticket is still at Hiring Event. {"Applying doesn't move a ticket that already exists: confirm it's the same person, then move it to Application."}</p>}
      <div className={styles.filters}>
        <label className={styles.search}><span className="sr-only">Search applications</span><input type="search" placeholder="Search name, email, phone or city" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
        <label className={styles.select}><span>Office</span><select value={office} onChange={event => { setOffice(event.target.value); setPage(1); }}><option value="all">All offices</option><option value="orlando">Orlando</option><option value="miami">Miami</option><option value="tampa">Tampa</option><option value="other">Not recorded</option></select></label>
        <label className={styles.select}><span>Status</span><select value={status} onChange={event => filter(event.target.value as Status)}><option value="all">All</option><option value="not-met">Did not meet a required item</option><option value="flagged">Need a private conversation</option><option value="waiting">Still at Hiring Event</option></select></label>
        <button type="button" className="btn btn-quiet" disabled={!shown.length || allOpen} onClick={() => setOpen(value => new Set([...value, ...shown.map(item => item.id)]))}>Expand all</button>
        <button type="button" className="btn btn-quiet" disabled={!shown.some(item => open.has(item.id))} onClick={() => setOpen(new Set())}>Collapse all</button>
      </div>
      <p className={styles.resultCount} role="status">{shown.length === all.length ? `${all.length} application${all.length === 1 ? "" : "s"}` : `${shown.length} of ${all.length} applications`}</p>
      {!shown.length ? <p className={styles.empty}>{all.length ? "No applications match these filters." : "No online applications yet."}</p> : <ol className={styles.list}>
        {shown.slice(view.start, view.end).map(item => {
          const expanded = open.has(item.id);
          const location = [item.city, [item.state, item.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
          return <li key={item.id} className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.who}>
                <Name>{item.name || "Name not recorded"}{item.preferredName && <span className={styles.preferred}> ({item.preferredName})</span>}</Name>
                <p className={styles.when}>Applied {WHEN.format(Date.parse(item.at))} ET</p>
              </div>
              <div className={styles.headSide}>
                <div className={styles.badges}>
                  {item.requirementsMet === false && <span className={`${styles.badge} ${styles.bad}`}>Did not meet {item.missed.length || ""} required item{item.missed.length === 1 ? "" : "s"}</span>}
                  {item.flags.length > 0 && <span className={`${styles.badge} ${styles.warn}`}>Private conversation: {item.flags.length}</span>}
                  {item.waitingAtHiringEvent && <span className={`${styles.badge} ${styles.warn}`}>Still at Hiring Event</span>}
                </div>
                {reviewer.actions({ ticketId: item.ticket?.id ?? null, name: item.name || "this applicant" })}
              </div>
            </div>
            <dl className={styles.facts}>
              <div><dt>Office</dt><dd>{item.office || "Not recorded"}</dd></div>
              <div><dt>License</dt><dd>{item.license || "Not recorded"}</dd></div>
              <div><dt>Email</dt><dd>{item.email ? <a href={`mailto:${item.email}`}>{item.email}</a> : "Not recorded"}</dd></div>
              <div><dt>Phone</dt><dd>{item.phone ? <a href={`tel:${item.phone.replace(/[^\d+]/g, "")}`}>{item.phone}</a> : "Not recorded"}</dd></div>
              <div><dt>Location</dt><dd>{location || "Not recorded"}</dd></div>
              <div><dt>Earliest start</dt><dd>{item.startDate || "Not answered"}</dd></div>
              <div><dt>Recruiting record</dt><dd>{item.ticket ? item.ticket.stage : item.outcome === "contact-only" ? "Contact only" : "Not linked"}</dd></div>
              <div><dt>Photo ID</dt><dd>{item.photos?.length ? <>{item.photos.some(photo => photo.source === "application") ? "Attached" : "From sign-in"} · <button type="button" className={styles.linkButton} onClick={() => setPhotoFor(item)}>View<span className="sr-only"> photo ID for {item.name || "this applicant"}</span></button></> : "Not attached"}</dd></div>
            </dl>
            <div className={styles.actions}>
              <button type="button" className="btn btn-secondary" aria-expanded={expanded} aria-controls={`application-${item.id}`} onClick={() => toggle(item.id)}>{expanded ? "Hide answers" : "View all answers"}</button>
              {Boolean(item.photos?.length) && <button type="button" className="btn btn-secondary" onClick={() => setPhotoFor(item)}>View photo ID</button>}
              {item.ticket && <a className="btn btn-quiet" href={recruitHref(item.ticket.id)} {...top}>Open recruit</a>}
              {item.ticket && <a className="btn btn-quiet" href={item.ticket.url} target="_blank" rel="noopener noreferrer">HubSpot ticket<span className="sr-only"> (opens in a new tab)</span></a>}
              {item.contact && <a className="btn btn-quiet" href={item.contact.url} target="_blank" rel="noopener noreferrer">HubSpot contact<span className="sr-only"> (opens in a new tab)</span></a>}
            </div>
            {expanded && <div id={`application-${item.id}`} className={styles.answers}>
              <div className={styles.review}>
                {item.requirementsMet === false && <div><h3>Required items not met</h3>{item.missed.length ? <ul>{item.missed.map(text => <li key={text}>{text}</li>)}</ul> : <p>Not recorded.</p>}</div>}
                <div><h3>Needs a private conversation</h3>{item.flags.length ? <ul>{item.flags.map(text => <li key={text}>{text}</li>)}</ul> : <p>Nothing flagged.</p>}</div>
                <div><h3>In HubSpot</h3><p>{item.outcomeText || OUTCOMES[item.outcome]}</p>{item.existingContact && <p className={styles.muted}>The email matched an existing contact, which wasn&apos;t changed. Confirm details with the person before updating it.</p>}</div>
              </div>
              {item.sections.map(section => <section key={section.title} className={styles.section}>
                <h3>{section.title}</h3>
                <dl>{section.rows.map((row, index) => <div key={`${row.label}-${index}`} className={row.value === "Not answered" ? styles.unanswered : undefined}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
              </section>)}
            </div>}
          </li>;
        })}
      </ol>}
      {board && <PanelPager count={shown.length} page={page} size={SECTION_PAGE_SIZE} label="Applications" onPage={setPage} numbers />}
    </div>}
    {photoFor?.photos?.length ? <PhotoIdViewer key={photoFor.id} photos={photoFor.photos} name={photoFor.name || "this applicant"} onClose={() => setPhotoFor(null)} /> : null}
  </section>;
}
