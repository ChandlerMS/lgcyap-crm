'use client';
import { useEffect, useRef, useState } from 'react';
import type { Application } from './applications-page';
import type { Review } from './event-review';

type Filters = { query: string; office: string; status: string };
type ExportResult = { url: string; count: number };
export default function ApplicationExportButton({ filters, count, disabled, applications = [], reviews = {}, reviewComplete = false }: { filters: Filters; count: number; disabled?: boolean; applications?: Application[]; reviews?: Record<string, Review>; reviewComplete?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [exportKind, setExportKind] = useState<'sheet' | 'download'>('sheet');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<ExportResult | null>(null);
  const popup = useRef<Window | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const running = useRef(false);
  const stop = () => { running.current = false; if (timer.current) clearInterval(timer.current); timer.current = null; setBusy(false); };
  useEffect(() => {
    const completed = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup.current || event.data?.type !== 'crm:applications-export' || !running.current) return;
      stop();
      if (typeof event.data.error === 'string') { setError(event.data.error); return; }
      if (typeof event.data.url === 'string' && /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{5,200}\/edit$/.test(event.data.url) && Number.isInteger(event.data.count) && event.data.count > 0) setSaved({ url: event.data.url, count: event.data.count });
      else setError('Google did not confirm the saved Sheet. Check your Drive before exporting again.');
    };
    window.addEventListener('message', completed);
    return () => { window.removeEventListener('message', completed); if (timer.current) clearInterval(timer.current); };
  }, []);
  const exportSheet = async () => {
    if (running.current || disabled || !count) return;
    setError(''); setSaved(null);
    const connection = window.open('about:blank', 'crm-applications-export', 'popup,width=600,height=740');
    if (!connection) { setError('Allow popups for the CRM to connect Google Drive.'); return; }
    popup.current = connection; running.current = true; setExportKind('sheet'); setBusy(true);
    try {
      const response = await fetch('/api/applications/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filters), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'The export could not start.');
      const authorization = new URL(result.url);
      if (authorization.origin !== 'https://accounts.google.com' || authorization.pathname !== '/o/oauth2/v2/auth') throw new Error('Google authorization could not be verified.');
      connection.location.replace(authorization.href);
      timer.current = setInterval(() => { if (connection.closed && running.current) { stop(); setError('The Google export window closed. Check your Drive before starting another export.'); } }, 500);
    } catch (problem) {
      connection.close(); stop(); setError(problem instanceof Error ? problem.message : 'The export could not start.');
    }
  };
  const download = async (format: 'csv' | 'xlsx') => {
    if (disabled || busy || !applications.length) return;
    setError(''); setExportKind('download'); setBusy(true);
    try {
      const { applicationCsv, applicationWorkbook } = await import('../lib/application-download.mjs');
      const content = format === 'csv' ? applicationCsv(applications, reviews, reviewComplete) : new Uint8Array(applicationWorkbook(applications, reviews, reviewComplete));
      const blob = new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `applications-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'The download could not be created.'); }
    finally { setBusy(false); }
  };
  return <div className="application-export">
    <div className="application-export-buttons">
    <button type="button" className="btn btn-secondary" disabled={disabled || busy || !count} onClick={() => void exportSheet()} title={`Export all ${count} matching applications across every page to your Google Drive`}>{busy ? 'Exporting…' : 'Export to Google Sheets'}</button>
    <button type="button" className="btn btn-secondary" disabled={disabled || busy || !applications.length} onClick={() => void download('csv')}>Export CSV</button>
    <button type="button" className="btn btn-secondary" disabled={disabled || busy || !applications.length} onClick={() => void download('xlsx')} title="Download an Excel workbook (.xlsx)">Export XLS</button>
    </div>
    {busy && exportKind === 'sheet' && <p className="helper" role="status">Complete the Google Drive connection in the popup. Use the same Google account as your CRM sign-in.</p>}
    {error && <p className="helper" role="alert">{error}</p>}
    {saved && <p className="helper" role="status">Saved {saved.count} applications to your Google Drive. <a className="text-link" href={saved.url} target="_blank" rel="noopener noreferrer">Open Google Sheet</a></p>}
  </div>;
}
