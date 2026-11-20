import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('source workflow verifies hashes, preserves local edits, publishes and imports source, and rejects stale pushes', () => {
  const temp = mkdtempSync(join(tmpdir(), 'onboard-source-test-'));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    const upstream = join(temp, 'upstream');
    const host = join(temp, 'host');
    mkdirSync(join(upstream, 'version2'), { recursive: true });
    mkdirSync(join(host, 'scripts'), { recursive: true });
    mkdirSync(join(host, 'vendor/lgcy-onboard'), { recursive: true });
    git(upstream, 'init', '-b', 'main');
    git(upstream, 'config', 'user.name', 'Source Test');
    git(upstream, 'config', 'user.email', 'test@example.com');
    git(upstream, 'config', 'receive.denyCurrentBranch', 'updateInstead');
    writeFileSync(join(upstream, 'version2/app.txt'), 'initial');
    writeFileSync(join(upstream, 'version2/.gitignore'), 'node_modules/\n');
    writeFileSync(join(upstream, 'version2/.env.example'), 'EXAMPLE=\n');
    git(upstream, 'add', '.'); git(upstream, 'commit', '-m', 'Initial');
    git(host, 'init', '-b', 'main');
    git(host, 'config', 'user.name', 'Source Test');
    git(host, 'config', 'user.email', 'test@example.com');
    cpSync(new URL('../scripts/onboard-source.mjs', import.meta.url), join(host, 'scripts/onboard-source.mjs'));
    writeFileSync(join(host, 'vendor/lgcy-onboard/app.txt'), 'initial');
    cpSync(join(upstream, 'version2/.gitignore'), join(host, 'vendor/lgcy-onboard/.gitignore'));
    cpSync(join(upstream, 'version2/.env.example'), join(host, 'vendor/lgcy-onboard/.env.example'));
    writeFileSync(join(host, 'onboard-source.json'), JSON.stringify({ repository: 'https://github.com/LegacyAgencyPartners/LGCY-Onboard.git', commit: git(upstream, 'rev-parse', 'HEAD'), files: { 'app.txt': createHash('sha256').update('initial').digest('hex') } }));
    git(host, 'add', '.'); git(host, 'commit', '-m', 'Initial');
    const run = mode => spawnSync(process.execPath, ['scripts/onboard-source.mjs', mode], {
      cwd: host, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${upstream}.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/LegacyAgencyPartners/LGCY-Onboard.git' },
    });
    // Pull without a lock to initialize all tracked source files, including safe dotfiles.
    rmSync(join(host, 'onboard-source.json'));
    assert.equal(run('pull').status, 0);
    assert.equal(run('check').status, 0);
    writeFileSync(join(host, 'vendor/lgcy-onboard/app.txt'), 'edited');
    assert.notEqual(run('check').status, 0);
    assert.match(run('pull').stderr, /Publish or revert local/);
    assert.equal(readFileSync(join(host, 'vendor/lgcy-onboard/app.txt'), 'utf8'), 'edited');
    mkdirSync(join(host, 'vendor/lgcy-onboard/new'), { recursive: true });
    writeFileSync(join(host, 'vendor/lgcy-onboard/new/file.txt'), 'new file');
    git(host, 'add', 'vendor');
    const pushed = run('push');
    assert.equal(pushed.status, 0, pushed.stderr);
    assert.equal(readFileSync(join(upstream, 'version2/app.txt'), 'utf8'), 'edited');
    assert.equal(readFileSync(join(upstream, 'version2/new/file.txt'), 'utf8'), 'new file');
    assert.equal(run('check').status, 0);
    writeFileSync(join(upstream, 'version2/app.txt'), 'upstream edit');
    git(upstream, 'add', '.'); git(upstream, 'commit', '-m', 'New upstream');
    assert.match(run('push').stderr, /GitHub has changed/);
    const pulled = run('pull');
    assert.equal(pulled.status, 0, pulled.stderr);
    assert.equal(readFileSync(join(host, 'vendor/lgcy-onboard/app.txt'), 'utf8'), 'upstream edit');
    assert.equal(run('check').status, 0);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
