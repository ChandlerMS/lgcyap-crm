"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./applications-page.module.css";

type Row = { label: string; value: string };
type Application = {
  id: string; at: string; day: string; name: string; preferredName: string; email: string; phone: string; city: string; state: string; zip: string;
  office: string; officeKey: string | null; license: string; startDate: string; heardAbout: string; referredBy: string;
  requirementsMet: boolean | null; missed: string[]; flags: string[]; outcome: "new-ticket" | "existing-ticket" | "contact-only" | "unknown"; outcomeText: string;
  existingContact: boolean; photoId: boolean; sections: { title: string; rows: Row[] }[];
  ticket: { id: string; stageId: string; stage: string; url: string } | null; contact: { id: string; url: string } | null; waitingAtHiringEvent: boolean;
};
type Report = { fetchedAt: string; since: string; partial: boolean; summary: { total: number; met: number; notMet: number; flagged: number; waitingAtHiringEvent: number; photoId: number }; applications: Application[] };
type Status = "all" | "met" | "not-met" | "flagged" | "waiting";
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const SINCE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const OUTCOMES: Record<Application["outcome"], string> = {
  "new-ticket": "New recruiting ticket created at Application",
  "existing-ticket": "Added to the person's existing recruiting ticket",
  "contact-only": "No recruiting ticket: a required item was not met",
  unknown: "Recorded in HubSpot",
};
const matches = (item: Application, search: string) => !search || [item.name, item.preferredName, item.email, item.phone, item.city].some(value => value.toLowerCase().includes(search));

// Every online agent application in one place for the admin team: who applied and when, whether they meet the
// required items, what needs a private conversation, where the record is now, and every answer on request.
export default function ApplicationsPage({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [office, setOffice] = useState("all");
  const [status, setStatus] = useState<Status>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => { unauthorized.current = onUnauthorized; }, [onUnauthorized]);
  // Each Refresh starts a new read; state changes only once HubSpot answers.
  useEffect(() => {
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
  }, [attempt]);
  const refresh = useCallback(() => { setLoading(true); setAttempt(value => value + 1); }, []);

  const search = query.trim().toLowerCase();
  const all = report?.applications ?? [];
  const shown = all.filter(item => matches(item, search) && (office === "all" || (item.officeKey ?? "other") === office)
    && (status === "all" || (status === "met" && item.requirementsMet === true) || (status === "not-met" && item.requirementsMet === false) || (status === "flagged" && item.flags.length > 0) || (status === "waiting" && item.waitingAtHiringEvent)));
  const toggle = (id: string) => setOpen(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allOpen = shown.length > 0 && shown.every(item => open.has(item.id));
  const summary = report?.summary;
  const tiles: { key: Status; label: string; value: number | undefined; tone?: string }[] = [
    { key: "all", label: "Applications", value: summary?.total },
    { key: "met", label: "Meet the required items", value: summary?.met, tone: styles.good },
    { key: "not-met", label: "Did not meet a required item", value: summary?.notMet, tone: styles.bad },
    { key: "flagged", label: "Need a private conversation", value: summary?.flagged, tone: styles.warn },
    { key: "waiting", label: "Still at Hiring Event", value: summary?.waitingAtHiringEvent, tone: styles.warn },
  ];

  return <section className={styles.page} aria-labelledby="applications-title">
    <div className={styles.head}>
      <div>
        <h1 id="applications-title" className="page-title" tabIndex={-1}>Applications{summary && <span className={styles.titleCount}>{summary.total}</span>}</h1>
        <p className={styles.lede}>Online agent applications from apply.lgcyap.com, newest first{report ? ` since ${SINCE.format(Date.parse(`${report.since}T12:00:00Z`))}` : ""}. Answers are private: share them only with the hiring team.</p>
      </div>
      <div className={styles.headActions}>
        {report && <span className={styles.updated}>Updated {WHEN.format(Date.parse(report.fetchedAt))}</span>}
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={refresh}>{loading ? "Loading…" : "Refresh"}</button>
      </div>
    </div>
    {error && <div className="connection-alert" role="alert"><strong>{report ? "Showing the last loaded applications" : "Applications unavailable"}</strong><p>{error}</p></div>}
    {report?.partial && <p className="partial-notice" role="status">HubSpot returned part of the applications. Refresh later for the rest.</p>}
    {!report && loading && <p className={styles.empty} role="status">Loading applications from HubSpot…</p>}
    {report && <>
      <div className={styles.tiles} role="group" aria-label="Filter by status">
        {tiles.map(tile => <button key={tile.key} type="button" className={`${styles.tile} ${tile.tone ?? ""}`} aria-pressed={status === tile.key} onClick={() => setStatus(tile.key === status ? "all" : tile.key)}>
          <strong>{tile.value ?? 0}</strong><span>{tile.label}</span>
        </button>)}
      </div>
      {summary && summary.waitingAtHiringEvent > 0 && <p className={styles.callout}>{summary.waitingAtHiringEvent} applicant{summary.waitingAtHiringEvent === 1 ? "'s" : "s'"} recruiting ticket is still at Hiring Event. {"Applying doesn't move a ticket that already exists: confirm it's the same person, then move it to Application."}</p>}
      <div className={styles.filters}>
        <label className={styles.search}><span className="sr-only">Search applications</span><input type="search" placeholder="Search name, email, phone or city" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label className={styles.select}><span>Office</span><select value={office} onChange={event => setOffice(event.target.value)}><option value="all">All offices</option><option value="orlando">Orlando</option><option value="miami">Miami</option><option value="tampa">Tampa</option><option value="other">Not recorded</option></select></label>
        <label className={styles.select}><span>Status</span><select value={status} onChange={event => setStatus(event.target.value as Status)}><option value="all">All</option><option value="met">Meet the required items</option><option value="not-met">Did not meet a required item</option><option value="flagged">Need a private conversation</option><option value="waiting">Still at Hiring Event</option></select></label>
        <button type="button" className="btn btn-quiet" disabled={!shown.length} onClick={() => setOpen(allOpen ? new Set() : new Set(shown.map(item => item.id)))}>{allOpen ? "Collapse all" : "Expand all"}</button>
      </div>
      <p className={styles.resultCount} role="status">{shown.length === all.length ? `${all.length} application${all.length === 1 ? "" : "s"}` : `${shown.length} of ${all.length} applications`}</p>
      {!shown.length ? <p className={styles.empty}>{all.length ? "No applications match these filters." : "No online applications yet."}</p> : <ol className={styles.list}>
        {shown.map(item => {
          const expanded = open.has(item.id);
          const location = [item.city, [item.state, item.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
          return <li key={item.id} className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.who}>
                <h2>{item.name || "Name not recorded"}{item.preferredName && <span className={styles.preferred}> ({item.preferredName})</span>}</h2>
                <p className={styles.when}>Applied {WHEN.format(Date.parse(item.at))} ET</p>
              </div>
              <div className={styles.badges}>
                {item.requirementsMet === true && <span className={`${styles.badge} ${styles.good}`}>Meets required items</span>}
                {item.requirementsMet === false && <span className={`${styles.badge} ${styles.bad}`}>Did not meet {item.missed.length || ""} required item{item.missed.length === 1 ? "" : "s"}</span>}
                {item.flags.length > 0 && <span className={`${styles.badge} ${styles.warn}`}>Private conversation: {item.flags.length}</span>}
                {item.waitingAtHiringEvent && <span className={`${styles.badge} ${styles.warn}`}>Still at Hiring Event</span>}
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
              <div><dt>Photo ID</dt><dd>{item.photoId ? "Attached (private, in HubSpot)" : "Not attached"}</dd></div>
            </dl>
            <div className={styles.actions}>
              <button type="button" className="btn btn-secondary" aria-expanded={expanded} aria-controls={`application-${item.id}`} onClick={() => toggle(item.id)}>{expanded ? "Hide answers" : "View all answers"}</button>
              {item.ticket && <a className="btn btn-quiet" href={`#recruit/${encodeURIComponent(item.ticket.id)}`}>Open recruit</a>}
              {item.ticket && <a className="btn btn-quiet" href={item.ticket.url} target="_blank" rel="noopener noreferrer">HubSpot ticket<span className="sr-only"> (opens in a new tab)</span></a>}
              {item.contact && <a className="btn btn-quiet" href={item.contact.url} target="_blank" rel="noopener noreferrer">HubSpot contact<span className="sr-only"> (opens in a new tab)</span></a>}
            </div>
            {expanded && <div id={`application-${item.id}`} className={styles.answers}>
              <div className={styles.review}>
                <div><h3>Required items</h3>{item.requirementsMet === false ? <ul>{item.missed.map(text => <li key={text}>{text}</li>)}</ul> : <p>{item.requirementsMet ? "Meets every required item." : "Not recorded."}</p>}</div>
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
    </>}
  </section>;
}
