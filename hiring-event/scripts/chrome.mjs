// Runs headless Chrome (or Edge) with a throwaway profile, so it never touches the
// user's own browser profile or sign-ins.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export function chromePath() {
  const found = CANDIDATES.find(path => existsSync(path));
  if (!found) throw new Error('Chrome or Edge not found. Set CHROME_PATH.');
  return found;
}

export async function headless(args) {
  const profile = await mkdtemp(join(tmpdir(), 'lgcyap-chrome-'));
  try {
    await run(chromePath(), [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      `--user-data-dir=${profile}`, '--hide-scrollbars', '--virtual-time-budget=15000', ...args,
    ], { timeout: 90000, windowsHide: true });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
  }
}
