-- Standard vs. Preferred Calls and Sold per agent per day, read every five minutes from the RingCX report
-- "Agent Close Rate - Standard vs Preferred SYNC". Kept apart from svp_calls_daily because a workbook import deletes whole months there.
-- 0008's svp_ringcx_windows and svp_ringcx_days are no longer used: RingCX refused the report they were for, so they stayed empty.
-- Additive and reversible: DROP TABLE svp_ringcx_report_daily; ALTER TABLE svp_ringcx_sync DROP COLUMN report_version, DROP COLUMN report_from, DROP COLUMN report_through, DROP COLUMN data_loaded_at;

-- One row per agent per day; each read replaces the days it covers. No caller or call data is stored.
CREATE TABLE IF NOT EXISTS svp_ringcx_report_daily (
  call_date date NOT NULL,
  agent_key text NOT NULL CHECK (length(agent_key) BETWEEN 1 AND 200),
  agent_name text NOT NULL,
  calls integer NOT NULL CHECK (calls >= 0),
  sold integer NOT NULL CHECK (sold >= 0),
  PRIMARY KEY (call_date, agent_key)
);

ALTER TABLE svp_ringcx_sync ADD COLUMN IF NOT EXISTS report_version text;
ALTER TABLE svp_ringcx_sync ADD COLUMN IF NOT EXISTS report_from date;
ALTER TABLE svp_ringcx_sync ADD COLUMN IF NOT EXISTS report_through date;
ALTER TABLE svp_ringcx_sync ADD COLUMN IF NOT EXISTS data_loaded_at text;
