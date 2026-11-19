import { monthlySheetsStatus, syncMonthlySheets } from './monthly-sheets-sync.mjs';
export const signInSheetsStatus = options => monthlySheetsStatus({ ...options, kind: 'sign-ins' });
export const syncSignInSheets = options => syncMonthlySheets({ ...options, kind: 'sign-ins' });
