// npm run dev: bundles src/dev.ts, restarts the server whenever a source file changes, and reads .env.local.
import { spawn } from 'node:child_process';
import * as esbuild from 'esbuild';
import { common } from './bundle.mjs';

const ctx = await esbuild.context({
  ...common,
  entryPoints: ['src/dev.ts'],
  outfile: '.data/dev-server.mjs',
  packages: 'external',
  banner: {},
});
await ctx.rebuild();
await ctx.watch();

const server = spawn(process.execPath, ['--env-file-if-exists=.env.local', '--watch', '--watch-preserve-output', '.data/dev-server.mjs'], { stdio: 'inherit' });
const stop = () => { server.kill(); ctx.dispose(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
