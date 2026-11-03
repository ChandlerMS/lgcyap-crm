CREATE TABLE IF NOT EXISTS recruit_lifecycle_sync (
  ticket_id text PRIMARY KEY CHECK (ticket_id ~ '^[1-9][0-9]{0,19}$'),
  contact_id text,
  ticket_stage text,
  contact_stage text,
  status text NOT NULL,
  pending jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);
CREATE TABLE IF NOT EXISTS recruit_lifecycle_job (
  id integer PRIMARY KEY CHECK (id = 1),
  cursor_id text NOT NULL DEFAULT '0',
  checked_at timestamptz,
  summary jsonb
);
INSERT INTO recruit_lifecycle_job(id) VALUES (1) ON CONFLICT DO NOTHING;
