-- WhatsApp Sales · Standard vs Preferred: daily rows parsed from the Standard vs Preferred group chat export.
-- Additive and reversible: DROP TABLE whatsapp_svp_sales_daily, whatsapp_svp_import;

-- One row: the span the imported exports cover, in the chat's own clock.
CREATE TABLE IF NOT EXISTS whatsapp_svp_import (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  covered_from date NOT NULL,
  last_post_at timestamp NOT NULL CHECK (last_post_at::date >= covered_from),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  messages integer NOT NULL CHECK (messages >= 0),
  sales_rows integer NOT NULL CHECK (sales_rows >= 0),
  imported_at timestamptz NOT NULL
);

-- One row per poster per day. agent_key is the case-folded WhatsApp sender name.
CREATE TABLE IF NOT EXISTS whatsapp_svp_sales_daily (
  sale_date date NOT NULL,
  agent_key text NOT NULL CHECK (agent_key = lower(agent_key) AND length(agent_key) BETWEEN 1 AND 200),
  agent_name text NOT NULL CHECK (length(agent_name) BETWEEN 1 AND 200),
  sales integer NOT NULL CHECK (sales > 0),
  production_cents bigint NOT NULL CHECK (production_cents > 0),
  PRIMARY KEY (sale_date, agent_key)
);
