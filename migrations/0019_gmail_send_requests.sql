-- Delivery metadata only; no recipient or message content is stored.
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
