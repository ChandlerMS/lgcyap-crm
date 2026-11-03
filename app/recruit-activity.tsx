"use client";

import { useEffect, useRef, useState } from 'react';

type Activity = { id: string; kind: string; title: string; body: string; occurredAt: string | null; status: string; direction: string; source: string; durationSeconds: number | null; recordingAvailable: boolean; transcriptAvailable: boolean; summary: string; hubspotUrl: string; reviewUrl: string | null };
type Page = { records: Activity[]; next: string | null; notice: string; error?: string };
const VIEWS = ['Notes', 'Calls', 'Emails', 'Tasks', 'Meetings', 'Recordings', 'Transcripts'] as const;
const SOURCES = ['ticket', 'contact'] as const;
type Source = typeof SOURCES[number];
const when = (date: string | null) => date ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date)) : 'Date not recorded';

export default function RecruitActivity({ recruitId, isDemo = false }: { recruitId: string; isDemo?: boolean }) {
  const [view, setView] = useState<typeof VIEWS[number]>('Calls');
  const kind = ['Recordings', 'Transcripts'].includes(view) ? 'calls' : view.toLowerCase();
  return <section className="profile-activity" aria-label="Notes and activity history"><h2 className="section-title">Notes &amp; activity history</h2>
    <div className="activity-tabs" role="group" aria-label="Activity type">{VIEWS.map(item => <button className="btn" key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}</div>
    {isDemo ? <p className="helper">Demo recruit. No customer history, recordings or transcripts are requested from HubSpot.</p> : <ActivityPages key={`${recruitId}:${kind}`} recruitId={recruitId} kind={kind} view={view} />}
  </section>;
}

function ActivityPages({ recruitId, kind, view }: { recruitId: string; kind: string; view: string }) {
  const [pages, setPages] = useState<Partial<Record<Source, Page>>>({});
  const [busy, setBusy] = useState(true);
  const [version, setVersion] = useState(0);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [olderPages, setOlderPages] = useState(false);
  const loadingMore = useRef(false);
  const paged = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || loadingMore.current || paged.current || document.visibilityState === 'hidden') return;
      refreshing = true;
      setBusy(true);
      const results = await Promise.all(SOURCES.map(async source => {
        try { return [source, await read(source, null, controller.signal)] as const; }
        catch { return [source, { records: [], next: null, notice: '', error: 'Activity could not be loaded. Try Refresh.' }] as const; }
      }));
      if (!controller.signal.aborted) {
        setPages(current => Object.fromEntries(results.map(([source, page]) => [source, page.error && current[source] ? { ...current[source], error: page.error } : page])));
        if (results.every(([, page]) => !page.error)) setCheckedAt(new Date().toISOString());
        setBusy(false);
      }
      refreshing = false;
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    // A background tab makes no polling requests. Resume on its next interval.
    return () => { controller.abort(); window.clearInterval(interval); };
    // Each request group is bound to this recruit and activity type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recruitId, kind, version]);
  async function read(source: Source, after: string | null, signal?: AbortSignal): Promise<Page> {
    const response = await fetch(`/api/recruits/${encodeURIComponent(recruitId)}/activity`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, source, after }), signal });
    const result = await response.json();
    if (!response.ok || result.error) return { records: [], next: null, notice: '', error: result.error || 'Activity could not be loaded.' };
    return result;
  }
  async function more(source: Source) {
    const previous = pages[source]; if (!previous?.next || busy || loadingMore.current) return;
    loadingMore.current = true;
    paged.current = true;
    setOlderPages(true);
    setBusy(true);
    try {
      const page = await read(source, previous.next);
      setPages(current => ({ ...current, [source]: page.error ? { ...previous, error: page.error } : { ...page, records: [...previous.records, ...page.records] } }));
    } catch { setPages(current => ({ ...current, [source]: { ...previous, error: 'The next page could not be loaded. Try again.' } })); }
    finally { loadingMore.current = false; setBusy(false); }
  }
  const all = [...new Map(Object.values(pages).flatMap(page => page.records).map(row => [row.id, row])).values()].sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''));
  const records = all.filter(row => view === 'Recordings' ? row.recordingAvailable : view === 'Transcripts' ? row.transcriptAvailable : true);
  return <div aria-busy={busy}>
    <div className="activity-toolbar"><p className="helper">HubSpot ticket and linked-contact history. {olderPages ? 'Automatic refresh paused while browsing additional pages.' : 'Checks for updates every minute while this page is visible.'} {checkedAt && <>Last checked {when(checkedAt)}.</>}</p><button className="btn" disabled={busy} onClick={() => { paged.current = false; setOlderPages(false); setBusy(true); setVersion(value => value + 1); }}>Refresh history</button></div>
    {kind === 'calls' && <p className="helper">RingCentral Activity Sync logs matching calls to HubSpot. A completed call or newly processed recording can take time to appear. Load more pages if an activity is missing.</p>}
    {SOURCES.map(source => pages[source]?.error ? <p role="alert" key={source}>{source === 'ticket' ? 'Ticket' : 'Contact'}: {pages[source]?.error}</p> : pages[source]?.notice && <p className="helper" key={source}>{pages[source]?.notice}</p>)}
    {(view === 'Recordings' || view === 'Transcripts') && <p className="helper">Only media provided to HubSpot is listed. Playback and full transcripts open in HubSpot with your account permissions; a call summary is not a transcript.</p>}
    {busy && <p role="status">Loading activity…</p>}
    {!busy && !records.length && <p className="helper">No {view.toLowerCase()} in the loaded activity pages.</p>}
    <div className="activity-list">{records.map(row => <article className="activity-entry" key={row.id}><div className="activity-toolbar"><h3>{row.title}</h3><time dateTime={row.occurredAt ?? undefined}>{when(row.occurredAt)}</time></div><p className="helper">{[row.source, row.direction, row.status, row.durationSeconds !== null ? `${Math.floor(row.durationSeconds / 60)}m ${row.durationSeconds % 60}s` : ''].filter(Boolean).join(' · ')}</p>{row.body && <details><summary>{kind === 'notes' ? 'Read note' : 'Details'}</summary><p className="activity-body">{row.body}</p></details>}{row.summary && <details><summary>Call summary</summary><p className="activity-body">{row.summary}</p></details>}<div className="activity-links"><a className="text-link" href={row.hubspotUrl} target="_blank" rel="noopener noreferrer">Open activity in HubSpot</a>{row.recordingAvailable && <a className="text-link" href={row.reviewUrl ?? row.hubspotUrl} target="_blank" rel="noopener noreferrer">Review recording in HubSpot</a>}{row.transcriptAvailable && <a className="text-link" href={row.reviewUrl ?? row.hubspotUrl} target="_blank" rel="noopener noreferrer">Review transcript in HubSpot</a>}</div>{kind === 'calls' && <p className="helper">Recording: {row.recordingAvailable ? 'linked in HubSpot' : 'not provided'} · Transcript: {row.transcriptAvailable ? 'marked available in HubSpot' : 'not provided'}</p>}</article>)}</div>
    <div className="activity-links">{SOURCES.map(source => pages[source]?.next && <button className="btn" key={source} disabled={busy} onClick={() => void more(source)}>Load more {source} {kind}</button>)}</div>
  </div>;
}
