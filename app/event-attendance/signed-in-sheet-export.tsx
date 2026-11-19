'use client';
import { useEffect, useRef, useState } from 'react';

type ExportResult = { url: string; count: number };
export default function SignedInSheetExport({ count, filters, disabled }: { count: number; filters: { startDate: string; endDate: string; office?: string; name?: string; review?: string; sort?: string }; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<ExportResult | null>(null);
  const popup = useRef<Window | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const running = useRef(false);
  const stop = () => { running.current = false; if (timer.current) clearInterval(timer.current); timer.current = null; setBusy(false); };
  useEffect(() => {
    const completed = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup.current || event.data?.type !== 'crm:attendance-export' || !running.current) return;
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
    const connection = window.open('about:blank', 'crm-attendance-export', 'popup,width=600,height=740');
    if (!connection) { setError('Allow popups for the CRM to connect Google Drive.'); return; }
    popup.current = connection; running.current = true; setBusy(true);
    try {
      const response = await fetch('/api/event-attendance/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filters), signal: AbortSignal.timeout(20000) });
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
  return <div className="application-export">
    <button type="button" disabled={disabled || busy || !count} onClick={() => void exportSheet()}>{busy ? 'Exporting…' : 'Export to Google Sheets'}</button>
    {busy && <p role="status">Complete the Google Drive connection in the popup using your CRM Google account.</p>}
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Saved {saved.count} recruits. <a href={saved.url} target="_blank" rel="noopener noreferrer">Open Google Sheet</a></p>}
  </div>;
}
