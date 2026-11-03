CREATE TABLE IF NOT EXISTS policytek_snapshots (
  board text NOT NULL CHECK (board IN ('shopper', 'source')),
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date AND end_date - start_date <= 365),
  captured_at timestamptz NOT NULL,
  rows jsonb NOT NULL CHECK (jsonb_typeof(rows) = 'array'),
  report_totals jsonb NOT NULL CHECK (jsonb_typeof(report_totals) = 'object'),
  partial boolean NOT NULL,
  PRIMARY KEY (board, start_date, end_date)
);

CREATE TABLE IF NOT EXISTS policytek_report_requests (
  board text NOT NULL CHECK (board IN ('shopper', 'source')),
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date AND end_date - start_date <= 365),
  requested_at timestamptz NOT NULL,
  PRIMARY KEY (board, start_date, end_date)
);
