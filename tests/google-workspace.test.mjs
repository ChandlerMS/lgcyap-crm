import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_WORKSPACE_PAGES, externalWorkspacePage } from '../app/external-workspace-pages.mjs';
import { resolveWorkspaceRoute, sidebarViewFor } from '../app/recruiting-navigation.mjs';

test('Saved Google Workspace routes retain their destinations after sidebar removal', () => {
  assert.deepEqual(GOOGLE_WORKSPACE_PAGES.map(page => [page.label, page.url]), [
    ['Google Sheets', 'https://docs.google.com/spreadsheets/u/0/'],
    ['Google Drive', 'https://drive.google.com/drive/u/0/'],
    ['Google Docs', 'https://docs.google.com/document/u/0/'],
    ['Google Chat', 'https://chat.google.com/'],
    ['Google Meet', 'https://meet.google.com/'],
    ['Gmail', 'https://mail.google.com/mail/u/0/'],
    ['Google Keep', 'https://keep.google.com/'],
  ]);
  for (const page of GOOGLE_WORKSPACE_PAGES) {
    assert.equal(externalWorkspacePage(page.id), page);
    assert.equal(resolveWorkspaceRoute(`#${page.id}`).view, page.id);
    assert.equal(sidebarViewFor(page.id), 'google-workspace');
  }
});

test('Google Workspace and its flyout are absent from the sidebar', () => {
  const workspace = readFileSync(new URL('../app/recruiting-workspace.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(workspace, /google-workspace-links|enterNav\("google-workspace"\)|GOOGLE_WORKSPACE_PAGES/);
});
