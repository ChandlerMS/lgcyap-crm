-- LGCY Onboard's tables, in their own schema. Safe to run again: everything is IF NOT EXISTS.
-- The app runs this by itself the first time it reaches a new database (see ensureSchema in src/db.ts).
CREATE SCHEMA IF NOT EXISTS onboard;

-- The whole CRM is one shared record. `version` goes up by one on every save; a save must name the version it
-- started from (If-Match), so two people saving at once never overwrite each other silently.
CREATE TABLE IF NOT EXISTS onboard.record (
  id integer PRIMARY KEY CHECK (id = 1),
  version integer NOT NULL,
  updated_at text,
  updated_by text,
  state text
);
INSERT INTO onboard.record (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- Who may sign in: a copy of the record's Users list, refreshed on every save.
CREATE TABLE IF NOT EXISTS onboard.members (
  email text PRIMARY KEY,
  name text NOT NULL,
  status text,
  data text NOT NULL
);

-- Sign-in codes (hashed), one live code per email. Times are milliseconds since 1970.
CREATE TABLE IF NOT EXISTS onboard.login_codes (
  email text PRIMARY KEY,
  code_hash text NOT NULL,
  salt text NOT NULL,
  expires_at bigint NOT NULL,
  tries integer NOT NULL DEFAULT 0,
  sent_at bigint NOT NULL,
  window_start bigint NOT NULL,
  window_count integer NOT NULL
);

-- Signed-in browsers. The cookie holds a random token; only its hash is stored.
CREATE TABLE IF NOT EXISTS onboard.sessions (
  id text PRIMARY KEY,
  email text NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_email ON onboard.sessions (email);

-- Each person's own Google Calendar connection.
CREATE TABLE IF NOT EXISTS onboard.google_tokens (
  email text PRIMARY KEY,
  google_email text NOT NULL,
  refresh_token text NOT NULL,
  scope text,
  connected_at text NOT NULL
);

-- Google sign-in round trips in flight (state parameter), kept 10 minutes.
CREATE TABLE IF NOT EXISTS onboard.oauth_states (
  state text PRIMARY KEY,
  email text NOT NULL,
  back text NOT NULL,
  created_at bigint NOT NULL
);

-- Events read from the team's and connected people's Google Calendars.
CREATE TABLE IF NOT EXISTS onboard.gcal_events (
  id text NOT NULL,
  calendar text NOT NULL,
  summary text,
  start text NOT NULL,
  end_at text,
  all_day integer NOT NULL DEFAULT 0,
  meet text,
  location text,
  organizer text,
  attendees text,
  html_link text,
  cand_id integer,
  PRIMARY KEY (calendar, id)
);
CREATE INDEX IF NOT EXISTS gcal_events_start ON onboard.gcal_events (start);

-- Application links: token -> candidate.
CREATE TABLE IF NOT EXISTS onboard.apply_tokens (
  token text PRIMARY KEY,
  cand_id integer NOT NULL,
  created_at bigint NOT NULL
);

-- Indeed notices already handled, so each one is read once.
CREATE TABLE IF NOT EXISTS onboard.indeed_seen (
  message_id text PRIMARY KEY,
  handled_at text NOT NULL,
  result text NOT NULL
);

-- Small settings and status values (last calendar read, cached Google access tokens, last sync).
CREATE TABLE IF NOT EXISTS onboard.kv (
  key text PRIMARY KEY,
  value text NOT NULL
);
