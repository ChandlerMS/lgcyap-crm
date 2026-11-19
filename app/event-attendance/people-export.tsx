'use client';
import SignedInSheetExport from './signed-in-sheet-export';
import { useState } from 'react';
import styles from './event-attendance.module.css';

export default function PeopleExport({ rows, title, googleExport }: { rows: readonly object[]; title: string; googleExport?: { startDate: string; endDate: string } }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async (format: 'csv' | 'xlsx') => {
    if (busy || !rows.length) return;
    setBusy(true); setError('');
    try {
      const { attendancePeopleCsv, attendancePeopleWorkbook } = await import('../../lib/attendance-people-download.mjs');
      const content = format === 'csv' ? attendancePeopleCsv(rows) : new Uint8Array(attendancePeopleWorkbook(rows));
      const url = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      link.href = url; link.download = `event-attendance-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)}.${format}`;
      document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(error instanceof Error ? error.message : 'The export could not be created. Try again.'); }
    finally { setBusy(false); }
  };
  return <div className={styles.peopleExport}><div><button type="button" disabled={busy || !rows.length} onClick={() => void download('csv')}>Export CSV</button>{googleExport && <SignedInSheetExport count={rows.length} filters={googleExport} disabled={busy} />}<button type="button" disabled={busy || !rows.length} onClick={() => void download('xlsx')} title="Download an Excel workbook (.xlsx)">Export XLS</button></div>{error && <p role="alert">{error}</p>}</div>;
}
