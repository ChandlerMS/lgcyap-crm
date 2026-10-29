-- Metadata only. Phone and payload use purpose-separated keyed hashes; no PII.
CREATE TABLE IF NOT EXISTS contact_create_ledger_key (
  id integer PRIMARY KEY CHECK (id = 1),
  key_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_create_requests (
  user_id text NOT NULL,
  request_id uuid NOT NULL,
  phone_hash text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'created', 'duplicate', 'failed', 'uncertain')),
  contact_id text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (user_id, request_id)
);

-- Pending/crashed/ambiguous requests never release their phone claim by time.
-- Only a definite failed outcome permits a deliberate new request UUID.
CREATE UNIQUE INDEX IF NOT EXISTS contact_create_one_phone
  ON contact_create_requests (phone_hash)
  WHERE status IN ('pending', 'created', 'duplicate', 'uncertain');
