// Shared by the spreadsheet imports: asks for the database connection string without echoing it.
export class ConnectionStringError extends Error { constructor(message) { super(message); this.name = 'ConnectionStringError'; } }

/** Kept in memory for this run only. Accepts a bare URL or a pasted DATABASE_URL="…" snippet. */
export async function askConnectionString() {
  if (!process.stdin.isTTY) throw new ConnectionStringError('DATABASE_URL is not set. Run this in a terminal to paste the connection string when asked.');
  const { createInterface } = await import('node:readline');
  const prompt = 'Paste the database connection string (it will not be shown), then press Enter: ';
  process.stdout.write(prompt);
  const lines = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  lines._writeToOutput = () => {};
  // A pasted multi-line snippet arrives as several lines at once: keep the first DATABASE_URL (or any postgres URL),
  // then swallow the rest of the paste so none of it reaches the shell after this script exits.
  return new Promise((resolve, reject) => {
    let found = null, settle = null;
    lines.on('line', line => {
      const preferred = /^\s*(?:export\s+)?DATABASE_URL\s*=/.test(line), url = line.match(/postgres(?:ql)?:\/\/[^\s"']+/)?.[0];
      if (url && (!found || (preferred && !found.preferred))) found = { url, preferred };
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (found) { lines.close(); process.stdout.write('\nConnection string received.\n'); resolve(found.url); }
        else process.stdout.write(`\nThat did not contain a postgres:// connection string. ${prompt}`);
      }, 800);
    });
    lines.on('close', () => { clearTimeout(settle); if (!found) reject(new ConnectionStringError('No connection string was entered.')); });
  });
}
