import { attachDatabasePool } from '@vercel/functions';
import pg from 'pg';
import SCHEMA from './schema.sql';

// The server code talks to the database through prepare(sql).bind(...).first() / .all() / .run() and batch([...]),
// the small API it was first written against (Cloudflare D1). Here that API runs on Postgres: `?` placeholders become
// $1, $2, … and a batch is one transaction. All tables live in their own schema, `onboard`, so this app can share a
// database with another app without touching its tables.

export interface Stmt {
  bind(...args: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface Db {
  prepare(sql: string): Stmt;
  batch(stmts: Stmt[]): Promise<void>;
}

// What a Postgres client has to offer: one query, a multi-statement script, and a transaction.
export interface Queries {
  query(sql: string, args: unknown[]): Promise<{ rows: Record<string, unknown>[]; count: number }>;
  exec(sql: string): Promise<void>;
}
export interface Client extends Queries {
  transaction(fn: (q: Queries) => Promise<void>): Promise<void>;
}

// Builds the tables on first use. They are created once, under a lock, so two cold starts can't race each other.
// If you add a table to schema.sql, check for it here so existing databases pick it up.
async function ensureSchema(c: Client): Promise<void> {
  const { rows } = await c.query("SELECT to_regclass('onboard.kv') AS t", []);
  if (rows[0]?.t) return;
  await c.transaction(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(4851200)', []);
    await q.exec(SCHEMA);
  });
}

export function database(client: Client): Db {
  let ready: Promise<void> | undefined;
  const up = () => (ready ||= ensureSchema(client).catch((e) => { ready = undefined; throw e; }));

  class Statement implements Stmt {
    constructor(readonly sql: string, readonly args: unknown[] = []) {}
    bind(...args: unknown[]): Stmt { return new Statement(this.sql, args); }
    async first<T>(): Promise<T | null> { await up(); return ((await client.query(this.sql, this.args)).rows[0] as T) ?? null; }
    async all<T>(): Promise<{ results: T[] }> { await up(); return { results: (await client.query(this.sql, this.args)).rows as T[] }; }
    async run(): Promise<{ meta: { changes: number } }> { await up(); return { meta: { changes: (await client.query(this.sql, this.args)).count } }; }
  }

  return {
    prepare: (sql) => { let n = 0; return new Statement(sql.replace(/\?/g, () => '$' + ++n)); },
    async batch(stmts) {
      await up();
      await client.transaction(async (q) => { for (const s of stmts as Statement[]) await q.query(s.sql, s.args); });
    },
  };
}

// Postgres timestamps here are BIGINT milliseconds; read them back as numbers, not strings.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

// Production: a pooled connection from DATABASE_URL, set up the same way as the recruiting app (lgcyap-crm).
// Nothing connects until the first query, so a missing DATABASE_URL shows up as a clear error, not a crash.
export function postgres(value: string | undefined): Db {
  let pool: pg.Pool | undefined;
  const get = (): pg.Pool => {
    if (pool) return pool;
    if (!value) throw new Error('DATABASE_URL is not set. Connect a Postgres database to this Vercel project.');
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    // An URL's sslmode can override the TLS settings below; verify certificates for every remote connection.
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) url.searchParams.delete(key);
    pool = new pg.Pool({
      connectionString: url.href,
      ssl: local ? undefined : { rejectUnauthorized: true },
      max: 3,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      query_timeout: 12000,
      allowExitOnIdle: true,
    });
    pool.on('error', () => {});
    if (process.env.VERCEL === '1') attachDatabasePool(pool);
    return pool;
  };
  const on = (c: pg.Pool | pg.PoolClient): Queries => ({
    async query(sql, args) { const r = await c.query(sql, args); return { rows: r.rows, count: r.rowCount ?? 0 }; },
    async exec(sql) { await c.query(sql); },
  });
  return database({
    query: (sql, args) => on(get()).query(sql, args),
    exec: (sql) => on(get()).exec(sql),
    async transaction(fn) {
      const c = await get().connect();
      try {
        await c.query('BEGIN');
        await fn(on(c));
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  });
}
