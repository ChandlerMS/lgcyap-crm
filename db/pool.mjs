import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

let pool;

/** No connection or credential access happens during import or next build. */
export function getPool() {
  if (pool) return pool;
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('Database configuration is unavailable.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Database configuration is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error('Database configuration is invalid.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // An URL's sslmode can override the explicit TLS object in node-postgres.
  // Use certificate verification for every remote connection, regardless of it.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) url.searchParams.delete(key);
  pool = new Pool({
    connectionString: url.href,
    ssl: local ? undefined : { rejectUnauthorized: true },
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 12000,
    allowExitOnIdle: true,
  });
  // Idle-client errors must not terminate a function or expose connection data.
  pool.on('error', () => {});
  if (process.env.VERCEL === '1') attachDatabasePool(pool);
  return pool;
}
