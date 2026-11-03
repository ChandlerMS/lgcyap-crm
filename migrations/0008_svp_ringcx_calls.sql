-- Standard vs. Preferred answered calls read from RingCX's agent queue report every five minutes.
-- Kept apart from svp_calls_daily because a workbook import deletes whole months there.
-- Additive and reversible: DROP TABLE svp_ringcx_windows, svp_ringcx_days, svp_ringcx_sync;

-- One row per two-hour Eastern window; each read replaces the row. counts maps agent_key to answered calls.
CREATE TABLE IF NOT EXISTS svp_ringcx_windows (
  call_date date NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 11),
  counts jsonb NOT NULL CHECK (jsonb_typeof(counts) = 'object'),
  read_through smallint NOT NULL CHECK (read_through BETWEEN 1 AND 1440),
  settled boolean NOT NULL,
  read_at timestamptz NOT NULL,
  PRIMARY KEY (call_date, slot)
);

-- A day joins the board once every window that has started has been read, and stays on it (lib/svp-ringcx-calls.mjs).
CREATE TABLE IF NOT EXISTS svp_ringcx_days (
  call_date date PRIMARY KEY,
  ready_at timestamptz NOT NULL
);

-- One row: the latest run's outcome. No caller or call data is stored here.
CREATE TABLE IF NOT EXISTS svp_ringcx_sync (
  id boolean PRIMARY KEY CHECK (id),
  attempted_at timestamptz NOT NULL,
  succeeded_at timestamptz,
  error_code text,
  error_detail text,
  last_run jsonb
);
