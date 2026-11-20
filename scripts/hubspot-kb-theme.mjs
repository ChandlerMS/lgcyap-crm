// Builds the HubSpot knowledge base header snippet from the readable stylesheet.
//
//   node scripts/hubspot-kb-theme.mjs --out kb-theme-snippet.html
//
// Paste the output into HubSpot: Settings > Content > Knowledge Base > Template >
// "Knowledge base pages header HTML". See hubspot/knowledge-base/README.md.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const THEME_SOURCE = fileURLToPath(new URL('../hubspot/knowledge-base/legacy-crm-theme.css', import.meta.url));
export const STYLE_ID = 'legacy-crm-theme';

export function minifyCss(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/([{;])\s*([-a-z]+)\s*:\s*/g, '$1$2:')
    .replaceAll(';}', '}')
    .trim();
}

export function buildSnippet(source) {
  const css = minifyCss(source);
  if (/[^\x20-\x7e]/.test(css)) throw new Error('The stylesheet must be plain ASCII; use CSS escapes such as \\00B7 for other characters.');
  if (/<\/style/i.test(css)) throw new Error('The stylesheet must not contain "</style".');
  if (css.split('{').length !== css.split('}').length) throw new Error('The stylesheet has unbalanced braces.');
  return `<style id="${STYLE_ID}">${css}</style>`;
}

function main(argv) {
  const outIndex = argv.indexOf('--out');
  const snippet = buildSnippet(readFileSync(THEME_SOURCE, 'utf8'));
  const sha256 = createHash('sha256').update(snippet).digest('hex');
  if (outIndex >= 0) {
    const out = argv[outIndex + 1];
    if (!out) throw new Error('--out needs a file path.');
    writeFileSync(out, snippet);
  } else {
    process.stdout.write(snippet);
  }
  process.stderr.write(`${snippet.length} characters, sha256 ${sha256}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
