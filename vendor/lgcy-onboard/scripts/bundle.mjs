// esbuild settings shared by the production build (scripts/build.mjs) and the dev server (scripts/dev.mjs).
// HTML pages and the SQL schema are imported as text, the way the app was first bundled.
export const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  loader: { '.html': 'text', '.sql': 'text' },
  legalComments: 'none',
  logLevel: 'warning',
  // Bundled CommonJS packages (pg) call require() for Node's built-ins; give the ESM bundle a real require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
};
