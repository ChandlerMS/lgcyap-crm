-- Standard vs. Preferred answered calls imported from the "Agent_Daily_Calls_YYYY-MM_Month_YYYY.xlsx" workbooks.
-- Additive and reversible: DROP TABLE svp_calls_daily, svp_calls_import_months;

CREATE TABLE IF NOT EXISTS svp_calls_import_months (
  month text PRIMARY KEY CHECK (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  source_file text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  first_date date NOT NULL,
  last_date date NOT NULL CHECK (last_date >= first_date),
  days integer NOT NULL CHECK (days > 0),
  unassigned integer NOT NULL CHECK (unassigned >= 0),
  imported_at timestamptz NOT NULL
);

-- One row per agent per day. agent_key is the case-folded, space-collapsed full name.
CREATE TABLE IF NOT EXISTS svp_calls_daily (
  call_date date NOT NULL,
  agent_key text NOT NULL CHECK (agent_key = lower(agent_key) AND length(agent_key) BETWEEN 1 AND 200),
  agent_name text NOT NULL CHECK (length(agent_name) BETWEEN 1 AND 200),
  connected integer NOT NULL CHECK (connected >= 0),
  PRIMARY KEY (call_date, agent_key)
);
