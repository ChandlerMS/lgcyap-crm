import { monthlySheetsStatus, syncMonthlySheets } from './monthly-sheets-sync.mjs';
export const applicationSheetsStatus = options => monthlySheetsStatus({ ...options, kind: 'applications' });
export const syncApplicationSheets = options => syncMonthlySheets({ ...options, kind: 'applications' });
