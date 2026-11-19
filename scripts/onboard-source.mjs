// Explicit source-code synchronization. No credentials or recruiting records are copied.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = join(root, 'vendor/lgcy-onboard');
const lockFile = join(root, 'onboard-source.json');
const repository = 'https://github.com/LegacyAgencyPartners/LGCY-Onboard.git';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function snapshot(dir, prefix = '') {
  const files = {};
  for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + item.name;
    if (item.isSymbolicLink()) throw new Error(`Symlinks cannot be synchronized: ${name}`);
    if (item.isDirectory()) Object.assign(files, snapshot(join(dir, item.name), name + '/'));
    else files[name] = createHash('sha256').update(readFileSync(join(dir, item.name))).digest('hex');
  }
  return files;
}
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const lock = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : null;
const mode = process.argv[2] || 'check';
if (!['check', 'pull', 'push'].includes(mode)) throw new Error('Use check, pull, or push.');
if (mode === 'check') {
  if (!lock || lock.repository !== repository || !/^[a-f0-9]{40}$/.test(lock.commit) || !same(snapshot(vendor), lock.files)) {
    throw new Error('Version 2 differs from its GitHub source snapshot. Run npm run onboard:push after reviewing edits, or npm run onboard:pull.');
  }
  console.log(`Version 2 source verified: ${repository} @ ${lock.commit}`);
} else {
  const temp = mkdtempSync(join(tmpdir(), 'lgcy-onboard-source-'));
  try {
    git(temp, 'clone', '--quiet', '--depth', '1', '--branch', 'main', repository, 'source');
    const checkout = join(temp, 'source');
    const source = join(checkout, 'version2');
    const head = git(checkout, 'rev-parse', 'HEAD');
    if (!existsSync(source)) throw new Error('GitHub version2/ source is missing.');
    if (mode === 'pull') {
      if (lock && !same(snapshot(vendor), lock.files)) throw new Error('Publish or revert local Version 2 edits before pulling.');
      rmSync(vendor, { recursive: true });
      cpSync(source, vendor, { recursive: true });
    } else {
      if (!lock || head !== lock.commit) throw new Error('GitHub has changed. Pull and reconcile before publishing; no remote files were changed.');
      const files = git(root, 'ls-files', '--', 'vendor/lgcy-onboard').split('\n').filter(Boolean);
      rmSync(source, { recursive: true });
      for (const file of files) {
        if (!existsSync(join(root, file))) continue;
        const relative = file.slice('vendor/lgcy-onboard/'.length);
        if (/(^|\/)(?:(?:node_modules|\.git|\.vercel)(?:\/|$)|\.env(?!\.example$))/.test(relative)) throw new Error(`Refusing generated or secret file: ${relative}`);
        mkdirSync(dirname(resolve(source, relative)), { recursive: true });
        cpSync(join(root, file), resolve(source, relative));
      }
      if (!same(snapshot(vendor), snapshot(source))) throw new Error('Stage new source files and remove generated/untracked files before publishing.');
      git(checkout, 'add', '--all', 'version2');
      if (git(checkout, 'status', '--porcelain')) {
        git(checkout, '-c', `user.name=${git(root, 'var', 'GIT_AUTHOR_IDENT').split(' <')[0]}`, '-c', `user.email=${git(root, 'var', 'GIT_AUTHOR_IDENT').split('<')[1].split('>')[0]}`, 'commit', '-m', process.argv[3] || 'Update Version 2 application source');
        git(checkout, 'push', 'origin', 'HEAD:main');
      }
    }
    writeFileSync(lockFile, JSON.stringify({ repository, path: 'version2', branch: 'main', commit: git(checkout, 'rev-parse', 'HEAD'), files: snapshot(vendor) }, null, 2) + '\n');
    console.log(`Version 2 ${mode} complete. Commit onboard-source.json with the host changes.`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
