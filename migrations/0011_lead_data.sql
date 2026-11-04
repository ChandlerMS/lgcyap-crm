-- Lead Data's RingCentral numbers: Instant Disconnects and Short Duration Calls per agent per day, read every five minutes from RingCX's saved reports.
-- Additive and reversible: DROP TABLE lead_data_ringcx_daily, lead_data_sync;

-- One row per agent per day; each read replaces the days it covers. No caller or call data is stored.
CREATE TABLE IF NOT EXISTS lead_data_ringcx_daily (
  call_date date NOT NULL,
  agent_key text NOT NULL CHECK (length(agent_key) BETWEEN 1 AND 200),
  agent_name text NOT NULL,
  instant_disconnects integer NOT NULL CHECK (instant_disconnects >= 0),
  short_duration integer NOT NULL CHECK (short_duration >= 0),
  PRIMARY KEY (call_date, agent_key)
);

CREATE TABLE IF NOT EXISTS lead_data_sync (
  id boolean PRIMARY KEY CHECK (id),
  attempted_at timestamptz NOT NULL,
  succeeded_at timestamptz,
  error_code text,
  error_detail text,
  last_run jsonb,
  report_version text,
  report_from date,
  report_through date,
  data_loaded_at text
);
