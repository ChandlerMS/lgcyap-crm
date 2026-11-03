-- WhatsApp Sales leaderboard: daily rows imported from the "LAP Daily Agent Report" monthly workbooks.
-- Additive and reversible: DROP TABLE whatsapp_queue_daily, whatsapp_sales_daily, whatsapp_import_months;

CREATE TABLE IF NOT EXISTS whatsapp_import_months (
  month text PRIMARY KEY CHECK (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  source_file text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  sales_rows integer NOT NULL CHECK (sales_rows >= 0),
  queue_rows integer NOT NULL CHECK (queue_rows >= 0),
  last_activity_date date,
  imported_at timestamptz NOT NULL
);

-- One row per agent per day. agent_key is the case-folded name the reports group by.
CREATE TABLE IF NOT EXISTS whatsapp_sales_daily (
  sale_date date NOT NULL,
  agent_key text NOT NULL CHECK (agent_key = lower(agent_key) AND length(agent_key) BETWEEN 1 AND 200),
  agent_name text NOT NULL CHECK (length(agent_name) BETWEEN 1 AND 200),
  sales integer NOT NULL CHECK (sales >= 0),
  production_cents bigint NOT NULL,
  PRIMARY KEY (sale_date, agent_key)
);

-- Dialer inbound queue rows. agent_key is NULL for dialer seats the source could not map to an agent.
CREATE TABLE IF NOT EXISTS whatsapp_queue_daily (
  call_date date NOT NULL,
  dialer_key text NOT NULL CHECK (dialer_key = lower(dialer_key) AND length(dialer_key) BETWEEN 1 AND 200),
  agent_key text CHECK (agent_key IS NULL OR (agent_key = lower(agent_key) AND length(agent_key) BETWEEN 1 AND 200)),
  agent_name text,
  sold integer NOT NULL CHECK (sold >= 0),
  calls integer NOT NULL CHECK (calls >= 0),
  connected integer NOT NULL CHECK (connected >= 0),
  PRIMARY KEY (call_date, dialer_key)
);
