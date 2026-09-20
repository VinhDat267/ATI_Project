-- Durable identity/session boundary for OIDC expansion. Additive only.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[];

ALTER TABLE users
  ADD CONSTRAINT users_roles_nonempty
  CHECK (cardinality(roles) > 0) NOT VALID;

CREATE TABLE auth_identities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer        TEXT NOT NULL,
  subject       TEXT NOT NULL,
  email         TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_identities_issuer_subject_key UNIQUE (issuer, subject)
);

CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

CREATE TABLE auth_sessions (
  session_hash TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_from TEXT NOT NULL CHECK (created_from IN ('oidc', 'legacy')),
  issuer       TEXT,
  subject      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id, created_at DESC);
CREATE INDEX auth_sessions_active_idx ON auth_sessions (session_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE oidc_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash    TEXT NOT NULL UNIQUE,
  nonce_hash    TEXT NOT NULL,
  verifier_hash TEXT NOT NULL,
  issuer        TEXT NOT NULL,
  client_id     TEXT NOT NULL,
  redirect_uri  TEXT NOT NULL,
  return_to     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ
);

CREATE INDEX oidc_transactions_expiry_idx
  ON oidc_transactions (expires_at)
  WHERE consumed_at IS NULL;

CREATE TRIGGER auth_identities_touch
  BEFORE UPDATE ON auth_identities
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
