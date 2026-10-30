-- Request IDs, keyed hashes and CRM IDs only; no submitted names, phones or emails.
CREATE TABLE IF NOT EXISTS recruit_intake_ledger_key (
  id integer PRIMARY KEY CHECK (id = 1),
  key_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS recruit_intake_requests (
  user_id text NOT NULL,
  request_id uuid NOT NULL,
  phone_hash text NOT NULL,
  email_hash text,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','contact_ready','ticket_pending','needs_ticket','created','already_exists','failed','uncertain')),
  contact_id text,
  ticket_id text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (user_id, request_id)
);

-- Both claims arbitrate atomically on the single request INSERT. A crash or partial
-- success retains its identity claims; only a definite failure releases them.
CREATE UNIQUE INDEX IF NOT EXISTS recruit_intake_one_phone
  ON recruit_intake_requests (phone_hash) WHERE status <> 'failed';
CREATE UNIQUE INDEX IF NOT EXISTS recruit_intake_one_email
  ON recruit_intake_requests (email_hash) WHERE email_hash IS NOT NULL AND status <> 'failed';
