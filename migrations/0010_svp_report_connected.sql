-- Total Calls Connected and Total Calls Abandoned per agent per day, from the RingCX report "Agent Close Rate - Standard vs Preferred ALL TIME".
-- The next sync rebuilds every day, because the report's version changes, so the board shows the defaults only until that run.
-- Additive and reversible: ALTER TABLE svp_ringcx_report_daily DROP COLUMN connected, DROP COLUMN abandoned;

ALTER TABLE svp_ringcx_report_daily ADD COLUMN IF NOT EXISTS connected integer NOT NULL DEFAULT 0 CHECK (connected >= 0);
ALTER TABLE svp_ringcx_report_daily ADD COLUMN IF NOT EXISTS abandoned integer NOT NULL DEFAULT 0 CHECK (abandoned >= 0);
