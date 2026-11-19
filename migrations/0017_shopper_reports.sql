-- Shopper leaderboard Calls, Submitted and Submitted premium imported from PolicyTek's
-- "calls-report_*.xlsx" and "applications-report_*.xlsx" exports (scripts/shopper-import.mjs).
-- Only per-agent daily totals are stored: no callers, customers, phone numbers or policies.
-- Additive and reversible: DROP TABLE shopper_report_days, shopper_calls_daily, shopper_applications_daily, shopper_report_imports;

-- One row per import of one report kind, for provenance.
CREATE TABLE IF NOT EXISTS shopper_report_imports (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('calls', 'applications')),
  first_date date NOT NULL,
  last_date date NOT NULL CHECK (last_date >= first_date),
  files jsonb NOT NULL,
  records integer NOT NULL CHECK (records >= 0),
  imported_at timestamptz NOT NULL
);

-- Every day an import covered, including days with no activity. The board reads a range only when every day is covered.
CREATE TABLE IF NOT EXISTS shopper_report_days (
  kind text NOT NULL CHECK (kind IN ('calls', 'applications')),
  activity_date date NOT NULL,
  imported_at timestamptz NOT NULL,
  PRIMARY KEY (kind, activity_date)
);

-- agent_key is the case-folded, space-collapsed full name without single-letter middle initials.
CREATE TABLE IF NOT EXISTS shopper_calls_daily (
  activity_date date NOT NULL,
  agent_key text NOT NULL CHECK (agent_key = lower(agent_key) AND length(agent_key) BETWEEN 1 AND 200),
  agent_name text NOT NULL CHECK (length(agent_name) BETWEEN 1 AND 200),
  calls integer NOT NULL CHECK (calls > 0),
  PRIMARY KEY (activity_date, agent_key)
);

CREATE TABLE IF NOT EXISTS shopper_applications_daily (
  activity_date date NOT NULL,
  agent_key text NOT NULL CHECK (agent_key = lower(agent_key) AND length(agent_key) BETWEEN 1 AND 200),
  agent_name text NOT NULL CHECK (length(agent_name) BETWEEN 1 AND 200),
  applications integer NOT NULL CHECK (applications > 0),
  premium_cents bigint NOT NULL,
  PRIMARY KEY (activity_date, agent_key)
);
