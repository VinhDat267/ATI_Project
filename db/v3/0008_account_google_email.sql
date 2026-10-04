-- AUTH-05: the account page shows which Google address is linked.
-- Existing links stay NULL until the next Google sign-in or link refreshes it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email TEXT;
