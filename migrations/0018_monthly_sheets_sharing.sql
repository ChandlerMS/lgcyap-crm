-- Who each monthly Sheet has been shared with, when sharing was last tried (Eastern day), and whether it failed.
-- Applied lazily by db/application-sheets.mjs and db/sign-in-sheets.mjs; keep in sync with sharingSchema there.
ALTER TABLE application_sheets_months ADD COLUMN IF NOT EXISTS shared_with text[] NOT NULL DEFAULT '{}';
ALTER TABLE application_sheets_months ADD COLUMN IF NOT EXISTS share_checked_day text;
ALTER TABLE application_sheets_months ADD COLUMN IF NOT EXISTS share_error text;
ALTER TABLE sign_in_sheets_months ADD COLUMN IF NOT EXISTS shared_with text[] NOT NULL DEFAULT '{}';
ALTER TABLE sign_in_sheets_months ADD COLUMN IF NOT EXISTS share_checked_day text;
ALTER TABLE sign_in_sheets_months ADD COLUMN IF NOT EXISTS share_error text;
