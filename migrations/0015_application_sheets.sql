CREATE TABLE IF NOT EXISTS application_sheets_connection (
  id integer PRIMARY KEY CHECK (id = 1),
  email text NOT NULL CHECK (email = 'chandler@lgcyap.com'),
  refresh_token text NOT NULL,
  connected_at timestamptz NOT NULL,
  last_success_at timestamptz,
  last_daily_day text,
  last_error text,
  lease_owner text,
  lease_until timestamptz
);
CREATE TABLE IF NOT EXISTS application_sheets_months (
  month text PRIMARY KEY CHECK (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  spreadsheet_id text NOT NULL UNIQUE,
  fingerprint text,
  needs_repair boolean NOT NULL DEFAULT false,
  repaired_day text,
  managed_columns integer NOT NULL DEFAULT 0,
  synced_at timestamptz
);
