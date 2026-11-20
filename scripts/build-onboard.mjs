import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['scripts/onboard-source.mjs', 'check'], { stdio: 'inherit' });

// Compile the uploaded server unchanged. The hosting/sign-in adapter is separate.
await build({
  entryPoints: ['lib/onboard-runtime-entry.mjs'],
  outfile: 'lib/generated/onboard-runtime.mjs',
  bundle: true, platform: 'node', target: 'node24', format: 'esm',
  loader: { '.html': 'text', '.sql': 'text' },
  external: ['pg', '@vercel/functions'],
  legalComments: 'none', logLevel: 'warning',
});
