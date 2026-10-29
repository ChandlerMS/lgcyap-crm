-- Metadata only: user/ticket IDs, request IDs, payload hashes, status and timestamps.
-- No HubSpot property values or provider credentials are stored here.
CREATE TABLE IF NOT EXISTS recruit_write_requests (
  user_id text NOT NULL,
  request_id uuid NOT NULL,
  ticket_id text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'saved', 'failed', 'uncertain')),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (user_id, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS recruit_write_one_pending_ticket
  ON recruit_write_requests (ticket_id) WHERE status = 'pending';
