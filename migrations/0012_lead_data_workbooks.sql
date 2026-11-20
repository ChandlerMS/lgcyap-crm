-- The "Instant Hangups" and "Short Duration Calls" Daily Totals workbooks, imported into Lead Data's RingCentral numbers.
-- Kept apart from lead_data_ringcx_daily because saving a report rebuilds that table and removes days the report no longer returns.
-- Additive and reversible: DROP TABLE lead_data_workbook_daily;

-- One row per agent per day; an import replaces the dates it covers. No caller or call data is stored.
CREATE TABLE IF NOT EXISTS lead_data_workbook_daily (
  call_date date NOT NULL,
  agent_key text NOT NULL CHECK (length(agent_key) BETWEEN 1 AND 200),
  agent_name text NOT NULL,
  instant_disconnects integer NOT NULL CHECK (instant_disconnects >= 0),
  short_duration integer NOT NULL CHECK (short_duration >= 0),
  imported_at timestamptz NOT NULL,
  PRIMARY KEY (call_date, agent_key)
);
