CREATE TABLE IF NOT EXISTS gmail_connection (
  user_id text PRIMARY KEY,
  email text NOT NULL,
  google_sub text NOT NULL,
  refresh_token text NOT NULL,
  scope text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency records contain metadata only, never recipients or message bodies.
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
