import { getPool } from './pool.mjs';

// Keep in sync with migrations/0017_gmail_drafts.sql and 0019_gmail_send_requests.sql. Inline SQL is deliberate:
// Turbopack can rewrite a new URL(.sql, import.meta.url) to a public asset URL.
export const GMAIL_SCHEMA = `CREATE TABLE IF NOT EXISTS gmail_connection (
  user_id text PRIMARY KEY,
  email text NOT NULL,
  google_sub text NOT NULL,
  refresh_token text NOT NULL,
  scope text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gmail_draft_requests (
  user_id text NOT NULL,
  request_id text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'created', 'uncertain', 'failed')),
  draft_id text,
  message_id text,
  thread_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS gmail_draft_requests_user_created_at ON gmail_draft_requests (user_id, created_at);
CREATE TABLE IF NOT EXISTS gmail_send_requests (
  user_id text NOT NULL,
  request_id text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'uncertain', 'failed', 'acknowledged')),
  message_id text,
  thread_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS gmail_send_one_unresolved ON gmail_send_requests (user_id) WHERE status IN ('pending', 'uncertain');
`;

let initialized;
export async function getGmailDb() {
  const pool = getPool();
  initialized ??= pool.query(GMAIL_SCHEMA).catch(error => { initialized = null; throw error; });
  await initialized;
  return pool;
}
